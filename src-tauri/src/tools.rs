use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{path::PathBuf, process::Stdio};
use tauri::AppHandle;
use tokio::io::AsyncWriteExt;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolRequest {
    pub name: String,
    #[serde(default)] pub input: Value,
    #[serde(default)] pub chat_id: String,
    #[serde(default)] pub project_id: String,
}

pub fn category(name: &str) -> Option<&'static str> {
    Some(match name {
        "filesystem.read" | "filesystem.list" | "git.status" | "git.diff" | "git.log" | "git.conflicts" | "repository.search" => "read",
        "coding.test" | "coding.lint" | "coding.build" => "run",
        "task.start" | "task.stop" => "run",
        "task.list" => "read",
        "project.index" | "project.search" => "read",
        "agent.plan" | "agent.delegate" => "read",
        "filesystem.write" | "git.stage" | "git.unstage" | "git.commit" | "git.branch" => "write",
        "terminal.run" | "powershell.run" | "system.process.kill" => "run",
        "system.process.list" | "system.notification.send" => "desktop",
        "system.clipboard.read" | "system.clipboard.write" => "clipboard",
        "system.screenshot" => "screen",
        "browser.open" => "browser",
        "web.open" => "browser",
        "web.search" | "web.fetch" | "web.extract" => "network",
        "http.request" | "github.request" | "vercel.request" => "network",
        name if name.starts_with("github.") || name.starts_with("vercel.") => "network",
        name if name.starts_with("mcp.connect.http.") => "network",
        name if name.starts_with("mcp.connect.stdio.") => "run",
        name if name.starts_with("mcp.") => "desktop",
        _ => return None,
    })
}

pub fn schemas() -> Vec<Value> {
    let definitions = [
        ("filesystem.read", "Read a UTF-8 file", json!({"path":{"type":"string"}}), vec!["path"]),
        ("filesystem.write", "Write UTF-8 text to a file", json!({"path":{"type":"string"},"content":{"type":"string"}}), vec!["path","content"]),
        ("filesystem.list", "List files in a directory", json!({"path":{"type":"string"}}), vec!["path"]),
        ("terminal.run", "Run an executable with separate arguments", json!({"program":{"type":"string"},"args":{"type":"array","items":{"type":"string"}},"cwd":{"type":"string"}}), vec!["program"]),
        ("powershell.run", "Run a PowerShell script after permission", json!({"script":{"type":"string"},"cwd":{"type":"string"}}), vec!["script"]),
        ("system.process.list", "List running processes", json!({}), vec![]),
        ("system.process.kill", "Stop a process by PID", json!({"pid":{"type":"integer"}}), vec!["pid"]),
        ("system.clipboard.read", "Read clipboard text or image", json!({}), vec![]),
        ("system.clipboard.write", "Write clipboard text", json!({"text":{"type":"string"}}), vec!["text"]),
        ("system.notification.send", "Show a Windows notification", json!({"title":{"type":"string"},"text":{"type":"string"}}), vec!["text"]),
        ("system.screenshot", "Capture the selected screen", json!({}), vec![]),
        ("browser.open", "Open a URL in the user's browser", json!({"url":{"type":"string"}}), vec!["url"]),
        ("http.request", "Make a local or remote HTTP request", json!({"url":{"type":"string"},"method":{"type":"string"},"body":{}}), vec!["url"]),
        ("github.request", "Call GitHub REST with the configured key; path begins with /", json!({"path":{"type":"string"},"method":{"type":"string"},"body":{}}), vec!["path"]),
        ("vercel.request", "Call Vercel REST with the configured key; path begins with /", json!({"path":{"type":"string"},"method":{"type":"string"},"body":{}}), vec!["path"]),
    ];
    let mut tools: Vec<Value> = definitions.into_iter().map(|(name, description, properties, required)| json!({"type":"function","function":{"name":name,"description":description,"parameters":{"type":"object","properties":properties,"required":required,"additionalProperties":false}}})).collect();
    tools.extend(crate::web::schemas());
    tools.extend(crate::services::schemas());
    tools.push(json!({"type":"function","function":{"name":"task.start","description":"Start a background command, log/port/process watcher or daily schedule; sends completion notifications","parameters":{"type":"object","properties":{"name":{"type":"string"},"kind":{"type":"string","enum":["command","log","port","process","schedule"]},"script":{"type":"string"},"cwd":{"type":"string"},"path":{"type":"string"},"port":{"type":"integer"},"pid":{"type":"integer"},"time":{"type":"string"}},"required":["kind"]}}}));
    for name in ["task.list","task.stop"] {tools.push(json!({"type":"function","function":{"name":name,"description":name,"parameters":{"type":"object","properties":{"id":{"type":"string"}}}}}));}
    tools.push(json!({"type":"function","function":{"name":"agent.plan","description":"Record a concrete plan for a multi-step task before executing it","parameters":{"type":"object","properties":{"steps":{"type":"array","items":{"type":"string"}}},"required":["steps"]}}}));
    tools.push(json!({"type":"function","function":{"name":"agent.delegate","description":"Ask an isolated local model helper to analyze a focused task. This helper has no tools.","parameters":{"type":"object","properties":{"goal":{"type":"string"},"model":{"type":"string"},"name":{"type":"string"}},"required":["goal"]}}}));
    tools.push(json!({"type":"function","function":{"name":"project.index","description":"Incrementally index a project with local embeddings respecting gitignore","parameters":{"type":"object","properties":{"projectId":{"type":"string"}}}}}));
    tools.push(json!({"type":"function","function":{"name":"project.search","description":"Search project embeddings and return relevant file/line excerpts","parameters":{"type":"object","properties":{"projectId":{"type":"string"},"query":{"type":"string"}},"required":["query"]}}}));
    for operation in ["status", "diff", "log", "stage", "unstage", "commit", "branch","conflicts"] {
        tools.push(json!({"type":"function","function":{"name":format!("git.{operation}"),"description":format!("Git {operation} in a repository"),"parameters":{"type":"object","properties":{"cwd":{"type":"string"},"files":{"type":"array","items":{"type":"string"}},"message":{"type":"string"},"branch":{"type":"string"},"mode":{"type":"string","enum":["list","create","switch"]},"staged":{"type":"boolean"}},"required":["cwd"]}}}));
    }
    tools.push(json!({"type":"function","function":{"name":"repository.search","description":"Find literal text in repository files respecting gitignore","parameters":{"type":"object","properties":{"cwd":{"type":"string"},"query":{"type":"string"}},"required":["cwd","query"]}}}));
    for action in ["test","lint","build"] {tools.push(json!({"type":"function","function":{"name":format!("coding.{action}"),"description":format!("Run a project's {action} command after permission"),"parameters":{"type":"object","properties":{"cwd":{"type":"string"},"script":{"type":"string"}},"required":["cwd"]}}}));}
    tools
}

