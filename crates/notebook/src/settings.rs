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

/// Python environment type for dependency management
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum PythonEnvType {
    /// Use uv for Python package management (fast, pip-compatible)
    #[default]
    Uv,
    /// Use conda/rattler for Python package management (supports conda packages)
    Conda,
}

impl std::fmt::Display for PythonEnvType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            PythonEnvType::Uv => write!(f, "uv"),
            PythonEnvType::Conda => write!(f, "conda"),
        }
    }
}

/// Application settings for notebook preferences
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppSettings {
    /// Default runtime for new notebooks (used by Cmd+N)
    #[serde(default)]
    pub default_runtime: Runtime,

    /// Default Python environment type (uv or conda)
    #[serde(default)]
    pub default_python_env: PythonEnvType,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            default_runtime: Runtime::Python,
            default_python_env: PythonEnvType::Uv,
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
        assert_eq!(settings.default_python_env, PythonEnvType::Uv);
        assert!(settings.default_deno_permissions.is_empty());
    }

    #[test]
    fn test_settings_serde() {
        let settings = AppSettings {
            default_runtime: Runtime::Deno,
            default_python_env: PythonEnvType::Uv,
        };

        let json = serde_json::to_string(&settings).unwrap();
        let parsed: AppSettings = serde_json::from_str(&json).unwrap();

        assert_eq!(parsed.default_runtime, Runtime::Deno);
        assert_eq!(parsed.default_python_env, PythonEnvType::Uv);
    }

    #[test]
    fn test_python_env_type_serde() {
        // Test that the enum serializes to lowercase strings
        let uv = PythonEnvType::Uv;
        let conda = PythonEnvType::Conda;

        assert_eq!(serde_json::to_string(&uv).unwrap(), "\"uv\"");
        assert_eq!(serde_json::to_string(&conda).unwrap(), "\"conda\"");

        // Test deserialization
        let parsed_uv: PythonEnvType = serde_json::from_str("\"uv\"").unwrap();
        let parsed_conda: PythonEnvType = serde_json::from_str("\"conda\"").unwrap();

        assert_eq!(parsed_uv, PythonEnvType::Uv);
        assert_eq!(parsed_conda, PythonEnvType::Conda);
    }

    #[test]
    fn test_settings_path_is_valid() {
        let path = settings_path();
        // Should end with the expected path components
        assert!(path.ends_with("runt-notebook/settings.json"));
    }
}
