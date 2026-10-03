use serde::{Deserialize,Serialize};use serde_json::{json,Value};
use std::{collections::HashMap,sync::Mutex,process::Stdio};
use tauri::{AppHandle,Emitter,Manager};use tokio::{io::{AsyncBufReadExt,AsyncReadExt,AsyncSeekExt,BufReader},sync::watch};
#[derive(Clone,Serialize,Deserialize)]
#[serde(rename_all="camelCase")]
pub struct Task {pub id:String,pub name:String,pub kind:String,pub input:Value,pub status:String,pub logs:Vec<String>,#[serde(default)]pub last_day:String}
#[derive(Default)]pub struct Background {tasks:Mutex<HashMap<String,Task>>,cancel:Mutex<HashMap<String,watch::Sender<bool>>>}
fn path()->std::path::PathBuf {crate::platform::local_dir().join("background-tasks.json")}
fn emit(app:&AppHandle,id:&str,status:Option<&str>,line:Option<String>) {
    let store=app.state::<Background>();let mut tasks=store.tasks.lock().unwrap();
    if let Some(task)=tasks.get_mut(id) {if let Some(status)=status {task.status=status.into();}if let Some(line)=line {task.logs.push(line);let remove=task.logs.len().saturating_sub(500);task.logs.drain(..remove);}
        let _=app.emit_to(crate::island::WINDOW_LABEL,"background-task",task.clone());
        let scheduled:Vec<_>=tasks.values().filter(|task|task.kind=="schedule").cloned().collect();
        if let Ok(bytes)=serde_json::to_vec(&scheduled){let _=crate::storage::write(&path(),&bytes);}
    }
}
pub fn list(app:&AppHandle)->Vec<Task> {app.state::<Background>().tasks.lock().unwrap().values().cloned().collect()}
pub fn stop(app:&AppHandle,id:&str)->Result<(),String> {
    let store=app.state::<Background>();let cancel=store.cancel.lock().unwrap();cancel.get(id).ok_or("Task is not active")?.send_replace(true);drop(cancel);emit(app,id,Some("stopped"),Some("Stopped by user".into()));Ok(())
}
pub fn start(app:AppHandle,mut task:Task)->Result<Value,String> {
    if !["command","log","port","process","schedule"].contains(&task.kind.as_str()) {return Err("Unknown background task kind".into());}
    match task.kind.as_str() {
        "command"|"schedule"=>{if task.input["script"].as_str().is_none_or(|script|script.trim().is_empty()) {return Err("Provide a PowerShell script".into());}},
        "log"=>{if !std::path::Path::new(task.input["path"].as_str().ok_or("Provide log path")?).is_absolute(){return Err("Use an absolute log path".into());}},
        "port"=>{if !task.input["port"].as_u64().is_some_and(|port|(1..=65535).contains(&port)){return Err("Port must be 1–65535".into());}},
        "process"=>{if !task.input["pid"].as_u64().is_some_and(|pid|pid>0 && pid<=u32::MAX as u64){return Err("Provide a PID".into());}},_=>(),
    }
    if task.kind=="schedule" {
        let parts=task.input["time"].as_str().unwrap_or_default().split(':').map(str::parse::<u16>).collect::<Result<Vec<_>,_>>().map_err(|_|"Use HH:MM")?;
        if parts.len()!=2 || parts[0]>23 || parts[1]>59 {return Err("Use HH:MM".into());}
        task.input["time"]=json!(format!("{:02}:{:02}",parts[0],parts[1]));
    }
    crate::platform::ensure_private_dir(&crate::platform::local_dir()).map_err(|error|error.to_string())?;
    task.status="working".into();let id=task.id.clone();let (cancel,signal)=watch::channel(false);
    app.state::<Background>().tasks.lock().unwrap().insert(id.clone(),task.clone());app.state::<Background>().cancel.lock().unwrap().insert(id.clone(),cancel);
    emit(&app,&id,Some("working"),Some(format!("Started {}",task.kind)));
    let response=json!({"id":id,"status":"working"});
    tauri::async_runtime::spawn(async move {
        let result=work(&app,&task,signal).await;
        let status=match &result {Ok(_)=>"finished",Err(error) if error=="Task stopped"=>"stopped",Err(_)=>"error"};
        emit(&app,&id,Some(status),Some(result.as_ref().err().cloned().unwrap_or_else(||"Complete".into())));
        app.state::<Background>().cancel.lock().unwrap().remove(&id);
        if status!="stopped" {let request=crate::tools::ToolRequest{name:"system.notification.send".into(),input:json!({"title":task.name,"text":format!("Task {status}")}),chat_id:String::new(),project_id:String::new()};let _=crate::tools::execute(&app,&request).await;}
    });Ok(response)
}
async fn command(app:&AppHandle,task:&Task,mut signal:watch::Receiver<bool>)->Result<(),String> {
    if *signal.borrow(){return Err("Task stopped".into());}
    use std::os::windows::process::CommandExt;
    let executable=format!("{}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",std::env::var("SystemRoot").unwrap_or_else(|_|"C:\\Windows".into()));
    let mut cmd=tokio::process::Command::new(executable);cmd.args(["-NoLogo","-NoProfile","-NonInteractive","-Command",task.input["script"].as_str().unwrap_or_default()]).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped()).kill_on_drop(true);cmd.as_std_mut().creation_flags(0x08000000);
    if let Some(cwd)=task.input["cwd"].as_str().filter(|cwd|!cwd.is_empty()){cmd.current_dir(cwd);}
    let mut child=cmd.spawn().map_err(|error|error.to_string())?;
    let stdout=child.stdout.take().unwrap();let stderr=child.stderr.take().unwrap();
    let out_app=app.clone();let out_id=task.id.clone();let err_app=app.clone();let err_id=task.id.clone();
    let out=tokio::spawn(async move {let mut lines=BufReader::new(stdout).lines();while let Ok(Some(line))=lines.next_line().await {emit(&out_app,&out_id,None,Some(line));}});
    let err=tokio::spawn(async move {let mut lines=BufReader::new(stderr).lines();while let Ok(Some(line))=lines.next_line().await {emit(&err_app,&err_id,None,Some(line));}});
    let result=tokio::select! {_=signal.changed()=>{
        if let Some(pid)=child.id() {
            let executable=std::path::PathBuf::from(std::env::var_os("SystemRoot").unwrap_or_else(||"C:\\Windows".into())).join("System32/taskkill.exe");
            let mut kill=tokio::process::Command::new(executable);
            kill.args(["/PID",&pid.to_string(),"/T","/F"]).stdout(Stdio::null()).stderr(Stdio::null()).kill_on_drop(true);kill.as_std_mut().creation_flags(0x08000000);
            let _=tokio::time::timeout(std::time::Duration::from_secs(5),kill.status()).await;
        }
        let _=child.kill().await;Err("Task stopped".into())
    },result=child.wait()=>{let result=result.map_err(|error|error.to_string())?;emit(app,&task.id,None,Some(format!("Exit code: {:?}",result.code())));if result.success(){Ok(())}else{Err(format!("Command exited with {:?}",result.code()))}}};
    let mut out=out;let mut err=err;
    if tokio::time::timeout(std::time::Duration::from_secs(2),async {let _=(&mut out).await;let _=(&mut err).await;}).await.is_err(){out.abort();err.abort();}
    result
}
async fn work(app:&AppHandle,task:&Task,mut signal:watch::Receiver<bool>)->Result<(),String> {
    if task.kind=="command" {return command(app,task,signal).await;}
    let mut offset=0u64;let mut last_day=task.last_day.clone();
    loop {
        if *signal.borrow(){return Err("Task stopped".into());}
        match task.kind.as_str() {
            "port"=>{if tokio::net::TcpStream::connect(("127.0.0.1",task.input["port"].as_u64().unwrap() as u16)).await.is_ok(){return Ok(());}},
            "process"=>{
                use windows::Win32::{Foundation::CloseHandle,System::Threading::{OpenProcess,GetExitCodeProcess,PROCESS_QUERY_LIMITED_INFORMATION}};
                let running=unsafe {match OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION,false,task.input["pid"].as_u64().unwrap() as u32){
                    Ok(handle)=>{let mut code=0;let result=GetExitCodeProcess(handle,&mut code);let _=CloseHandle(handle);result.map_err(|error|format!("Cannot inspect watched process: {error}"))?;code==259},
                    Err(error) if error.code().0==0x80070057u32 as i32=>false,
                    Err(error)=>return Err(format!("Cannot open watched process: {error}")),
                }};
                if !running{return Ok(());}
            },
            "log"=>{
                let path=task.input["path"].as_str().unwrap();let mut file=tokio::fs::File::open(path).await.map_err(|error|error.to_string())?;
                let length=file.metadata().await.map_err(|error|error.to_string())?.len();if length<offset{offset=0;}
                file.seek(std::io::SeekFrom::Start(offset)).await.map_err(|error|error.to_string())?;let mut bytes=Vec::new();file.take(65536).read_to_end(&mut bytes).await.map_err(|error|error.to_string())?;offset+=bytes.len() as u64;
                for line in String::from_utf8_lossy(&bytes).lines(){emit(app,&task.id,None,Some(line.into()));}
            },
            "schedule"=>{
                let time=crate::platform::local_time();let day=format!("{}-{}-{}",time.year,time.month,time.day);
                if task.input["time"].as_str()==Some(format!("{:02}:{:02}",time.hour,time.minute).as_str()) && day!=last_day {
                    last_day=day;if let Some(saved)=app.state::<Background>().tasks.lock().unwrap().get_mut(&task.id){saved.last_day=last_day.clone();}
                    emit(app,&task.id,None,Some("Scheduled command started".into()));let result=command(app,task,signal.clone()).await;
                    if result.as_ref().err().is_some_and(|error|error=="Task stopped"){return result;}
                    emit(app,&task.id,None,Some(result.err().unwrap_or_else(||"Scheduled command finished".into())));
                    let notification=crate::tools::ToolRequest{name:"system.notification.send".into(),input:json!({"title":task.name,"text":"Scheduled command finished; see task logs for results."}),chat_id:String::new(),project_id:String::new()};let _=crate::tools::execute(app,&notification).await;
                }
            },_=>return Err("Unknown task".into()),
        }
        tokio::select! {_=signal.changed()=>return Err("Task stopped".into()),_=tokio::time::sleep(std::time::Duration::from_secs(2))=>()}
    }
}
pub fn restore(app:AppHandle) {if let Ok(bytes)=crate::storage::read(&path()){if let Ok(tasks)=serde_json::from_slice::<Vec<Task>>(&bytes){for task in tasks {if task.status!="stopped" {let _=start(app.clone(),task);}}}}}
