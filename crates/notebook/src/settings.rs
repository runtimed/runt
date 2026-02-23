//! Application settings persistence for notebook preferences.
//!
//! Settings are stored in a JSON file in the user's config directory:
//! - macOS: ~/Library/Application Support/runt-notebook/settings.json
//! - Linux: ~/.config/runt-notebook/settings.json
//! - Windows: C:\Users\<User>\AppData\Roaming\runt-notebook\settings.json
//!
//! The JSON schema matches `runtimed::settings_doc::SyncedSettings` so both
//! the daemon and the notebook write the same format to settings.json.

use crate::runtime::Runtime;
use anyhow::Result;
use runtimed::settings_doc::{CondaDefaults, UvDefaults};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// Python environment type for dependency management
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default, JsonSchema)]
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

/// Application settings for notebook preferences.
///
/// Serializes to the same nested JSON schema as `SyncedSettings`:
/// ```json
/// {
///   "theme": "system",
///   "default_runtime": "python",
///   "default_python_env": "uv",
///   "uv": { "default_packages": ["numpy"] },
///   "conda": { "default_packages": [] }
/// }
/// ```
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct AppSettings {
    /// UI theme: "system", "light", or "dark"
    #[serde(default = "default_theme")]
    pub theme: String,

    /// Default runtime for new notebooks (used by Cmd+N)
    #[serde(default)]
    pub default_runtime: Runtime,

    /// Default Python environment type (uv or conda)
    #[serde(default)]
    pub default_python_env: PythonEnvType,

    /// UV environment defaults
    #[serde(default)]
    pub uv: UvDefaults,

    /// Conda environment defaults
    #[serde(default)]
    pub conda: CondaDefaults,
}

fn default_theme() -> String {
    "system".to_string()
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            theme: default_theme(),
            default_runtime: Runtime::Python,
            default_python_env: PythonEnvType::Uv,
            uv: UvDefaults::default(),
            conda: CondaDefaults::default(),
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

/// Load settings from disk, returning defaults if file doesn't exist.
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
        assert_eq!(settings.theme, "system");
        assert_eq!(settings.default_runtime, Runtime::Python);
        assert_eq!(settings.default_python_env, PythonEnvType::Uv);
        assert!(settings.uv.default_packages.is_empty());
        assert!(settings.conda.default_packages.is_empty());
    }

    #[test]
    fn test_settings_serde_nested_format() {
        let settings = AppSettings {
            theme: "dark".to_string(),
            default_runtime: Runtime::Deno,
            default_python_env: PythonEnvType::Uv,
            uv: UvDefaults {
                default_packages: vec!["numpy".into(), "pandas".into()],
            },
            conda: CondaDefaults::default(),
        };

        let json = serde_json::to_string(&settings).unwrap();
        let parsed: AppSettings = serde_json::from_str(&json).unwrap();

        assert_eq!(parsed.theme, "dark");
        assert_eq!(parsed.default_runtime, Runtime::Deno);
        assert_eq!(parsed.default_python_env, PythonEnvType::Uv);
        assert_eq!(parsed.uv.default_packages, vec!["numpy", "pandas"]);
    }

    #[test]
    fn test_deserialize_nested_format() {
        let json = r#"{
            "theme": "dark",
            "default_runtime": "python",
            "default_python_env": "uv",
            "uv": { "default_packages": ["numpy", "pandas"] },
            "conda": { "default_packages": ["scipy"] }
        }"#;
        let parsed: AppSettings = serde_json::from_str(json).unwrap();
        assert_eq!(parsed.theme, "dark");
        assert_eq!(parsed.uv.default_packages, vec!["numpy", "pandas"]);
        assert_eq!(parsed.conda.default_packages, vec!["scipy"]);
    }

    #[test]
    fn test_deserialize_missing_fields_defaults() {
        let json = r#"{"default_runtime": "python"}"#;
        let parsed: AppSettings = serde_json::from_str(json).unwrap();
        assert_eq!(parsed.theme, "system");
        assert!(parsed.uv.default_packages.is_empty());
        assert!(parsed.conda.default_packages.is_empty());
    }

    #[test]
    fn test_python_env_type_serde() {
        let uv = PythonEnvType::Uv;
        let conda = PythonEnvType::Conda;

        assert_eq!(serde_json::to_string(&uv).unwrap(), "\"uv\"");
        assert_eq!(serde_json::to_string(&conda).unwrap(), "\"conda\"");

        let parsed_uv: PythonEnvType = serde_json::from_str("\"uv\"").unwrap();
        let parsed_conda: PythonEnvType = serde_json::from_str("\"conda\"").unwrap();

        assert_eq!(parsed_uv, PythonEnvType::Uv);
        assert_eq!(parsed_conda, PythonEnvType::Conda);
    }

    #[test]
    fn test_settings_path_is_valid() {
        let path = settings_path();
        assert!(path.ends_with("runt-notebook/settings.json"));
    }

    #[test]
    fn test_serialized_format_matches_synced_settings() {
        let settings = AppSettings {
            theme: "dark".to_string(),
            default_runtime: Runtime::Python,
            default_python_env: PythonEnvType::Uv,
            uv: UvDefaults {
                default_packages: vec!["numpy".into()],
            },
            conda: CondaDefaults {
                default_packages: vec!["scipy".into()],
            },
        };

        let json: serde_json::Value =
            serde_json::from_str(&serde_json::to_string(&settings).unwrap()).unwrap();

        // Verify nested structure matches SyncedSettings
        assert_eq!(json["theme"], "dark");
        assert_eq!(json["default_runtime"], "python");
        assert_eq!(json["default_python_env"], "uv");
        assert_eq!(json["uv"]["default_packages"][0], "numpy");
        assert_eq!(json["conda"]["default_packages"][0], "scipy");

        // Verify no old flat keys
        assert!(json.get("default_uv_packages").is_none());
        assert!(json.get("default_conda_packages").is_none());
    }
}
