//! Application settings persistence for notebook preferences.
//!
//! Settings are stored in a JSON file in the user's config directory:
//! - macOS: ~/Library/Application Support/runt-notebook/settings.json
//! - Linux: ~/.config/runt-notebook/settings.json
//! - Windows: C:\Users\<User>\AppData\Roaming\runt-notebook\settings.json
//!
//! Uses `runtimed::settings_doc::SyncedSettings` as the canonical settings type.

use anyhow::Result;
use runtimed::settings_doc::SyncedSettings;
use std::path::PathBuf;

// Re-export types that notebook code uses from runtimed
pub use runtimed::runtime::Runtime;
pub use runtimed::settings_doc::{CondaDefaults, PythonEnvType, ThemeMode, UvDefaults};

/// Get the path to the settings file
fn settings_path() -> PathBuf {
    runtimed::settings_json_path()
}

/// Load settings from disk, returning defaults if file doesn't exist.
pub fn load_settings() -> SyncedSettings {
    let path = settings_path();
    if path.exists() {
        std::fs::read_to_string(&path)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default()
    } else {
        SyncedSettings::default()
    }
}

/// Save settings to disk.
///
/// Injects a `$schema` key pointing to the companion schema file so editors
/// can provide autocomplete and validation.
pub fn save_settings(settings: &SyncedSettings) -> Result<()> {
    let path = settings_path();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let mut json_value = serde_json::to_value(settings)?;
    if let Some(obj) = json_value.as_object_mut() {
        obj.insert(
            "$schema".to_string(),
            serde_json::Value::String("./settings.schema.json".to_string()),
        );
    }
    let json = serde_json::to_string_pretty(&json_value)?;
    std::fs::write(&path, format!("{json}\n"))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_settings() {
        let settings = SyncedSettings::default();
        assert_eq!(settings.theme, ThemeMode::System);
        assert_eq!(settings.default_runtime, Runtime::Python);
        assert_eq!(settings.default_python_env, PythonEnvType::Uv);
        assert!(settings.uv.default_packages.is_empty());
        assert!(settings.conda.default_packages.is_empty());
    }

    #[test]
    fn test_settings_serde_nested_format() {
        let settings = SyncedSettings {
            theme: ThemeMode::Dark,
            default_runtime: Runtime::Deno,
            default_python_env: PythonEnvType::Uv,
            uv: UvDefaults {
                default_packages: vec!["numpy".into(), "pandas".into()],
            },
            conda: CondaDefaults::default(),
        };

        let json = serde_json::to_string(&settings).unwrap();
        let parsed: SyncedSettings = serde_json::from_str(&json).unwrap();

        assert_eq!(parsed.theme, ThemeMode::Dark);
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
        let parsed: SyncedSettings = serde_json::from_str(json).unwrap();
        assert_eq!(parsed.theme, ThemeMode::Dark);
        assert_eq!(parsed.uv.default_packages, vec!["numpy", "pandas"]);
        assert_eq!(parsed.conda.default_packages, vec!["scipy"]);
    }

    #[test]
    fn test_deserialize_missing_fields_defaults() {
        let json = r#"{"default_runtime": "python"}"#;
        let parsed: SyncedSettings = serde_json::from_str(json).unwrap();
        assert_eq!(parsed.theme, ThemeMode::System);
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
    fn test_schema_key_in_json_ignored_during_deserialization() {
        let json = r#"{
            "$schema": "./settings.schema.json",
            "theme": "dark",
            "default_runtime": "deno",
            "default_python_env": "conda",
            "uv": { "default_packages": [] },
            "conda": { "default_packages": [] }
        }"#;
        let parsed: SyncedSettings = serde_json::from_str(json).unwrap();
        assert_eq!(parsed.theme, ThemeMode::Dark);
        assert_eq!(parsed.default_runtime, Runtime::Deno);
        assert_eq!(parsed.default_python_env, PythonEnvType::Conda);
    }
}
