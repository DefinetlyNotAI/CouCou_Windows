// Coucou for Windows — app wiring and the commands the island calls.

// Tauri links this manifest into application binaries, but not library tests.
#[cfg(test)]
#[link(name="resource",kind="static")]
extern "C" {}

mod ollama;
mod voice;
mod desktop;
mod tools;
mod web;
mod mcp;
mod index;
mod services;
mod background;
mod storage;
mod permissions;
mod files;
mod island;
mod integrations;
mod log;
mod platform;
mod secrets;
mod settings;
mod tray;

use std::sync::atomic::Ordering;
use std::sync::{Arc, Mutex};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_autostart::ManagerExt;

use ollama::{Chat, ChatContext, ChatReply};
use files::DroppedFile;
use island::{PollGate, ScreenInfo};
use settings::Settings;

#[tauri::command]
async fn tool_run(app: AppHandle, request: tools::ToolRequest) -> Result<serde_json::Value,String> { permissions::run(&app,&request).await }
#[tauri::command]
fn tool_decision(id: String, decision: String) -> Result<(),String> { permissions::decide(id,decision) }
#[tauri::command]fn background_list(app:AppHandle)->Vec<background::Task>{background::list(&app)}
#[tauri::command]fn background_stop(app:AppHandle,id:String)->Result<(),String>{background::stop(&app,&id)}
#[tauri::command]fn chats_load()->Result<String,String>{match storage::read(&platform::local_dir().join("chats.json")){Ok(bytes)=>String::from_utf8(bytes).map_err(|error|error.to_string()),Err(error) if error.kind()==std::io::ErrorKind::NotFound=>Ok("[]".into()),Err(error)=>Err(error.to_string())}}
#[tauri::command]fn chats_save(value:String)->Result<(),String>{let parsed:serde_json::Value=serde_json::from_str(&value).map_err(|error|error.to_string())?;if !parsed.is_array(){return Err("Chats must be an array".into());}storage::write(&platform::local_dir().join("chats.json"),value.as_bytes()).map_err(|error|error.to_string())}
#[tauri::command]
async fn system_stats(app:AppHandle)->Result<serde_json::Value,String>{
    let script=r#"$os=Get-CimInstance Win32_OperatingSystem; $gpu=$null; try {$gpu=(Get-Counter '\GPU Engine(*)\Utilization Percentage' -ErrorAction Stop).CounterSamples | Measure-Object CookedValue -Sum | Select-Object -ExpandProperty Sum} catch {}; @{ramTotalBytes=[double]$os.TotalVisibleMemorySize*1024;ramUsedBytes=([double]$os.TotalVisibleMemorySize-[double]$os.FreePhysicalMemory)*1024;gpuEnginePercentSum=$gpu} | ConvertTo-Json -Compress"#;
    let request=tools::ToolRequest{name:"powershell.run".into(),input:serde_json::json!({"script":script}),chat_id:String::new(),project_id:String::new()};
    let result=tools::execute(&app,&request).await?;
    let mut stats:serde_json::Value=serde_json::from_str(result["stdout"].as_str().unwrap_or("{}")).map_err(|error|error.to_string())?;
    fn size(path:&std::path::Path)->u64 {std::fs::read_dir(path).map(|entries|entries.filter_map(Result::ok).map(|entry|entry.metadata().map(|meta|if meta.is_dir(){size(&entry.path())}else{meta.len()}).unwrap_or(0)).sum()).unwrap_or(0)}
    stats["diskBytes"]=serde_json::json!(size(&platform::local_dir())+size(&platform::config_dir()));
    stats["indexBytes"]=serde_json::json!(size(&platform::local_dir().join("indexes")));
    let url=app.state::<Shared>().settings.lock().unwrap().ollama_url.clone();
    let client=reqwest::Client::builder().timeout(std::time::Duration::from_secs(5)).build().map_err(|error|error.to_string())?;
    stats["loadedModels"]=match client.get(format!("{}/api/ps",url.trim_end_matches('/'))).send().await {Ok(response)=>response.json::<serde_json::Value>().await.unwrap_or(serde_json::Value::Null),Err(_)=>serde_json::Value::Null};
    Ok(stats)
}
#[tauri::command]
async fn project_attach(folder: String) -> Result<serde_json::Value,String> {
    let folder=std::path::PathBuf::from(folder);
    if !folder.is_absolute() { return Err("Enter an absolute Windows folder path".into()); }
    let folder=tokio::fs::canonicalize(folder).await.map_err(|error|error.to_string())?;
    if !folder.is_dir() { return Err("Choose a folder".into()); }
    let name=folder.file_name().unwrap_or_default().to_string_lossy();
    let git=if folder.join(".git").exists() { folder.to_string_lossy().to_string() } else { String::new() };
    Ok(serde_json::json!({"folder":folder,"name":name,"gitRepo":git}))
}
#[tauri::command]
async fn tool_schemas(app: AppHandle, shared: State<'_, Shared>, chat_id: Option<String>, project_id: Option<String>) -> Result<Vec<serde_json::Value>,String> {
    let project_id=project_id.unwrap_or_default();
    let settings = shared.settings.lock().unwrap().for_project(&project_id);
    let mut tools = settings.agent_tools(tools::schemas().into_iter().filter(|tool| settings.web_search_enabled || !tool["function"]["name"].as_str().unwrap_or_default().starts_with("web.")).collect());
    tools.extend(mcp::schemas(&app,&settings,&chat_id.unwrap_or_default(),&project_id).await?);
    Ok(tools)
}

