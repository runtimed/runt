//! runtimed - Central daemon for managing Jupyter runtimes and prewarmed environments.
//!
//! This crate provides a daemon process that manages a shared pool of prewarmed
//! Python environments (UV and Conda). Notebook windows communicate with the
//! daemon via IPC (Unix domain sockets on Unix, named pipes on Windows) to
//! request and return environments.

use std::path::PathBuf;

use serde::{Deserialize, Serialize};

pub mod client;
pub mod daemon;
pub mod fractional_index;
pub mod notebook_protocol;
pub mod notebook_server;
pub mod protocol;
pub mod service;
pub mod singleton;

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
