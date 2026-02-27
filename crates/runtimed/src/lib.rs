//! runtimed - Central daemon for managing Jupyter runtimes and prewarmed environments.
//!
//! This crate provides a daemon process that manages a shared pool of prewarmed
//! Python environments (UV and Conda), a content-addressed blob store for
//! notebook outputs, and an Automerge-based settings sync service.
//!
//! All services communicate over a single Unix socket (named pipe on Windows)
//! using length-prefixed binary framing with a channel-based handshake.

use std::path::PathBuf;
use std::process::Command;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

pub mod blob_server;
pub mod blob_store;
pub mod client;
pub mod connection;
pub mod daemon;
pub mod daemon_state_client;
pub mod kernel_manager;
pub mod notebook_doc;
pub mod notebook_sync_client;
pub mod notebook_sync_server;
pub mod output_store;
pub mod project_file;
pub mod protocol;
pub mod runtime;
pub mod service;
pub mod settings_doc;
pub mod singleton;
pub mod sync_client;
pub mod sync_server;

// ============================================================================
// Development Mode and Worktree Isolation
// ============================================================================

/// Check if development mode is enabled.
///
/// Dev mode enables per-worktree daemon isolation, allowing each git worktree
/// to run its own daemon instance with separate state directories.
///
/// Returns true if:
/// - `RUNTIMED_DEV=1` is set (explicit opt-in), OR
/// - `CONDUCTOR_WORKSPACE_PATH` is set (automatic for Conductor users)
pub fn is_dev_mode() -> bool {
    // Explicit opt-in
    if std::env::var("RUNTIMED_DEV")
        .map(|v| v == "1")
        .unwrap_or(false)
    {
        return true;
    }
    // Auto-detect Conductor workspace
    std::env::var("CONDUCTOR_WORKSPACE_PATH").is_ok()
}

/// Get the workspace path for dev mode.
///
/// Uses `CONDUCTOR_WORKSPACE_PATH` if available, otherwise detects via git.
pub fn get_workspace_path() -> Option<PathBuf> {
    // Prefer Conductor's workspace path
    if let Ok(path) = std::env::var("CONDUCTOR_WORKSPACE_PATH") {
        return Some(PathBuf::from(path));
    }
    // Fallback to git detection
    detect_worktree_root()
}

/// Get the workspace name for display.
///
/// Uses `CONDUCTOR_WORKSPACE_NAME` if available, otherwise reads from
/// `.context/workspace-description` file in the worktree.
pub fn get_workspace_name() -> Option<String> {
    // Prefer Conductor's workspace name
    if let Ok(name) = std::env::var("CONDUCTOR_WORKSPACE_NAME") {
        return Some(name);
    }
    // Fallback: read .context/workspace-description
    get_workspace_path()
        .and_then(|p| std::fs::read_to_string(p.join(".context/workspace-description")).ok())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

/// Detect the current git worktree root.
///
/// Runs `git rev-parse --show-toplevel` to find the root directory.
fn detect_worktree_root() -> Option<PathBuf> {
    Command::new("git")
        .args(["rev-parse", "--show-toplevel"])
        .output()
        .ok()
        .filter(|o| o.status.success())
        .and_then(|o| String::from_utf8(o.stdout).ok())
        .map(|s| PathBuf::from(s.trim()))
        .filter(|p| p.exists())
}

/// Compute a short hash of a worktree path for directory naming.
///
/// Returns the first 12 hex characters of the SHA-256 hash.
pub fn worktree_hash(path: &std::path::Path) -> String {
    let mut hasher = Sha256::new();
    hasher.update(path.to_string_lossy().as_bytes());
    hex::encode(&hasher.finalize()[..6]) // 6 bytes = 12 hex chars
}

/// Get the base directory for the current daemon context.
///
/// In dev mode: `~/.cache/runt/worktrees/{hash}/`
/// Otherwise: `~/.cache/runt/`
pub fn daemon_base_dir() -> PathBuf {
    let base = dirs::cache_dir()
        .unwrap_or_else(|| PathBuf::from("/tmp"))
        .join("runt");

    if is_dev_mode() {
        if let Some(worktree) = get_workspace_path() {
            let hash = worktree_hash(&worktree);
            return base.join("worktrees").join(hash);
        }
    }
    base
}

/// Get the default log path for the daemon.
pub fn default_log_path() -> PathBuf {
    daemon_base_dir().join("runtimed.log")
}

// ============================================================================
// Types
// ============================================================================

/// Environment types supported by the pool.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum EnvType {
    Uv,
    Conda,
}

