//! runtimed - Central daemon for managing Jupyter runtimes and prewarmed environments.
//!
//! This crate provides a daemon process that manages a shared pool of prewarmed
//! Python environments (UV and Conda), a content-addressed blob store for
//! notebook outputs, and an Automerge-based settings sync service.
//!
//! All services communicate over a single Unix socket (named pipe on Windows)
//! using length-prefixed binary framing with a channel-based handshake.

use std::path::PathBuf;

use serde::{Deserialize, Serialize};

pub mod blob_server;
pub mod blob_store;
pub mod client;
pub mod connection;
pub mod daemon;
pub mod notebook_doc;
pub mod notebook_sync_client;
pub mod notebook_sync_server;
pub mod output_store;
pub mod protocol;
pub mod runtime;
pub mod service;
pub mod settings_doc;
pub mod singleton;
pub mod sync_client;
pub mod sync_server;

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
}

/// Get the default endpoint path for runtimed.
///
/// On Unix, this returns a Unix socket path (e.g., ~/.cache/runt/runtimed.sock).
/// On Windows, this returns a named pipe path (e.g., \\.\pipe\runtimed).
#[cfg(unix)]
pub fn default_socket_path() -> PathBuf {
    dirs::cache_dir()
        .unwrap_or_else(|| PathBuf::from("/tmp"))
        .join("runt")
        .join("runtimed.sock")
}

/// Get the default endpoint path for runtimed.
///
/// On Unix, this returns a Unix socket path (e.g., ~/.cache/runt/runtimed.sock).
/// On Windows, this returns a named pipe path (e.g., \\.\pipe\runtimed).
#[cfg(windows)]
pub fn default_socket_path() -> PathBuf {
    // Windows named pipes use the \\.\pipe\name format
    PathBuf::from(r"\\.\pipe\runtimed")
}

/// Get the default cache directory for environments.
pub fn default_cache_dir() -> PathBuf {
    dirs::cache_dir()
        .unwrap_or_else(|| PathBuf::from("/tmp"))
        .join("runt")
        .join("envs")
}

/// Get the default directory for the content-addressed blob store.
pub fn default_blob_store_dir() -> PathBuf {
    dirs::cache_dir()
        .unwrap_or_else(|| PathBuf::from("/tmp"))
        .join("runt")
        .join("blobs")
}

/// Get the default path for the persisted Automerge settings document.
pub fn default_settings_doc_path() -> PathBuf {
    dirs::cache_dir()
        .unwrap_or_else(|| PathBuf::from("/tmp"))
        .join("runt")
        .join("settings.automerge")
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
    dirs::cache_dir()
        .unwrap_or_else(|| PathBuf::from("/tmp"))
        .join("runt")
        .join("notebook-docs")
}
