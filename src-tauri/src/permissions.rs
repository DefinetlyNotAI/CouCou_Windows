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
pub async fn authorize(app: &AppHandle, request: &ToolRequest) -> Result<(), String> {
    let base_category = crate::tools::category(&request.name).ok_or("Unknown tool")?;
    let script = request.input["script"].as_str().unwrap_or("").to_lowercase();
    let program = request.input["program"].as_str().unwrap_or("").to_lowercase();
    let category = if base_category == "run" && (request.input["admin"].as_bool() == Some(true) || script.contains("runas") || program.ends_with("runas.exe") || program == "runas") { "admin" } else { base_category };
    let shared = app.state::<Shared>();
    let settings = shared.settings.lock().unwrap().clone();
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
