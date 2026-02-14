//! Application settings persistence for notebook preferences.
//!
//! Settings are stored in a JSON file in the user's config directory:
//! - macOS: ~/Library/Application Support/runt-notebook/settings.json
//! - Linux: ~/.config/runt-notebook/settings.json
//! - Windows: C:\Users\<User>\AppData\Roaming\runt-notebook\settings.json

use crate::runtime::Runtime;
use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// Application settings for notebook preferences
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppSettings {
    /// Default runtime for new notebooks (used by Cmd+N)
    #[serde(default)]
    pub default_runtime: Runtime,

    /// Default Deno permissions for new notebooks
    #[serde(default)]
    pub default_deno_permissions: Vec<String>,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            default_runtime: Runtime::Python,
            default_deno_permissions: vec![],
        }
    }
}

/// Get the path to the settings file
fn settings_path() -> PathBuf {
    dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("runt-notebook")
        .join("settings.json")
}

/// Load settings from disk, returning defaults if file doesn't exist
pub fn load_settings() -> AppSettings {
    let path = settings_path();
    if path.exists() {
        std::fs::read_to_string(&path)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default()
    } else {
        AppSettings::default()
    }
}

/// Save settings to disk
pub fn save_settings(settings: &AppSettings) -> Result<()> {
    let path = settings_path();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(&path, serde_json::to_string_pretty(settings)?)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_settings() {
        let settings = AppSettings::default();
        assert_eq!(settings.default_runtime, Runtime::Python);
        assert!(settings.default_deno_permissions.is_empty());
    }

    #[test]
    fn test_settings_serde() {
        let settings = AppSettings {
            default_runtime: Runtime::Deno,
            default_deno_permissions: vec!["--allow-net".to_string()],
        };

        let json = serde_json::to_string(&settings).unwrap();
        let parsed: AppSettings = serde_json::from_str(&json).unwrap();

        assert_eq!(parsed.default_runtime, Runtime::Deno);
        assert_eq!(parsed.default_deno_permissions.len(), 1);
    }

    #[test]
    fn test_settings_path_is_valid() {
        let path = settings_path();
        // Should end with the expected path components
        assert!(path.ends_with("runt-notebook/settings.json"));
    }
}