fn text<'a>(input: &'a Value, key: &str) -> Result<&'a str, String> {
    input[key].as_str().filter(|value| !value.is_empty()).ok_or_else(|| format!("Missing {key}"))
}
fn path(input: &Value) -> Result<PathBuf, String> {
    let path = PathBuf::from(text(input, "path")?);
    if !path.is_absolute() { return Err("Use an absolute Windows path".into()); }
    Ok(path)
}
async fn command(program: &str, args: &[String], cwd: Option<&str>, stdin: Option<&str>) -> Result<Value, String> {
    use std::os::windows::process::CommandExt;
    let mut command = tokio::process::Command::new(program);
    command.args(args).kill_on_drop(true).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());
    command.as_std_mut().creation_flags(0x08000000);
    if let Some(cwd) = cwd { command.current_dir(cwd); }
    let mut child = command.spawn().map_err(|error| error.to_string())?;
    if let (Some(mut pipe), Some(input)) = (child.stdin.take(), stdin) { pipe.write_all(input.as_bytes()).await.map_err(|error| error.to_string())?; }
    let output = tokio::time::timeout(std::time::Duration::from_secs(120), child.wait_with_output()).await.map_err(|_| "Command timed out")?.map_err(|error| error.to_string())?;
    Ok(json!({"exitCode":output.status.code(),"stdout":String::from_utf8_lossy(&output.stdout).chars().take(100000).collect::<String>(),"stderr":String::from_utf8_lossy(&output.stderr).chars().take(100000).collect::<String>()}))
}
fn powershell() -> String {
    format!("{}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe", std::env::var("SystemRoot").unwrap_or_else(|_| "C:\\Windows".into()))
}
async fn ps(script: &str, input: &Value, cwd: Option<&str>) -> Result<Value, String> {
    command(&powershell(), &["-NoLogo".into(),"-NoProfile".into(),"-NonInteractive".into(),"-STA".into(),"-Command".into(),script.into()], cwd, Some(&input.to_string())).await
}

