//! Application settings persistence for notebook preferences.
//!
//! Settings are stored in a JSON file in the user's config directory:
//! - macOS: ~/Library/Application Support/runt-notebook/settings.json
//! - Linux: ~/.config/runt-notebook/settings.json
//! - Windows: C:\Users\<User>\AppData\Roaming\runt-notebook\settings.json

use crate::runtime::Runtime;
use anyhow::Result;
use serde::{Deserialize, Deserializer, Serialize};
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

    /// Default packages for prewarmed uv environments
    #[serde(default, deserialize_with = "deserialize_package_list")]
    pub default_uv_packages: Vec<String>,

    /// Default packages for prewarmed conda environments
    #[serde(default, deserialize_with = "deserialize_package_list")]
    pub default_conda_packages: Vec<String>,
}

/// Deserialize a package list that accepts both:
/// - Old format: `"numpy, pandas, matplotlib"` (comma-separated string)
/// - New format: `["numpy", "pandas", "matplotlib"]` (JSON array)
fn deserialize_package_list<'de, D>(deserializer: D) -> std::result::Result<Vec<String>, D::Error>
where
    D: Deserializer<'de>,
{
    use serde::de;

    struct PackageListVisitor;

    impl<'de> de::Visitor<'de> for PackageListVisitor {
        type Value = Vec<String>;

        fn expecting(&self, formatter: &mut std::fmt::Formatter) -> std::fmt::Result {
            formatter.write_str("a string or array of strings")
        }

        fn visit_str<E: de::Error>(self, v: &str) -> std::result::Result<Vec<String>, E> {
            Ok(v.split(',')
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .collect())
        }

        fn visit_seq<A: de::SeqAccess<'de>>(
            self,
            mut seq: A,
        ) -> std::result::Result<Vec<String>, A::Error> {
            let mut items = Vec::new();
            while let Some(item) = seq.next_element::<String>()? {
                let trimmed = item.trim().to_string();
                if !trimmed.is_empty() {
                    items.push(trimmed);
                }
            }
            Ok(items)
        }
    }

    deserializer.deserialize_any(PackageListVisitor)
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            default_runtime: Runtime::Python,
            default_python_env: PythonEnvType::Uv,
            default_uv_packages: vec![],
            default_conda_packages: vec![],
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
        assert!(settings.default_uv_packages.is_empty());
        assert!(settings.default_conda_packages.is_empty());
    }

    #[test]
    fn test_settings_serde() {
        let settings = AppSettings {
            default_runtime: Runtime::Deno,
            default_python_env: PythonEnvType::Uv,
            default_uv_packages: vec!["numpy".into(), "pandas".into()],
            default_conda_packages: vec![],
        };

        let json = serde_json::to_string(&settings).unwrap();
        let parsed: AppSettings = serde_json::from_str(&json).unwrap();

        assert_eq!(parsed.default_runtime, Runtime::Deno);
        assert_eq!(parsed.default_python_env, PythonEnvType::Uv);
        assert_eq!(parsed.default_uv_packages, vec!["numpy", "pandas"]);
    }

    #[test]
    fn test_deserialize_old_comma_format() {
        let json = r#"{
            "default_runtime": "python",
            "default_python_env": "uv",
            "default_uv_packages": "numpy, pandas, matplotlib",
            "default_conda_packages": "scipy"
        }"#;
        let parsed: AppSettings = serde_json::from_str(json).unwrap();
        assert_eq!(
            parsed.default_uv_packages,
            vec!["numpy", "pandas", "matplotlib"]
        );
        assert_eq!(parsed.default_conda_packages, vec!["scipy"]);
    }

    #[test]
    fn test_deserialize_new_array_format() {
        let json = r#"{
            "default_runtime": "python",
            "default_python_env": "uv",
            "default_uv_packages": ["numpy", "pandas"],
            "default_conda_packages": ["scipy", "scikit-learn"]
        }"#;
        let parsed: AppSettings = serde_json::from_str(json).unwrap();
        assert_eq!(parsed.default_uv_packages, vec!["numpy", "pandas"]);
        assert_eq!(parsed.default_conda_packages, vec!["scipy", "scikit-learn"]);
    }

    #[test]
    fn test_deserialize_missing_packages() {
        let json = r#"{"default_runtime": "python"}"#;
        let parsed: AppSettings = serde_json::from_str(json).unwrap();
        assert!(parsed.default_uv_packages.is_empty());
        assert!(parsed.default_conda_packages.is_empty());
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
}