pub struct Shared {
    pub settings: Mutex<Settings>,
    pub gate: Arc<PollGate>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BootInfo {
    settings: Settings,
    screen: ScreenInfo,
    version: String,
    /// Whether the native app supplies global cursor events.
    cursor_poll: bool,
}

#[tauri::command]
fn boot(app: AppHandle, shared: State<Shared>) -> BootInfo {
    let settings = shared.settings.lock().unwrap().clone();
    let screen = island::screen_info(&app, &settings.screen);
    BootInfo {
        settings,
        screen,
        version: env!("CARGO_PKG_VERSION").to_string(),
        cursor_poll: platform::CURSOR_POLL,
    }
}

#[tauri::command]
fn save_settings(app: AppHandle, shared: State<Shared>, settings: Settings) -> Result<(), String> {
    settings::save(&settings).map_err(|e| format!("Could not save settings: {e}"))?;
    let (screen_changed, autostart_changed) = {
        let mut current = shared.settings.lock().unwrap();
        let screen_changed = current.screen != settings.screen || current.island_width != settings.island_width
            || current.chat_height != settings.chat_height || current.island_position != settings.island_position;
        let autostart_changed = current.autostart != settings.autostart;
        *current = settings.clone();
        (screen_changed, autostart_changed)
    };
    if autostart_changed {
        let manager = app.autolaunch();
        let result = if settings.autostart { manager.enable() } else { manager.disable() };
        if let Err(err) = result {
            eprintln!("[coucou] autostart: {err}");
        }
    }
    if screen_changed {
        let collapsed = shared.gate.collapsed.load(Ordering::Relaxed);
        island::apply_geometry(&app, &settings.screen, collapsed);
    }
    // Keep the other window in step (island ⇄ settings window).
    let _ = app.emit("settings-changed", settings);
    Ok(())
}

/// Hidden island → shrink the window to the invisible wake strip and park the
/// cursor poll; anything else → full panel and 60 Hz polling.
#[tauri::command]
fn set_collapsed(app: AppHandle, shared: State<Shared>, collapsed: bool) {
    let pref = shared.settings.lock().unwrap().screen.clone();
    shared.gate.collapsed.store(collapsed, Ordering::Relaxed);
    island::apply_geometry(&app, &pref, collapsed);
    // The wake strip must always take the mouse, and a resize invalidates the flag.
    if shared.gate.fullscreen.load(Ordering::Relaxed) {
        if let Some(win) = island::window(&app) {
            if collapsed { let _ = win.hide(); } else { let _ = win.show(); }
        }
    }
    island::refresh_click_through(&app, &shared.gate);
    shared.gate.set_active(!collapsed);
}

/// The front end pushes the island shape; Rust decides click-through from it.
#[tauri::command]
fn set_island_rect(shared: State<Shared>, x: f64, y: f64, width: f64, height: f64) {
    shared.gate.set_rect(island::IslandRect { x, y, w: width, h: height });
}

#[tauri::command]
fn focus_window(app: AppHandle, focused: bool) {
    let Some(win) = island::window(&app) else { return };
    platform::set_activating(&win, focused);
    if focused {
        let _ = win.set_focus();
    }
}

#[tauri::command]
fn reposition(app: AppHandle, shared: State<Shared>) {
    let pref = shared.settings.lock().unwrap().screen.clone();
    let collapsed = shared.gate.collapsed.load(Ordering::Relaxed);
    island::apply_geometry(&app, &pref, collapsed);
}

#[tauri::command]
fn open_url(url: String) {
    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return;
    }
    platform::open_url(&url);
}

