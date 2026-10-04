use std::{collections::HashMap, io::{Read, Write}, path::PathBuf, sync::{Arc, Mutex}};
use portable_pty::{native_pty_system, CommandBuilder, MasterPty, Child, PtySize};
use tauri::{ipc::Channel, AppHandle, Manager};
use serde_json::json;

struct Session {
    master: Box<dyn MasterPty + Send>,
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
    child: Box<dyn Child + Send + Sync>,
}
impl Drop for Session { fn drop(&mut self) { let _ = self.child.kill(); } }
#[derive(Default)]
pub struct Terminals(Arc<Mutex<HashMap<String, Session>>>);
impl Drop for Terminals { fn drop(&mut self) { self.0.lock().unwrap().clear(); } }

fn pwsh() -> Result<PathBuf, String> {
    let standard = PathBuf::from(std::env::var_os("ProgramFiles").unwrap_or_default()).join("PowerShell/7/pwsh.exe");
    std::iter::once(standard).chain(std::env::split_paths(&std::env::var_os("PATH").unwrap_or_default()).map(|path| path.join("pwsh.exe")))
        .find(|path| path.is_file()).ok_or_else(|| "PowerShell 7 (pwsh.exe) is required. Install it and restart CouCou.".into())
}
fn size(cols: u16, rows: u16) -> PtySize { PtySize { cols: cols.clamp(2,500), rows: rows.clamp(2,200), pixel_width:0, pixel_height:0 } }
fn spawn(program: &std::path::Path, cwd: &str, cols: u16, rows: u16) -> Result<(Session, Box<dyn Read + Send>), String> {
    let pair = native_pty_system().openpty(size(cols, rows)).map_err(|e| e.to_string())?;
    let mut command = CommandBuilder::new(program);
    command.args(["-NoLogo", "-NoProfile"]);
    if !cwd.is_empty() { command.cwd(cwd); }
    let child = pair.slave.spawn_command(command).map_err(|e| e.to_string())?;
    let reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;
    Ok((Session { master: pair.master, writer:Arc::new(Mutex::new(writer)), child }, reader))
}

#[tauri::command]
pub async fn terminal_open(app: AppHandle, id: String, cwd: String, chat_id: String, project_id: String, cols: u16, rows: u16, output: Channel<serde_json::Value>) -> Result<(), String> {
    let program = pwsh()?;
    crate::permissions::authorize(&app, &crate::tools::ToolRequest { name:"terminal.open".into(), input:json!({"program":program,"cwd":cwd,"interactive":true}), chat_id, project_id }).await?;
    let (session, mut reader) = tauri::async_runtime::spawn_blocking(move || spawn(&program, &cwd, cols, rows)).await.map_err(|e| e.to_string())??;
    let sessions = app.state::<Terminals>().0.clone();
    {
        let mut entries = sessions.lock().unwrap();
        if entries.contains_key(&id) { return Err("Terminal already open".into()); }
        entries.insert(id.clone(), session);
    }
    std::thread::spawn(move || {
        let mut buffer = [0u8;8192];
        loop {
            match reader.read(&mut buffer) {
                Ok(0) => break,
                Ok(count) => if output.send(json!({"data":&buffer[..count]})).is_err() { break; },
                Err(error) => { let _=output.send(json!({"error":error.to_string()})); break; }
            }
        }
        sessions.lock().unwrap().remove(&id);
        let _=output.send(json!({"exit":true}));
    });
    Ok(())
}
#[tauri::command]
pub async fn terminal_input(state: tauri::State<'_, Terminals>, id: String, data: String) -> Result<(), String> {
    if data.len()>65536 { return Err("Paste is too large (maximum 64 KB)".into()); }
    let writer=state.0.lock().unwrap().get(&id).ok_or("Terminal is closed")?.writer.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut writer=writer.lock().unwrap();
        writer.write_all(data.as_bytes()).and_then(|_| writer.flush()).map_err(|e| e.to_string())
    }).await.map_err(|e|e.to_string())?
}
#[tauri::command]
pub fn terminal_resize(state: tauri::State<Terminals>, id: String, cols: u16, rows: u16) -> Result<(), String> {
    state.0.lock().unwrap().get(&id).ok_or("Terminal is closed")?.master.resize(size(cols,rows)).map_err(|e| e.to_string())
}
#[tauri::command]
pub fn terminal_close(state: tauri::State<Terminals>, id: String) { state.0.lock().unwrap().remove(&id); }

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn pwsh_session_preserves_variables_and_accepts_ctrl_c() {
        let (mut session, mut reader)=spawn(&pwsh().unwrap(),"",80,24).unwrap();
        let (tx,rx)=std::sync::mpsc::channel();
        std::thread::spawn(move || {let mut bytes=[0;8192];while let Ok(n)=reader.read(&mut bytes) {if n==0 || tx.send(bytes[..n].to_vec()).is_err(){break;}}});
        let mut output=String::new();
        let deadline=std::time::Instant::now()+std::time::Duration::from_secs(15);
        while !output.contains("PS ") && std::time::Instant::now()<deadline {
            if let Ok(bytes)=rx.recv_timeout(std::time::Duration::from_millis(200)) {
                output.push_str(&String::from_utf8_lossy(&bytes));
                if bytes.windows(4).any(|part|part==b"\x1b[6n") {session.writer.lock().unwrap().write_all(b"\x1b[1;1R").unwrap();}
            }
        }
        assert!(output.contains("PS "),"PowerShell startup: {output}");
        session.writer.lock().unwrap().write_all(b"$coucouValue=41\rWrite-Output ('COUCOU_RESULT_'+($coucouValue+1))\r").unwrap();
        let deadline=std::time::Instant::now()+std::time::Duration::from_secs(15);
        while !output.contains("COUCOU_RESULT_42") && std::time::Instant::now()<deadline {if let Ok(bytes)=rx.recv_timeout(std::time::Duration::from_millis(200)){output.push_str(&String::from_utf8_lossy(&bytes));}}
        assert!(output.contains("COUCOU_RESULT_42"),"{output}");
        session.master.resize(size(120,30)).unwrap();
        session.writer.lock().unwrap().write_all(b"Start-Sleep -Seconds 30\r\n").unwrap();
        std::thread::sleep(std::time::Duration::from_millis(500));
        session.writer.lock().unwrap().write_all(b"\x03").unwrap();
        std::thread::sleep(std::time::Duration::from_millis(500));
        session.writer.lock().unwrap().write_all(b"Write-Output ('COUCOU_CANCEL_'+($coucouValue+1))\r\n").unwrap();
        let deadline=std::time::Instant::now()+std::time::Duration::from_secs(8);
        while !output.contains("COUCOU_CANCEL_42") && std::time::Instant::now()<deadline {if let Ok(bytes)=rx.recv_timeout(std::time::Duration::from_millis(200)){output.push_str(&String::from_utf8_lossy(&bytes));}}
        assert!(output.contains("COUCOU_CANCEL_42"),"{output}");
    }
}
