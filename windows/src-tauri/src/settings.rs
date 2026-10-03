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
    /// "primary" = the main display, "cursor" = whichever display the mouse is on.
    pub screen: String,
    pub autostart: bool,
    #[serde(default = "default_ollama_url")]
    pub ollama_url: String,
    // Separate from the older build's remote model preference.
    #[serde(default)]
    pub ollama_model: String,
    #[serde(default = "enabled")]
    pub tools_enabled: bool,
    #[serde(default = "enabled")]
    pub web_search_enabled: bool,
    #[serde(default = "default_chat_timeout")]
    pub chat_timeout_seconds: u64,
}

fn enabled() -> bool {
    true
}
fn default_chat_timeout() -> u64 {
    120
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
            screen: "primary".into(),
            autostart: false,
            ollama_url: default_ollama_url(),
            ollama_model: String::new(),
            tools_enabled: true,
            web_search_enabled: true,
            chat_timeout_seconds: default_chat_timeout(),
        }
    }
}

pub use crate::platform::{config_dir, local_dir};

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
    fn older_settings_preserve_preferences_and_default_new_chat_controls() {
        let mut old = serde_json::to_value(super::Settings::default()).unwrap();
        old.as_object_mut().unwrap().remove("ollamaUrl");
        old.as_object_mut().unwrap().remove("ollamaModel");
        old.as_object_mut().unwrap().remove("toolsEnabled");
        old.as_object_mut().unwrap().remove("webSearchEnabled");
        old.as_object_mut().unwrap().remove("chatTimeoutSeconds");
        old["activeIntegrations"] = serde_json::json!(["retired-integration"]);
        old["soundVolume"] = serde_json::json!(0.08);
        let settings: super::Settings = serde_json::from_value(old).unwrap();
        assert_eq!(settings.ollama_url, "http://127.0.0.1:11434");
        assert!(settings.ollama_model.is_empty());
        assert_eq!(settings.sound_volume, 0.08);
        assert!(settings.tools_enabled);
        assert_eq!(settings.chat_timeout_seconds, 120);
    }
}