#[tauri::command]
fn quit_app(app: AppHandle) {
    app.exit(0);
}

/// Tray pause stops all configured service pollers until the island is resumed.
#[tauri::command]
fn set_paused(paused: bool) {
    integrations::set_paused(paused);
}

// ── Chat, files and secrets ───────────────────────────────────────────────────

/// One local chat turn. File bytes stay on the Rust side.
#[tauri::command]
async fn chat_send(
    app: AppHandle,
    shared: State<'_, Shared>,
    chat: State<'_, Chat>,
    request_id: String,
    query: String,
    context: Option<ChatContext>,
    model: Option<String>,
    chat_id: Option<String>,
    project_id: Option<String>,
) -> Result<ChatReply, String> {
    let project_id=project_id.unwrap_or_default();
    chat.set_runtime(app.clone(), chat_id.unwrap_or_default(), project_id.clone());
    let mut settings = shared.settings.lock().unwrap().for_project(&project_id);
    if let Some(model) = model { settings.ollama_model = model; }
    let selected=settings.model_aliases.get(&settings.ollama_model).cloned().unwrap_or_else(||settings.ollama_model.clone());
    settings.ollama_model=selected;
    if ollama::model_info(&settings.ollama_url,&settings.ollama_model).await.is_err() {
        for fallback in &settings.fallback_models {let candidate=settings.model_aliases.get(fallback).unwrap_or(fallback);if ollama::model_info(&settings.ollama_url,candidate).await.is_ok(){settings.ollama_model=candidate.clone();break;}}
    }
    let _=app.emit_to(island::WINDOW_LABEL,"chat-progress",serde_json::json!({"requestId":request_id,"phase":"model","text":settings.ollama_model,"tool":null}));
    ollama::send(&chat, &settings, &request_id, query, context, |event| {
        if !matches!(event.phase.as_str(), "streaming" | "thinking") {
            log::line(format!("ollama {} request={} tool={}", event.phase, event.request_id, event.tool.as_deref().unwrap_or("")));
        }
        let _ = app.emit_to(island::WINDOW_LABEL, "chat-progress", event);
    }).await
}

#[tauri::command]
fn chat_cancel(chat: State<'_, Chat>, request_id: String) {
    chat.cancel(Some(&request_id));
}

#[tauri::command]
async fn chat_reset(chat: State<'_, Chat>) -> Result<(), String> {
    chat.reset().await;
    Ok(())
}

#[tauri::command]
async fn ollama_models(url: String) -> Result<Vec<String>, String> {
    ollama::models(&url).await
}

#[tauri::command]
async fn ollama_model_info(url: String, model: String) -> Result<ollama::ModelInfo, String> {
    ollama::model_info(&url, &model).await
}

#[tauri::command]
fn browser_tools(shared: State<Shared>) -> Vec<serde_json::Value> {
    ollama::browser_tools(&shared.settings.lock().unwrap())
}

#[tauri::command]
async fn browser_tool(shared: State<'_, Shared>, name: String, arguments: serde_json::Value) -> Result<ollama::BrowserToolResult, String> {
    let settings = shared.settings.lock().unwrap().clone();
    ollama::browser_tool(&settings, &name, &arguments).await
}

#[tauri::command]
fn browser_context(context: ChatContext) -> Result<String, String> {
    ollama::browser_context(context)
}

