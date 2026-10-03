use std::{process::Stdio, time::{Duration, SystemTime, UNIX_EPOCH}};
use serde_json::{json, Value};
use tauri::{AppHandle, Manager};
use tokio::{io::AsyncWriteExt, process::Command};

pub async fn action(app: AppHandle, mode: String, text: String) -> Result<Value, String> {
    if !matches!(mode.as_str(), "screenshot" | "clipboard" | "copy") { return Err("Unknown desktop action".into()); }
    let directory = crate::platform::local_dir().join("captures");
    crate::platform::ensure_private_dir(&directory).map_err(|error| error.to_string())?;
    let stamp = SystemTime::now().duration_since(UNIX_EPOCH).map_err(|error| error.to_string())?.as_nanos();
    let path = directory.join(format!("capture-{stamp}.png"));
    let pref = app.state::<crate::Shared>().settings.lock().unwrap().screen.clone();
    let screen = crate::island::screen_info(&app, &pref);
    let win = crate::island::window(&app);
    if mode == "screenshot" {
        if let Some(win) = &win { win.hide().map_err(|error| error.to_string())?; }
        tokio::time::sleep(Duration::from_millis(120)).await;
    }
    let work = async {
        let executable = std::path::PathBuf::from(std::env::var_os("SystemRoot").ok_or("Windows directory is unavailable")?)
            .join("System32/WindowsPowerShell/v1.0/powershell.exe");
        let mut command = Command::new(executable);
        command.args(["-NoLogo", "-NoProfile", "-NonInteractive", "-STA", "-Command", include_str!("desktop.ps1")])
            .creation_flags(0x0800_0000).kill_on_drop(true)
            .stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());
        let mut child = command.spawn().map_err(|error| format!("Cannot start desktop action: {error}"))?;
        let payload = json!({"mode": mode, "text": text, "path": path,
            "x": (screen.x * screen.scale).round(), "y": (screen.y * screen.scale).round(),
            "width": (screen.width * screen.scale).round(), "height": (screen.height * screen.scale).round()});
        let mut input = child.stdin.take().ok_or("Desktop action input is unavailable")?;
        input.write_all(&serde_json::to_vec(&payload).map_err(|error| error.to_string())?).await.map_err(|error| error.to_string())?;
        drop(input);
        let output = child.wait_with_output().await.map_err(|error| error.to_string())?;
        if !output.status.success() { return Err(String::from_utf8_lossy(&output.stderr).trim().to_string()); }
        let result: Value = serde_json::from_slice(&output.stdout).map_err(|error| error.to_string())?;
        let file = if result["image"].as_bool() == Some(true) { Some(crate::files::ingest(path.to_str().ok_or("Invalid capture path")?)?) } else { None };
        Ok(json!({"text": result["text"], "file": file}))
    };
    let result = tokio::time::timeout(Duration::from_secs(15), work).await.unwrap_or_else(|_| Err("Desktop action timed out".into()));
    let _ = std::fs::remove_file(&path);
    if mode == "screenshot" && !app.state::<crate::Shared>().gate.collapsed.load(std::sync::atomic::Ordering::Relaxed) {
        if let Some(win) = win { let _ = win.show(); }
    }
    result
}
