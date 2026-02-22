//! Automerge-backed settings document for cross-window sync.
//!
//! Wraps an Automerge `AutoCommit` document with typed accessors for
//! application settings. The daemon holds the canonical copy; each connected
//! notebook window holds a local replica that syncs over the Automerge sync
//! protocol.

use std::path::Path;

use automerge::sync;
use automerge::sync::SyncDoc;
use automerge::transaction::Transactable;
use automerge::{AutoCommit, AutomergeError, ReadDoc};
use log::info;
use serde::{Deserialize, Serialize};

/// Snapshot of all synced settings.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SyncedSettings {
    pub theme: String,
    pub default_runtime: String,
    pub default_python_env: String,
}

impl Default for SyncedSettings {
    fn default() -> Self {
        Self {
            theme: "system".to_string(),
            default_runtime: "python".to_string(),
            default_python_env: "uv".to_string(),
        }
    }
}

/// Wrapper around an Automerge document storing application settings.
///
/// The document is a flat map at the root with string keys and string values.
pub struct SettingsDoc {
    doc: AutoCommit,
}

impl SettingsDoc {
    /// Create a new empty settings document with defaults.
    pub fn new() -> Self {
        let mut doc = AutoCommit::new();
        let defaults = SyncedSettings::default();
        // Ignore errors on initial setup — the doc is fresh.
        let _ = doc.put(automerge::ROOT, "theme", defaults.theme);
        let _ = doc.put(automerge::ROOT, "default_runtime", defaults.default_runtime);
        let _ = doc.put(
            automerge::ROOT,
            "default_python_env",
            defaults.default_python_env,
        );
        Self { doc }
    }

    /// Load a settings document from a saved binary, or create a new one with
    /// defaults if the file doesn't exist or is invalid.
    ///
    /// If `settings_json_path` points to an existing `settings.json`, its values
    /// are migrated into the new Automerge document.
    pub fn load_or_create(
        automerge_path: &Path,
        settings_json_path: Option<&Path>,
    ) -> Self {
        // Try loading existing Automerge document
        if automerge_path.exists() {
            if let Ok(data) = std::fs::read(automerge_path) {
                if let Ok(doc) = AutoCommit::load(&data) {
                    info!(
                        "[settings] Loaded Automerge doc from {:?}",
                        automerge_path
                    );
                    return Self { doc };
                }
            }
        }

        // Try migrating from settings.json
        if let Some(json_path) = settings_json_path {
            if json_path.exists() {
                if let Ok(contents) = std::fs::read_to_string(json_path) {
                    if let Ok(json) =
                        serde_json::from_str::<serde_json::Value>(&contents)
                    {
                        info!(
                            "[settings] Migrating from {:?}",
                            json_path
                        );
                        return Self::from_json(&json);
                    }
                }
            }
        }

        // Fall back to defaults
        info!("[settings] Creating new settings doc with defaults");
        Self::new()
    }

    /// Create a settings document from parsed JSON (for migration from settings.json).
    fn from_json(json: &serde_json::Value) -> Self {
        let mut settings = Self::new();

        if let Some(runtime) = json.get("default_runtime").and_then(|v| v.as_str()) {
            settings.put("default_runtime", runtime);
        }
        if let Some(env) = json
            .get("default_python_env")
            .and_then(|v| v.as_str())
        {
            settings.put("default_python_env", env);
        }
        // Theme was never in settings.json, so it stays at the default ("system").

        settings
    }

    /// Load a settings document from raw bytes.
    pub fn load(data: &[u8]) -> Result<Self, AutomergeError> {
        let doc = AutoCommit::load(data)?;
        Ok(Self { doc })
    }

    /// Serialize the document to bytes for persistence.
    pub fn save(&mut self) -> Vec<u8> {
        self.doc.save()
    }

    /// Save the document to a file.
    pub fn save_to_file(&mut self, path: &Path) -> std::io::Result<()> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let data = self.save();
        std::fs::write(path, data)
    }

    /// Write a human-readable JSON mirror of the settings (for fallback/inspection).
    pub fn save_json_mirror(&self, path: &Path) -> std::io::Result<()> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let settings = self.get_all();
        let json = serde_json::to_string_pretty(&settings)
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?;
        std::fs::write(path, json)
    }

    /// Get a single setting value by key.
    pub fn get(&self, key: &str) -> Option<String> {
        self.doc
            .get(automerge::ROOT, key)
            .ok()
            .flatten()
            .and_then(|(value, _)| match value {
                automerge::Value::Scalar(s) => match s.as_ref() {
                    automerge::ScalarValue::Str(s) => Some(s.to_string()),
                    _ => None,
                },
                _ => None,
            })
    }

    /// Set a single setting value.
    pub fn put(&mut self, key: &str, value: &str) {
        let _ = self.doc.put(automerge::ROOT, key, value);
    }

    /// Get a snapshot of all settings.
    pub fn get_all(&self) -> SyncedSettings {
        let defaults = SyncedSettings::default();
        SyncedSettings {
            theme: self.get("theme").unwrap_or(defaults.theme),
            default_runtime: self.get("default_runtime").unwrap_or(defaults.default_runtime),
            default_python_env: self
                .get("default_python_env")
                .unwrap_or(defaults.default_python_env),
        }
    }

    /// Generate a sync message to send to a peer.
    pub fn generate_sync_message(
        &mut self,
        peer_state: &mut sync::State,
    ) -> Option<sync::Message> {
        self.doc.sync().generate_sync_message(peer_state)
    }

    /// Receive and apply a sync message from a peer.
    pub fn receive_sync_message(
        &mut self,
        peer_state: &mut sync::State,
        message: sync::Message,
    ) -> Result<(), AutomergeError> {
        self.doc.sync().receive_sync_message(peer_state, message)
    }
}