#[tauri::command]
async fn model_manage(url:String,action:String,model:String,keep_alive:String)->Result<serde_json::Value,String>{
    let client=reqwest::Client::builder().timeout(std::time::Duration::from_secs(3600)).build().map_err(|error|error.to_string())?;
    let base=url.trim_end_matches('/');
    let request=match action.as_str(){
        "list"=>client.get(format!("{base}/api/tags")),
        "loaded"=>client.get(format!("{base}/api/ps")),
        "show"=>client.post(format!("{base}/api/show")).json(&serde_json::json!({"model":model})),
        "pull"=>client.post(format!("{base}/api/pull")).json(&serde_json::json!({"model":model,"stream":false})),
        "delete"=>client.delete(format!("{base}/api/delete")).json(&serde_json::json!({"model":model})),
        "load"|"unload"=>client.post(format!("{base}/api/generate")).json(&serde_json::json!({"model":model,"stream":false,"keep_alive":if action=="unload" {serde_json::json!(0)}else{serde_json::json!(keep_alive)}})),
        _=>return Err("Unknown model action".into())};
    let response=request.send().await.map_err(|error|error.to_string())?.error_for_status().map_err(|error|error.to_string())?;
    let text=response.text().await.map_err(|error|error.to_string())?;
    if text.trim().is_empty(){Ok(serde_json::json!({"status":"success"}))}else{serde_json::from_str(&text).map_err(|error|error.to_string())}
}
#[tauri::command]
fn chat_pause(chat:State<'_,Chat>,paused:bool) {chat.pause(paused);}

#[tauri::command]
async fn voice_run(voice: State<'_, voice::Voice>, request_id: String, mode: String, text: String, volume: u8) -> Result<serde_json::Value, String> {
    voice.run(request_id, &mode, text, volume).await
}

#[tauri::command]
fn voice_cancel(voice: State<'_, voice::Voice>, request_id: String) {
    voice.cancel(&request_id);
}

#[tauri::command]
fn set_fullscreen(app: AppHandle, shared: State<Shared>, enabled: bool) -> Result<(), String> {
    let win = island::window(&app).ok_or("Island window is unavailable")?;
    win.set_fullscreen(enabled).map_err(|error| error.to_string())?;
    shared.gate.fullscreen.store(enabled, Ordering::Relaxed);
    shared.gate.collapsed.store(false, Ordering::Relaxed);
    shared.gate.set_active(true);
    platform::set_activating(&win, enabled);
    if enabled {
        win.set_ignore_cursor_events(false).map_err(|error| error.to_string())?;
        let _ = win.set_focus();
    } else {
        let pref = shared.settings.lock().unwrap().screen.clone();
        island::apply_geometry(&app, &pref, false);
    }
    island::refresh_click_through(&app, &shared.gate);
    Ok(())
}

#[tauri::command]
async fn chat_restore(chat: State<'_, Chat>, messages: Vec<serde_json::Value>) -> Result<(), String> {
    chat.restore(messages).await
}

#[tauri::command]
fn running_apps() -> Vec<platform::RunningApp> {
    platform::running_apps()
}

#[tauri::command]
async fn desktop_action(app: AppHandle, mode: String, text: String) -> Result<serde_json::Value, String> {
    desktop::action(app, mode, text).await
}

#[tauri::command]
fn monitors(app: AppHandle) -> Result<Vec<(String, String)>, String> {
    Ok(app.available_monitors().map_err(|error| error.to_string())?.into_iter().filter_map(|monitor| {
        let name = monitor.name()?.clone();
        Some((format!("monitor:{name}"), format!("{name} · {} × {}", monitor.size().width, monitor.size().height)))
    }).collect())
}

#[tauri::command]
async fn choose_file(app: AppHandle) -> Result<Option<DroppedFile>, String> {
    let win = island::window(&app).ok_or("Island window is unavailable")?;
    tauri::async_runtime::spawn_blocking(move || {
        platform::choose_file(&win)?.map(|path| files::ingest(&path)).transpose()
    }).await.map_err(|e| e.to_string())?
}

/// Copies a dropped file into the inbox and reports its name back.
#[tauri::command]
fn ingest_file(path: String) -> Result<DroppedFile, String> {
    files::ingest(&path)
}

/// The island may only ask whether a key exists — never read it.
#[tauri::command]
fn secret_present(key: String) -> bool {
    secrets::present(&key)
}

#[tauri::command]
fn secret_set(key: String, value: String) -> Result<(), String> {
    secrets::set(&key, &value)
}

#[tauri::command]
fn secret_clear(key: String) -> Result<(), String> {
    secrets::clear(&key)
}

/// Opens the configured n8n instance.
#[tauri::command]
fn open_n8n() {
    if let Some(url) = secrets::get("n8n-url") {
        open_url(url);
    }
}

/// Refresh buttons in the integration cards.
#[tauri::command]
async fn refresh_integration(app: AppHandle, id: String) {
    integrations::poll_once(app, &id).await;
}

/// Lets the island write to the same log as the Rust side.
#[tauri::command]
fn log_line(message: String) {
    log::line(format!("ui  {message}"));
}

// ── Settings window ───────────────────────────────────────────────────────────

/// WebView2 allows exactly one browser environment per app, and its options are
/// fixed by whichever webview is created first. Every window must therefore ask
/// for the *same* arguments as the island (see `additionalBrowserArgs` in
/// tauri.conf.json) — a mismatch makes the second window come up blank, with no
/// error anywhere.
const BROWSER_ARGS: &str = "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection --autoplay-policy=no-user-gesture-required";

/// In a dev build the pages are served by Vite, so the second window needs the
/// absolute dev URL; a bundled build resolves it inside the app bundle.
fn settings_page_url(app: &AppHandle) -> WebviewUrl {
    #[cfg(dev)]
    if let Some(mut base) = app.config().build.dev_url.clone() {
        base.set_path("/settings.html");
        return WebviewUrl::External(base);
    }
    let _ = app;
    WebviewUrl::App("settings.html".into())
}

/// The settings window is created hidden at launch and only ever shown and
/// hidden afterwards. A WebView2 window created later — on the main thread or
/// not — silently comes up blank in this app, so the window that works is the
/// one that exists before the island's webview does.
fn create_settings_window(app: &AppHandle) {
    let url = settings_page_url(app);
    match WebviewWindowBuilder::new(app, "settings", url)
        .additional_browser_args(BROWSER_ARGS)
        .title("Settings — CouCou Shahm Edition")
        .inner_size(560.0, 680.0)
        .min_inner_size(460.0, 480.0)
        .resizable(true)
        .visible(false)
        .center()
        .build()
    {
        Ok(win) => {
            // Closing it must only hide it, or it could never be reopened.
            let hidden = win.clone();
            win.on_window_event(move |event| {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = hidden.hide();
                }
            });
        }
        Err(err) => log::line(format!("settings window failed: {err}")),
    }
}

