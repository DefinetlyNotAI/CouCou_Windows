use std::{collections::HashMap, sync::{Mutex, OnceLock}};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::oneshot;
use crate::{tools::ToolRequest, Shared};

static PENDING: OnceLock<Mutex<HashMap<String, oneshot::Sender<String>>>> = OnceLock::new();
static GRANTS: OnceLock<Mutex<HashMap<String, String>>> = OnceLock::new();
fn pending() -> &'static Mutex<HashMap<String, oneshot::Sender<String>>> { PENDING.get_or_init(Default::default) }
fn grants() -> &'static Mutex<HashMap<String, String>> { GRANTS.get_or_init(Default::default) }
struct PendingGuard(String);
impl Drop for PendingGuard { fn drop(&mut self) { pending().lock().unwrap().remove(&self.0); } }
pub fn decide(id: String, decision: String) -> Result<(), String> {
    if !["once","chat","project","always","deny"].contains(&decision.as_str()) { return Err("Invalid permission decision".into()); }
    pending().lock().unwrap().remove(&id).ok_or("Permission request has expired")?.send(decision).map_err(|_| "Permission request has expired".into())
}
pub async fn authorize<R: tauri::Runtime>(app: &AppHandle<R>, request: &ToolRequest) -> Result<(), String> {
    let base_category = crate::tools::category(&request.name).ok_or("Unknown tool")?;
    if matches!(request.name.as_str(), "project.index" | "project.search") {
        if let Some(target) = request.input["projectId"].as_str().filter(|id| !id.is_empty()) {
            if target != request.project_id {
                return Err("Select the target project before indexing or searching it".into());
            }
        }
    }
    let script = request.input["script"].as_str().unwrap_or("").to_lowercase();
    let program = request.input["program"].as_str().unwrap_or("").to_lowercase();
    let elevated_arguments = request.input["args"].as_array().is_some_and(|args|args.iter().filter_map(Value::as_str).any(|argument|argument.to_lowercase().contains("runas")));
    let category = if base_category == "run" && (request.input["admin"].as_bool() == Some(true) || script.contains("runas") || elevated_arguments || program.ends_with("runas.exe") || program == "runas") { "admin" } else { base_category };
    let shared = app.state::<Shared>();
    let settings = shared.settings.lock().unwrap().for_project(&request.project_id);
    let project=settings.projects.iter().find(|project| project["id"].as_str()==Some(request.project_id.as_str()));
    if project.and_then(|project| project["permissions"].get(&request.name)).and_then(Value::as_str)==Some("deny") { return Err("Tool denied by project".into()); }
    if settings.active_agent().and_then(|profile| profile["permissions"].get(&request.name)).and_then(Value::as_str) == Some("deny") {
        return Err("Tool denied by agent profile".into());
    }
    let key = format!("{category}:{}",request.name);
    let chat_key = format!("chat:{}:{key}",request.chat_id);
    let project_key = format!("project:{}:{key}",request.project_id);
    let decision = settings.tool_permissions.get(&key).cloned().or_else(|| {
        let grants = grants().lock().unwrap();
        grants.get(&chat_key).cloned().or_else(|| if request.project_id.is_empty() { None } else { grants.get(&project_key).cloned() })
    });
    if decision.as_deref() == Some("deny") { return Err("Tool denied by permission settings".into()); }
    if decision.as_deref() == Some("allow") { return Ok(()); }
    if let Some(permission) = settings.active_agent().and_then(|profile| profile["permissions"].get(&request.name)).and_then(Value::as_str) {
        if permission == "deny" { return Err("Tool denied by agent profile".into()); }
    }
    let id = format!("{}-{}",std::process::id(),std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_nanos());
    let (sender,receiver) = oneshot::channel();
    pending().lock().unwrap().insert(id.clone(),sender);
    let _guard = PendingGuard(id.clone());
    app.emit_to(crate::island::WINDOW_LABEL,"tool-permission",json!({"id":id,"category":category,"request":request})).map_err(|error| error.to_string())?;
    let decision = tokio::time::timeout(std::time::Duration::from_secs(120),receiver).await.map_err(|_| "Permission request timed out")?.map_err(|_| "Permission request cancelled")?;
    match decision.as_str() {
        "once" => (),
        "chat" => { if request.chat_id.is_empty() { return Err("No chat scope".into()); } grants().lock().unwrap().insert(chat_key,"allow".into()); },
        "project" => { if request.project_id.is_empty() { return Err("No project scope".into()); } grants().lock().unwrap().insert(project_key,"allow".into()); },
        "always" | "deny" => {
            let mut settings = shared.settings.lock().unwrap();
            let value = if decision == "always" { "allow" } else { "deny" };
            let mut next = settings.clone(); next.tool_permissions.insert(key,value.into());
            crate::settings::save(&next).map_err(|error| error.to_string())?;
            *settings = next.clone();
            let _ = app.emit("settings-changed",next);
            if decision == "deny" { return Err("Tool denied by user".into()); }
        },
        _ => return Err("Tool denied".into()),
    }
    Ok(())
}
pub async fn run(app: &AppHandle, request: &ToolRequest) -> Result<Value,String> {
    authorize(app,request).await?;
    crate::tools::execute(app,request).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, atomic::{AtomicUsize, Ordering}};
    use tauri::Listener;

    #[test]
    fn elevation_in_executable_arguments_cannot_use_a_regular_run_grant() {
        tokio::runtime::Runtime::new().unwrap().block_on(async {
            let app=tauri::test::mock_app();
            let mut settings=crate::settings::Settings::default();
            settings.tool_permissions.insert("run:terminal.run".into(),"allow".into());
            settings.tool_permissions.insert("admin:terminal.run".into(),"deny".into());
            app.manage(Shared {settings:Mutex::new(settings),gate:Arc::new(crate::island::PollGate::new())});
            let mut request=ToolRequest {name:"terminal.run".into(),input:json!({"program":"powershell.exe","args":["-Command","Start-Process notepad.exe -Verb RunAs"]}),chat_id:"elevation-args-test".into(),project_id:String::new()};
            assert_eq!(authorize(app.handle(),&request).await.unwrap_err(),"Tool denied by permission settings");
            request.input["args"]=json!(["-Command","Get-Location"]);
            authorize(app.handle(),&request).await.unwrap();
        });
    }

    #[test]
    fn project_tools_reject_a_target_outside_the_approval_scope() {
        tokio::runtime::Runtime::new().unwrap().block_on(async {
            let app = tauri::test::mock_app();
            let mut settings = crate::settings::Settings::default();
            settings.tool_permissions.insert("read:project.search".into(), "deny".into());
            app.manage(Shared { settings: Mutex::new(settings), gate: Arc::new(crate::island::PollGate::new()) });
            let mut request = ToolRequest { name: "project.search".into(), input: json!({"projectId":"project-b","query":"test"}), chat_id: "scope-test".into(), project_id: "project-a".into() };
            assert_eq!(authorize(app.handle(), &request).await.unwrap_err(), "Select the target project before indexing or searching it");
            request.project_id.clear();
            assert_eq!(authorize(app.handle(), &request).await.unwrap_err(), "Select the target project before indexing or searching it");
            request.project_id = "project-b".into();
            assert_eq!(authorize(app.handle(), &request).await.unwrap_err(), "Tool denied by permission settings");
            request.input = json!({"query":"test"});
            assert_eq!(authorize(app.handle(), &request).await.unwrap_err(), "Tool denied by permission settings");
        });
    }

    #[test]
    fn approval_grants_are_scoped_and_denials_override_grants() {
        tokio::runtime::Runtime::new().unwrap().block_on(async {
            let app = tauri::test::mock_app();
            app.manage(Shared { settings: Mutex::new(crate::settings::Settings::default()), gate: Arc::new(crate::island::PollGate::new()) });
            let count = Arc::new(AtomicUsize::new(0));
            let observed = count.clone();
            app.listen_any("tool-permission", move |event| {
                let payload: Value = serde_json::from_str(event.payload()).unwrap();
                if payload["request"]["input"]["path"] != "C:\\permission-check.txt" { return; }
                assert_eq!(payload["category"], "read");
                assert_eq!(payload["request"]["input"]["path"], "C:\\permission-check.txt");
                observed.fetch_add(1, Ordering::SeqCst);
                let decision = if payload["request"]["projectId"] == "permission-test-project" { "project" } else { "chat" };
                decide(payload["id"].as_str().unwrap().into(), decision.into()).unwrap();
            });
            let mut request = ToolRequest { name: "filesystem.read".into(), input: json!({"path":"C:\\permission-check.txt"}), chat_id: "permission-test-chat-1".into(), project_id: String::new() };
            authorize(app.handle(), &request).await.unwrap();
            authorize(app.handle(), &request).await.unwrap();
            assert_eq!(count.load(Ordering::SeqCst), 1);
            request.chat_id = "permission-test-chat-2".into();
            authorize(app.handle(), &request).await.unwrap();
            assert_eq!(count.load(Ordering::SeqCst), 2);
            request.project_id = "permission-test-project".into();
            request.chat_id = "permission-test-chat-3".into();
            authorize(app.handle(), &request).await.unwrap();
            request.chat_id = "permission-test-chat-4".into();
            authorize(app.handle(), &request).await.unwrap();
            assert_eq!(count.load(Ordering::SeqCst), 3);
            app.state::<Shared>().settings.lock().unwrap().tool_permissions.insert("read:filesystem.read".into(), "deny".into());
            assert_eq!(authorize(app.handle(), &request).await.unwrap_err(), "Tool denied by permission settings");
            assert_eq!(count.load(Ordering::SeqCst), 3);
            request.name = "unknown.tool".into();
            assert_eq!(authorize(app.handle(), &request).await.unwrap_err(), "Unknown tool");
        });
    }

    #[test]
    fn cancelled_approval_expires_and_once_does_not_create_a_grant() {
        tokio::runtime::Runtime::new().unwrap().block_on(async {
            let app = tauri::test::mock_app();
            app.manage(Shared { settings: Mutex::new(crate::settings::Settings::default()), gate: Arc::new(crate::island::PollGate::new()) });
            let ids = Arc::new(Mutex::new(Vec::<String>::new()));
            let observed = ids.clone();
            let listener = app.listen_any("tool-permission", move |event| {
                let payload: Value = serde_json::from_str(event.payload()).unwrap();
                if payload["request"]["chatId"] != "permission-test-cancel" { return; }
                observed.lock().unwrap().push(payload["id"].as_str().unwrap().into());
            });
            let request = ToolRequest { name: "filesystem.read".into(), input: json!({"path":"C:\\cancel-check.txt"}), chat_id: "permission-test-cancel".into(), project_id: String::new() };
            assert!(tokio::time::timeout(std::time::Duration::from_millis(20), authorize(app.handle(), &request)).await.is_err());
            let expired = ids.lock().unwrap()[0].clone();
            assert_eq!(decide(expired, "once".into()).unwrap_err(), "Permission request has expired");
            app.unlisten(listener);
            let count = Arc::new(AtomicUsize::new(0));
            let observed = count.clone();
            app.listen_any("tool-permission", move |event| {
                let payload: Value = serde_json::from_str(event.payload()).unwrap();
                if payload["request"]["chatId"] != "permission-test-cancel" { return; }
                observed.fetch_add(1, Ordering::SeqCst);
                decide(payload["id"].as_str().unwrap().into(), "once".into()).unwrap();
            });
            authorize(app.handle(), &request).await.unwrap();
            authorize(app.handle(), &request).await.unwrap();
            assert_eq!(count.load(Ordering::SeqCst), 2);
        });
    }
}