impl std::fmt::Display for EnvType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            EnvType::Uv => write!(f, "uv"),
            EnvType::Conda => write!(f, "conda"),
        }
    }
}

/// A prewarmed environment returned by the daemon.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PooledEnv {
    pub env_type: EnvType,
    pub venv_path: PathBuf,
    pub python_path: PathBuf,
}

/// Pool statistics.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PoolStats {
    pub uv_available: usize,
    pub uv_warming: usize,
    pub conda_available: usize,
    pub conda_warming: usize,
    /// Error info for UV pool (if warming is failing).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub uv_error: Option<PoolError>,
    /// Error info for Conda pool (if warming is failing).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub conda_error: Option<PoolError>,
}

/// Error information for a pool that is failing to warm.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PoolError {
    /// Human-readable error message.
    pub message: String,
    /// Package that failed to install (if identified).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub failed_package: Option<String>,
    /// Number of consecutive failures.
    pub consecutive_failures: u32,
    /// Seconds until next retry (0 if retry is imminent).
    pub retry_in_secs: u64,
}

/// Get the default endpoint path for runtimed.
///
/// On Unix, this returns a Unix socket path (e.g., ~/.cache/runt/runtimed.sock).
/// In dev mode, returns the per-worktree socket path.
/// On Windows, this returns a named pipe path (e.g., \\.\pipe\runtimed).
#[cfg(unix)]
pub fn default_socket_path() -> PathBuf {
    daemon_base_dir().join("runtimed.sock")
}

/// Get the default endpoint path for runtimed.
///
/// On Unix, this returns a Unix socket path (e.g., ~/.cache/runt/runtimed.sock).
/// On Windows, this returns a named pipe path (e.g., \\.\pipe\runtimed).
/// In dev mode on Windows, appends the worktree hash to the pipe name.
#[cfg(windows)]
pub fn default_socket_path() -> PathBuf {
    // Windows named pipes use the \\.\pipe\name format
    if is_dev_mode() {
        if let Some(worktree) = get_workspace_path() {
            let hash = worktree_hash(&worktree);
            return PathBuf::from(format!(r"\\.\pipe\runtimed-{}", hash));
        }
    }
    PathBuf::from(r"\\.\pipe\runtimed")
}

/// Get the default cache directory for environments.
pub fn default_cache_dir() -> PathBuf {
    daemon_base_dir().join("envs")
}

/// Get the default directory for the content-addressed blob store.
pub fn default_blob_store_dir() -> PathBuf {
    daemon_base_dir().join("blobs")
}

/// Get the default path for the persisted Automerge settings document.
pub fn default_settings_doc_path() -> PathBuf {
    daemon_base_dir().join("settings.automerge")
}

/// Get the path to the JSON settings file (for migration and fallback).
pub fn settings_json_path() -> PathBuf {
    dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("runt-notebook")
        .join("settings.json")
}

/// Get the path to the settings JSON Schema file.
pub fn settings_schema_path() -> PathBuf {
    dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("runt-notebook")
        .join("settings.schema.json")
}

/// Get the default directory for persisted notebook Automerge documents.
pub fn default_notebook_docs_dir() -> PathBuf {
    daemon_base_dir().join("notebook-docs")
}
