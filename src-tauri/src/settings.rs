// Preferences, stored as DPAPI-encrypted JSON under platform::config_dir().
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
    #[serde(default = "default_active_integrations")]
    pub active_integrations: Vec<String>,
    /// "primary" = the main display, "cursor" = whichever display the mouse is on.
    pub screen: String,
    #[serde(default = "default_island_width")]
    pub island_width: f64,
    #[serde(default = "default_chat_height")]
    pub chat_height: f64,
    #[serde(default = "default_island_position")]
    pub island_position: f64,
    pub autostart: bool,
    #[serde(default)]
    pub hidden_programs: Vec<String>,
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
    #[serde(default = "default_chat_backend")]
    pub chat_backend: String,
    #[serde(default = "default_browser_model")]
    pub browser_model: String,
    #[serde(default = "default_agent_profile")]
    pub agent_profile: String,
    #[serde(default)]
    pub agent_prompt: String,
    #[serde(default)]
    pub agent_profiles: Vec<serde_json::Value>,
    #[serde(default)]
    pub tool_permissions: std::collections::HashMap<String,String>,
    #[serde(default = "default_search_provider")]
    pub search_provider: String,
    #[serde(default)]
    pub search_url: String,
    #[serde(default)] pub mcp_servers: Vec<crate::mcp::Server>,
    #[serde(default)] pub projects: Vec<serde_json::Value>,
    #[serde(default)] pub active_project_id: String,
    #[serde(default="default_embedding_model")] pub embedding_model:String,
    #[serde(default)] pub model_aliases:std::collections::HashMap<String,String>,
    #[serde(default)] pub fallback_models:Vec<String>,
    #[serde(default="default_keep_alive")] pub model_keep_alive:String,
    #[serde(default)] pub preference_profiles:Vec<serde_json::Value>,
}

fn enabled() -> bool {
    true
}
fn default_search_provider() -> String { "duckduckgo".into() }
fn default_embedding_model() -> String {"embeddinggemma".into()}
fn default_keep_alive()->String {"5m".into()}
fn default_island_width() -> f64 { 640.0 }
fn default_chat_height() -> f64 { 300.0 }
fn default_island_position() -> f64 { 0.5 }
fn default_chat_timeout() -> u64 {
    120
}

fn default_chat_backend() -> String {
    "ollama".into()
}
fn default_agent_profile() -> String { "general".into() }

fn default_browser_model() -> String {
    "Llama-3.2-1B-Instruct-q4f16_1-MLC".into()
}

fn default_active_integrations() -> Vec<String> {
    vec![
        "integration_resend".into(),
        "integration_n8n".into(),
        "integration_vercel".into(),
        "integration_github".into(),
    ]
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
            active_integrations: default_active_integrations(),
            screen: "primary".into(),
            island_width: default_island_width(),
            chat_height: default_chat_height(),
            island_position: default_island_position(),
            autostart: false,
            hidden_programs: Vec::new(),
            ollama_url: default_ollama_url(),
            ollama_model: String::new(),
            tools_enabled: true,
            web_search_enabled: true,
            chat_timeout_seconds: default_chat_timeout(),
            chat_backend: default_chat_backend(),
            browser_model: default_browser_model(),
            agent_profile: default_agent_profile(),
            agent_prompt: String::new(),
            agent_profiles: Vec::new(),
            tool_permissions: Default::default(),
            search_provider: default_search_provider(),
            search_url: String::new(),
            mcp_servers: Vec::new(),
            projects: Vec::new(),
            active_project_id: String::new(),
            embedding_model:default_embedding_model(),
            model_aliases:Default::default(),fallback_models:Vec::new(),model_keep_alive:default_keep_alive(),preference_profiles:Vec::new(),
        }
    }
}

impl Settings {
    pub fn for_project(&self, id: &str) -> Self {
        let mut settings=self.clone(); settings.active_project_id=id.into();
        if let Some(project)=self.projects.iter().find(|project|project["id"].as_str()==Some(id)) {
            if let Some(agent_id)=project["agentId"].as_str().filter(|id|!id.is_empty()) {
                settings.agent_profile=agent_id.into();
                if let Some(agent)=settings.active_agent() {
                    settings.agent_prompt=format!("{}\nResponse style: {}",agent["systemPrompt"].as_str().unwrap_or_default(),agent["personality"]);
                }
            }
            settings.agent_prompt=format!("{}\n\nProject: {}\nFolder: {}\nInstructions: {}\nMemory: {}",settings.agent_prompt,project["name"].as_str().unwrap_or_default(),project["folder"].as_str().unwrap_or_default(),project["instructions"].as_str().unwrap_or_default(),project["memory"].as_str().unwrap_or_default());
        }
        settings
    }
    pub fn active_agent(&self) -> Option<&serde_json::Value> {
        self.agent_profiles.iter().find(|profile| profile["id"].as_str() == Some(self.agent_profile.as_str()))
    }
    pub fn agent_tools(&self, mut tools: Vec<serde_json::Value>) -> Vec<serde_json::Value> {
        if let Some(allowed) = self.active_agent().and_then(|agent| agent["tools"].as_array()).filter(|tools| !tools.is_empty()) {
            tools.retain(|tool| allowed.iter().any(|name| name == &tool["function"]["name"]));
        }
        tools
    }
}

pub use crate::platform::{config_dir, local_dir};

fn settings_path() -> PathBuf {
    config_dir().join("settings.json")
}

pub fn load() -> Settings {
    match crate::storage::read(&settings_path()) {
        Ok(bytes) => match serde_json::from_slice(&bytes){Ok(settings)=>{if let Err(error)=crate::storage::write(&settings_path(),&bytes){crate::log::line(format!("Settings encryption failed: {error}"));}settings},Err(_)=>Settings::default()},
        Err(_) => Settings::default(),
    }
}

pub fn save(settings: &Settings) -> std::io::Result<()> {
    let dir = config_dir();
    crate::platform::ensure_private_dir(&dir)?;
    let json = serde_json::to_vec_pretty(settings)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
    crate::storage::write(&settings_path(), &json)
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
        old.as_object_mut().unwrap().remove("islandWidth");
        old.as_object_mut().unwrap().remove("chatHeight");
        old.as_object_mut().unwrap().remove("islandPosition");
        old.as_object_mut().unwrap().remove("agentProfile");
        old.as_object_mut().unwrap().remove("agentPrompt");
        old["activeIntegrations"] = serde_json::json!(["retired-integration"]);
        old["soundVolume"] = serde_json::json!(0.08);
        let settings: super::Settings = serde_json::from_value(old).unwrap();
        assert_eq!(settings.ollama_url, "http://127.0.0.1:11434");
        assert!(settings.ollama_model.is_empty());
        assert_eq!(settings.sound_volume, 0.08);
        assert!(settings.tools_enabled);
        assert_eq!(settings.chat_timeout_seconds, 120);
        assert_eq!(settings.island_width, 640.0);
        assert_eq!(settings.chat_height, 300.0);
        assert_eq!(settings.island_position, 0.5);
        assert_eq!(settings.agent_profile, "general");
        assert!(settings.agent_prompt.is_empty());
    }
}
