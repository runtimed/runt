//! Stub for the per-notebook server.
//!
//! Each notebook gets its own server instance, listening on a dedicated Unix
//! socket (or named pipe on Windows). The daemon routes connections to the
//! appropriate notebook server based on the socket path.
//!
//! Socket path: `{runtime_dir}/runt-{notebook_id}.sock`

use std::path::PathBuf;

/// A running notebook server instance.
///
/// Each notebook gets its own socket: `{runtime_dir}/runt-{notebook_id}.sock`
pub struct NotebookServer {
    pub notebook_id: String,
}

impl NotebookServer {
    pub fn new(notebook_id: String) -> Self {
        Self { notebook_id }
    }

    /// Get the Unix socket path for this notebook server.
    pub fn socket_path(&self) -> PathBuf {
        let runtime_dir = dirs::cache_dir()
            .unwrap_or_else(|| PathBuf::from("/tmp"))
            .join("runt");
        runtime_dir.join(format!("runt-{}.sock", self.notebook_id))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_new() {
        let server = NotebookServer::new("test-notebook".into());
        assert_eq!(server.notebook_id, "test-notebook");
    }

    #[test]
    fn test_socket_path_contains_notebook_id() {
        let server = NotebookServer::new("my-notebook-123".into());
        let path = server.socket_path();
        assert!(path
            .to_str()
            .unwrap()
            .contains("runt-my-notebook-123.sock"));
    }
}