pub async fn execute(app: &AppHandle, request: &ToolRequest) -> Result<Value, String> {
    let normalized=crate::services::normalize(request)?;
    let request=normalized.as_ref().unwrap_or(request);
    let input = &request.input;
    match request.name.as_str() {
        "task.start"=>{let id=format!("task-{}",std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_nanos());crate::background::start(app.clone(),crate::background::Task{id,name:input["name"].as_str().unwrap_or("Local task").into(),kind:text(input,"kind")?.into(),input:input.clone(),status:"working".into(),logs:Vec::new(),last_day:String::new()})},
        "task.list"=>Ok(json!({"tasks":crate::background::list(app)})),
        "task.stop"=>{crate::background::stop(app,text(input,"id")?)?;Ok(json!({"stopped":true}))},
        "repository.search"=> {
            let cwd=text(input,"cwd")?.to_string();let query=text(input,"query")?.to_string();
            tokio::task::spawn_blocking(move|| {
                let mut results=Vec::new();
                for entry in ignore::WalkBuilder::new(&cwd).require_git(false).build().flatten() {
                    if !entry.file_type().is_some_and(|kind|kind.is_file()) {continue;}
                    let Ok(text)=std::fs::read_to_string(entry.path()) else {continue};
                    for (line,content) in text.lines().enumerate() {if content.contains(&query) {results.push(json!({"file":entry.path(),"line":line+1,"text":content.chars().take(1000).collect::<String>()}));if results.len()>=200 {return Ok(json!({"results":results,"truncated":true}));}}}
                }
                Ok(json!({"results":results,"truncated":false}))
            }).await.map_err(|error|error.to_string())?
        },
        name if name.starts_with("coding.") => {
            let cwd=text(input,"cwd")?;
            let default=match name {"coding.test"=>"npm test","coding.lint"=>"npm run lint","coding.build"=>"npm run build",_=>return Err("Unknown coding action".into())};
            ps(input["script"].as_str().filter(|script|!script.trim().is_empty()).unwrap_or(default),&json!({}),Some(cwd)).await
        },
        "agent.plan"=> {let steps=input["steps"].as_array().ok_or("Provide plan steps")?;if steps.iter().any(|step|!step.is_string()) {return Err("Plan steps must be strings".into());}Ok(json!({"steps":steps}))},
        "agent.delegate"=> {
            use tauri::Manager;
            let settings=app.state::<crate::Shared>().settings.lock().unwrap().for_project(&request.project_id);
            let model=input["model"].as_str().filter(|model|!model.is_empty()).unwrap_or(&settings.ollama_model);
            crate::ollama::model_info(&settings.ollama_url,model).await?;
            let goal=text(input,"goal")?;
            let result:Value=reqwest::Client::builder().timeout(std::time::Duration::from_secs(120)).build().map_err(|error|error.to_string())?.post(format!("{}/api/chat",settings.ollama_url.trim_end_matches('/'))).json(&json!({"model":model,"stream":false,"messages":[{"role":"system","content":format!("You are an isolated analysis helper. You have no tools. Analyze only the provided task and return useful findings. {}",settings.agent_prompt)},{"role":"user","content":goal}]})).send().await.map_err(|error|error.to_string())?.error_for_status().map_err(|error|error.to_string())?.json().await.map_err(|error|error.to_string())?;
            let answer=result["message"]["content"].as_str().filter(|text|!text.trim().is_empty()).ok_or("Helper returned no text")?;
            Ok(json!({"name":input["name"].as_str().unwrap_or("Helper"),"model":model,"result":answer}))
        },
        "project.index" | "project.search" => crate::index::run(app,request).await,
        name if name.starts_with("mcp.") => crate::mcp::call(app,request).await,
        "web.search" | "web.fetch" | "web.open" | "web.extract" => {
            use tauri::Manager;
            let settings = app.state::<crate::Shared>().settings.lock().unwrap().clone();
            if !settings.web_search_enabled { return Err("Web access is disabled".into()); }
            crate::web::run(&settings,&request.name,input).await
        },
        "filesystem.read" => Ok(json!({"content":tokio::fs::read_to_string(path(input)?).await.map_err(|error| error.to_string())?})),
        "filesystem.write" => { tokio::fs::write(path(input)?, text(input,"content")?).await.map_err(|error| error.to_string())?; Ok(json!({"written":true})) },
        "filesystem.list" => {
            let mut directory = tokio::fs::read_dir(path(input)?).await.map_err(|error| error.to_string())?;
            let mut entries = Vec::new();
            while let Some(entry) = directory.next_entry().await.map_err(|error| error.to_string())? { entries.push(json!({"path":entry.path(),"directory":entry.file_type().await.map_err(|error| error.to_string())?.is_dir()})); }
            Ok(json!({"entries":entries}))
        },
        "terminal.run" => {
            let program_name = PathBuf::from(text(input,"program")?).file_name().unwrap_or_default().to_string_lossy().to_lowercase();
            if program_name.starts_with("coucou-hooks") { return Err("Hooks are not exposed as arbitrary shell access".into()); }
            let args: Vec<String> = input["args"].as_array().map(|args| args.iter().map(|arg| arg.as_str().map(str::to_string).ok_or("Arguments must be strings".to_string())).collect()).unwrap_or(Ok(Vec::new()))?;
            command(text(input,"program")?, &args, input["cwd"].as_str(), None).await
        },
        "powershell.run" => ps(text(input,"script")?, &json!({}), input["cwd"].as_str()).await,
        "system.process.list" => ps("Get-Process | Select-Object Id,ProcessName,WorkingSet64 | ConvertTo-Json -Compress", input, None).await,
        "system.process.kill" => ps("$r=[Console]::In.ReadToEnd()|ConvertFrom-Json; Stop-Process -Id ([int]$r.pid) -ErrorAction Stop", input, None).await,
        "system.notification.send" => ps(include_str!("notification.ps1"), input, None).await,
        "system.clipboard.read" => crate::desktop::action(app.clone(), "clipboard".into(), "".into()).await,
        "system.clipboard.write" => crate::desktop::action(app.clone(), "copy".into(), text(input,"text")?.into()).await,
        "system.screenshot" => crate::desktop::action(app.clone(), "screenshot".into(), "".into()).await,
        "browser.open" => {
            let url = reqwest::Url::parse(text(input,"url")?).map_err(|error| error.to_string())?;
            if !matches!(url.scheme(),"http"|"https") { return Err("Only HTTP URLs are supported".into()); }
            crate::platform::open_url(url.as_str()); Ok(json!({"opened":true}))
        },
        "http.request" | "github.request" | "vercel.request" => {
            let (url, token) = match request.name.as_str() {
                "http.request" => (text(input,"url")?.to_string(), None),
                name => {
                    let relative = text(input,"path")?;
                    if !relative.starts_with('/') || relative.starts_with("//") || relative.contains('\\') { return Err("API path must start with a single /".into()); }
                    let (host,key) = if name == "github.request" { ("https://api.github.com","github-token") } else { ("https://api.vercel.com","vercel-token") };
                    (format!("{host}{relative}"), Some(crate::secrets::get(key).ok_or("Configure the integration key in Settings")?))
                }
            };
            let parsed = reqwest::Url::parse(&url).map_err(|error| error.to_string())?;
            if !matches!(parsed.scheme(),"http"|"https") { return Err("Only HTTP URLs are supported".into()); }
            let method = reqwest::Method::from_bytes(input["method"].as_str().unwrap_or("GET").as_bytes()).map_err(|error| error.to_string())?;
            let client = reqwest::Client::builder().timeout(std::time::Duration::from_secs(30)).redirect(reqwest::redirect::Policy::none()).build().map_err(|error| error.to_string())?;
            let mut call = client.request(method,parsed).header("User-Agent","CouCou-Shahm-Edition");
            if let Some(token) = token { call = call.bearer_auth(token); }
            if let Some(body) = input.get("body") { call = call.json(body); }
            let response = call.send().await.map_err(|error| error.to_string())?;
            let status = response.status().as_u16();
            let body = response.text().await.map_err(|error| error.to_string())?;
            if request.name!="http.request" && !(200..300).contains(&status) {return Err(format!("Integration HTTP {status}: {}",body.chars().take(1000).collect::<String>()));}
            Ok(json!({"status":status,"body":body.chars().take(100000).collect::<String>()}))
        },
        name if name.starts_with("git.") => {
            let mut args: Vec<String> = match name {
                "git.status" => vec!["status".into(),"--short".into(),"--branch".into()],
                "git.diff" => if input["staged"].as_bool()==Some(true) {vec!["diff".into(),"--cached".into()]}else{vec!["diff".into()]}, "git.log" => vec!["log".into(),"-20".into(),"--oneline".into()],
                "git.conflicts"=>vec!["diff".into(),"--name-only".into(),"--diff-filter=U".into()],
                "git.stage" => vec!["add".into(),"--".into()],
                "git.unstage" => vec!["restore".into(),"--staged".into(),"--".into()],
                "git.commit" => vec!["commit".into(),"-m".into(),text(input,"message")?.into()],
                "git.branch" => match input["mode"].as_str().unwrap_or(if input["branch"].is_string(){"create"}else{"list"}) {
                    "list"=>vec!["branch".into(),"--list".into()],
                    "create"=>vec!["branch".into(),"--".into(),text(input,"branch")?.into()],
                    "switch"=>vec!["switch".into(),"--".into(),text(input,"branch")?.into()],
                    _=>return Err("Unknown branch operation".into()),
                },
                _ => return Err("Unknown Git operation".into()),
            };
            if matches!(name,"git.stage"|"git.unstage") {
                let files = input["files"].as_array().filter(|files| !files.is_empty()).ok_or("Select files")?;
                for file in files { args.push(file.as_str().ok_or("File paths must be strings")?.into()); }
            }
            command("git", &args, Some(text(input,"cwd")?), None).await
        },
        _ => Err("Unknown Coucou tool".into()),
    }
}