impl Default for SettingsDoc {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn test_new_has_defaults() {
        let doc = SettingsDoc::new();
        let settings = doc.get_all();
        assert_eq!(settings.theme, "system");
        assert_eq!(settings.default_runtime, "python");
        assert_eq!(settings.default_python_env, "uv");
    }

    #[test]
    fn test_put_and_get() {
        let mut doc = SettingsDoc::new();
        doc.put("theme", "dark");
        assert_eq!(doc.get("theme"), Some("dark".to_string()));
    }

    #[test]
    fn test_get_nonexistent_key() {
        let doc = SettingsDoc::new();
        assert_eq!(doc.get("nonexistent"), None);
    }

    #[test]
    fn test_save_and_load() {
        let mut doc = SettingsDoc::new();
        doc.put("theme", "light");

        let bytes = doc.save();
        let loaded = SettingsDoc::load(&bytes).unwrap();

        assert_eq!(loaded.get("theme"), Some("light".to_string()));
        assert_eq!(loaded.get("default_runtime"), Some("python".to_string()));
    }

    #[test]
    fn test_save_to_file_and_load_or_create() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("settings.automerge");

        let mut doc = SettingsDoc::new();
        doc.put("theme", "dark");
        doc.save_to_file(&path).unwrap();

        let loaded = SettingsDoc::load_or_create(&path, None);
        assert_eq!(loaded.get("theme"), Some("dark".to_string()));
    }

    #[test]
    fn test_migrate_from_json() {
        let tmp = TempDir::new().unwrap();
        let automerge_path = tmp.path().join("settings.automerge");
        let json_path = tmp.path().join("settings.json");

        // Write a settings.json with existing settings
        std::fs::write(
            &json_path,
            r#"{"default_runtime":"deno","default_python_env":"conda"}"#,
        )
        .unwrap();

        let doc = SettingsDoc::load_or_create(&automerge_path, Some(&json_path));
        assert_eq!(doc.get("default_runtime"), Some("deno".to_string()));
        assert_eq!(doc.get("default_python_env"), Some("conda".to_string()));
        // Theme was never in settings.json, should be default
        assert_eq!(doc.get("theme"), Some("system".to_string()));
    }

    #[test]
    fn test_load_or_create_defaults() {
        let tmp = TempDir::new().unwrap();
        let automerge_path = tmp.path().join("settings.automerge");

        // Neither file exists — should get defaults
        let doc = SettingsDoc::load_or_create(&automerge_path, None);
        assert_eq!(doc.get_all(), SyncedSettings::default());
    }

    #[test]
    fn test_json_mirror() {
        let tmp = TempDir::new().unwrap();
        let json_path = tmp.path().join("settings.json");

        let mut doc = SettingsDoc::new();
        doc.put("theme", "dark");
        doc.save_json_mirror(&json_path).unwrap();

        let contents = std::fs::read_to_string(&json_path).unwrap();
        let parsed: SyncedSettings = serde_json::from_str(&contents).unwrap();
        assert_eq!(parsed.theme, "dark");
    }

    #[test]
    fn test_sync_between_two_docs() {
        // Simulate the daemon-client sync protocol
        let mut server = SettingsDoc::new();
        server.put("theme", "dark");

        let mut client = SettingsDoc::new();
        // Client starts with defaults

        let mut server_state = sync::State::new();
        let mut client_state = sync::State::new();

        // Run sync rounds until both are in sync
        for _ in 0..10 {
            // Client generates a message for the server
            if let Some(msg) = client.generate_sync_message(&mut client_state) {
                server
                    .receive_sync_message(&mut server_state, msg)
                    .unwrap();
            }

            // Server generates a message for the client
            if let Some(msg) = server.generate_sync_message(&mut server_state) {
                client
                    .receive_sync_message(&mut client_state, msg)
                    .unwrap();
            }

            // Check if both are now in sync
            if client.get("theme") == Some("dark".to_string()) {
                break;
            }
        }

        assert_eq!(client.get("theme"), Some("dark".to_string()));
        assert_eq!(client.get("default_runtime"), Some("python".to_string()));
    }

    #[test]
    fn test_concurrent_writes_merge() {
        // Both sides make changes, sync should merge them
        let mut server = SettingsDoc::new();
        let mut client = SettingsDoc::new();

        // Sync initial state first
        let mut server_state = sync::State::new();
        let mut client_state = sync::State::new();
        for _ in 0..10 {
            if let Some(msg) = client.generate_sync_message(&mut client_state) {
                server
                    .receive_sync_message(&mut server_state, msg)
                    .unwrap();
            }
            if let Some(msg) = server.generate_sync_message(&mut server_state) {
                client
                    .receive_sync_message(&mut client_state, msg)
                    .unwrap();
            }
        }

        // Now both make different changes
        server.put("theme", "dark");
        client.put("default_runtime", "deno");

        // Sync again
        for _ in 0..10 {
            if let Some(msg) = client.generate_sync_message(&mut client_state) {
                server
                    .receive_sync_message(&mut server_state, msg)
                    .unwrap();
            }
            if let Some(msg) = server.generate_sync_message(&mut server_state) {
                client
                    .receive_sync_message(&mut client_state, msg)
                    .unwrap();
            }
        }

        // Both should have both changes
        assert_eq!(server.get("theme"), Some("dark".to_string()));
        assert_eq!(server.get("default_runtime"), Some("deno".to_string()));
        assert_eq!(client.get("theme"), Some("dark".to_string()));
        assert_eq!(client.get("default_runtime"), Some("deno".to_string()));
    }
}