pub fn show_settings_window(app: &AppHandle) {
    let Some(win) = app.get_webview_window("settings") else {
        log::line("settings window missing");
        return;
    };
    let _ = win.unminimize();
    let _ = win.show();
    let _ = win.set_focus();
}

#[tauri::command]
fn open_settings_window(app: AppHandle) {
    show_settings_window(&app);
}

pub fn run() {
    let loaded = settings::load();
    let gate = Arc::new(PollGate::new());

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            let _ = app.emit_to(island::WINDOW_LABEL, "tray", "open".to_string());
        }))
        .plugin(tauri_plugin_autostart::Builder::new().build())
        .manage(Shared {
            settings: Mutex::new(loaded.clone()),
            gate: gate.clone(),
        })
        .manage(Chat::default())
        .manage(background::Background::default())
        .manage(voice::Voice::default())
        .invoke_handler(tauri::generate_handler![
            system_stats,
            model_manage,
            chats_load,chats_save,
            boot,
            tool_run,
            tool_decision,
            tool_schemas,
            background_list,
            background_stop,
            project_attach,
            save_settings,
            set_collapsed,
            set_island_rect,
            focus_window,
            reposition,
            set_fullscreen,
            open_url,
            quit_app,
            set_paused,
            log_line,
            chat_send,
            chat_reset,
            chat_restore,
            chat_cancel,
            chat_pause,
            voice_run,
            voice_cancel,
            ollama_models,
            ollama_model_info,
            browser_tools,
            browser_tool,
            browser_context,
            running_apps,
            desktop_action,
            monitors,
            choose_file,
            ingest_file,
            secret_present,
            secret_set,
            secret_clear,
            refresh_integration,
            open_n8n,
            open_settings_window,
        ])
        .setup(move |app| {
            let handle = app.handle().clone();
            tray::build(&handle)?;
            // Before the island: see create_settings_window.
            create_settings_window(&handle);

            if let Some(win) = island::window(&handle) {
                platform::make_non_activating(&win);
                island::apply_geometry(&handle, &loaded.screen, false);
                let _ = win.show();
            }
            gate.collapsed.store(false, Ordering::Relaxed);
            gate.set_active(true);
            island::spawn_cursor_poll(handle.clone(), gate.clone());

            log::line(format!("--- CouCou Shahm Edition v{} started ---", env!("CARGO_PKG_VERSION")));
            integrations::start(handle.clone());
            background::restore(handle.clone());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Coucou");
}
