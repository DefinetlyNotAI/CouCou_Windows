use serde_json::{json, Value};
use std::process::Stdio;
use std::sync::Mutex;
use std::time::Duration;
use tokio::{io::AsyncWriteExt, process::Command, sync::watch};

#[derive(Default)]
pub struct Voice {
    active: Mutex<Option<(String, watch::Sender<bool>)>>,
    cancelled_before_start: Mutex<Option<String>>,
}

impl Voice {
    pub fn cancel(&self, request_id: &str) {
        let active = self.active.lock().unwrap();
        if let Some((id, signal)) = active.as_ref() {
            if id == request_id { signal.send_replace(true); }
        } else {
            *self.cancelled_before_start.lock().unwrap() = Some(request_id.to_string());
        }
    }

    pub async fn run(&self, request_id: String, mode: &str, text: String, volume: u8) -> Result<Value, String> {
        if !matches!(mode, "capabilities" | "listen" | "speak") { return Err("Unknown voice operation".into()); }
        let (signal, mut cancelled) = watch::channel(false);
        {
            let mut active = self.active.lock().unwrap();
            if active.is_some() { return Err("Another voice operation is active".into()); }
            let mut pending = self.cancelled_before_start.lock().unwrap();
            if pending.as_deref() == Some(&request_id) {
                *pending = None;
                return Err("Voice stopped".into());
            }
            *active = Some((request_id.clone(), signal));
        }
        let work = async {
            let executable = std::path::PathBuf::from(std::env::var_os("SystemRoot").ok_or("Windows directory is unavailable")?)
                .join("System32/WindowsPowerShell/v1.0/powershell.exe");
            let mut command = Command::new(executable);
            command.args(["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", include_str!("voice.ps1")])
                .creation_flags(0x0800_0000).kill_on_drop(true)
                .stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());
            let mut child = command.spawn().map_err(|error| format!("Cannot start Windows speech: {error}"))?;
            let payload = serde_json::to_vec(&json!({"mode": mode, "text": text, "volume": volume.min(100)})).map_err(|error| error.to_string())?;
            let mut input = child.stdin.take().ok_or("Windows speech input is unavailable")?;
            input.write_all(&payload).await.map_err(|error| error.to_string())?;
            drop(input);
            let output = child.wait_with_output().await.map_err(|error| error.to_string())?;
            if !output.status.success() {
                return Err(format!("Windows speech: {}", String::from_utf8_lossy(&output.stderr).trim()));
            }
            serde_json::from_slice(&output.stdout).map_err(|error| format!("Invalid Windows speech response: {error}"))
        };
        let timeout = Duration::from_secs(if mode == "speak" { 600 } else { 45 });
        let result = tokio::select! {
            biased;
            _ = cancelled.changed() => Err("Voice stopped".into()),
            result = tokio::time::timeout(timeout, work) => result.unwrap_or_else(|_| Err("Windows speech timed out".into())),
        };
        self.active.lock().unwrap().take();
        result
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn windows_speech_capabilities_and_prestart_cancellation() {
        tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap().block_on(async {
            let voice = super::Voice::default();
            let capabilities = voice.run("capabilities".into(), "capabilities", String::new(), 100).await.unwrap();
            assert!(capabilities["voices"].is_array());
            assert!(capabilities["languages"].is_array());
            voice.cancel("cancelled");
            assert_eq!(voice.run("cancelled".into(), "listen", String::new(), 100).await.unwrap_err(), "Voice stopped");
            let (result, ()) = tokio::join!(
                voice.run("running".into(), "capabilities", String::new(), 100),
                async {
                    tokio::time::sleep(std::time::Duration::from_millis(2)).await;
                    voice.cancel("running");
                }
            );
            assert_eq!(result.unwrap_err(), "Voice stopped");
            assert!(voice.active.lock().unwrap().is_none());
        });
    }
}
