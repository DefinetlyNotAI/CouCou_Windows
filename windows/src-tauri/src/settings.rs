// Preferences, stored as plain JSON in settings.json under platform::config_dir().
// No secret ever lands here — API keys live in the OS keychain (see secrets.rs).

use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub sound_enabled: bool,
    pub sound_volume: f64,
    pub auto_close_interval: f64,
    pub absence_interval: f64,
    pub active_integrations: Vec<String>,
    /// "primary" = the main display, "cursor" = whichever display the mouse is on.
    pub screen: String,
    pub autostart: bool,
    pub hooks_installed: bool,
    #[serde(default = "default_ollama_url")]
    pub ollama_url: String,
    // A separate field avoids treating an older build's Claude model as local.
    #[serde(default)]
    pub ollama_model: String,
}

fn default_ollama_url() -> String {
    "http://127.0.0.1:11434".into()
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            sound_enabled: true,
            sound_volume: 0.12,
            auto_close_interval: 15.0,
            absence_interval: 180.0,
            active_integrations: vec![
                "integration_resend".into(),
                "integration_n8n".into(),
                "integration_vercel".into(),
                "integration_github".into(),
            ],
            screen: "primary".into(),
            autostart: false,
            hooks_installed: false,
            ollama_url: default_ollama_url(),
            ollama_model: String::new(),
        }
    }
}

pub use crate::platform::{config_dir, local_dir};

pub fn hook_exe_path() -> PathBuf {
    local_dir().join("bin").join(crate::platform::HOOK_EXE)
}

fn settings_path() -> PathBuf {
    config_dir().join("settings.json")
}

pub fn load() -> Settings {
    match std::fs::read(settings_path()) {
        Ok(bytes) => serde_json::from_slice(&bytes).unwrap_or_default(),
        Err(_) => Settings::default(),
    }
}

pub fn save(settings: &Settings) -> std::io::Result<()> {
    let dir = config_dir();
    crate::platform::ensure_private_dir(&dir)?;
    let json = serde_json::to_vec_pretty(settings)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
    std::fs::write(settings_path(), json)
}

#[cfg(test)]
mod tests {
    #[test]
    fn old_claude_settings_preserve_preferences_and_default_to_local_chat() {
        let mut old = serde_json::to_value(super::Settings::default()).unwrap();
        old.as_object_mut().unwrap().remove("ollamaUrl");
        old.as_object_mut().unwrap().remove("ollamaModel");
        old["model"] = serde_json::json!("claude-opus-5");
        old["soundVolume"] = serde_json::json!(0.08);
        let settings: super::Settings = serde_json::from_value(old).unwrap();
        assert_eq!(settings.ollama_url, "http://127.0.0.1:11434");
        assert!(settings.ollama_model.is_empty());
        assert_eq!(settings.sound_volume, 0.08);
    }
}
