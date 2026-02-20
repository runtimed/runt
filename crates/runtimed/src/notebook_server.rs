//! Stub for the per-notebook server.
//!
//! Each notebook gets its own server instance, listening on a dedicated Unix
//! socket (or named pipe on Windows). The daemon routes connections to the
//! appropriate notebook server based on the socket path.
//!
//! Socket path: `{runtime_dir}/runt-{notebook_id}.sock` (Unix)
//! Named pipe: `\\.\pipe\runt-{notebook_id}` (Windows)

use std::fmt;
use std::path::PathBuf;

/// Errors from notebook server operations.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum NotebookServerError {
    /// The notebook ID contains characters outside `[A-Za-z0-9_-]`.
    InvalidNotebookId(String),
}

impl fmt::Display for NotebookServerError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidNotebookId(id) => {
                write!(
                    f,
                    "invalid notebook id: \"{id}\" (must contain only [A-Za-z0-9_-])"
                )
            }
        }
    }
}

impl std::error::Error for NotebookServerError {}

/// Validate that a notebook ID contains only safe characters.
fn validate_notebook_id(id: &str) -> Result<(), NotebookServerError> {
    if id.is_empty()
        || !id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
    {
        return Err(NotebookServerError::InvalidNotebookId(id.to_string()));
    }
    Ok(())
}

/// A running notebook server instance.
///
/// Each notebook gets its own socket: `{runtime_dir}/runt-{notebook_id}.sock`
pub struct NotebookServer {
    pub notebook_id: String,
}

impl NotebookServer {
    /// Create a new notebook server. Returns an error if the notebook ID
    /// contains characters outside `[A-Za-z0-9_-]`.
    pub fn new(notebook_id: String) -> Result<Self, NotebookServerError> {
        validate_notebook_id(&notebook_id)?;
        Ok(Self { notebook_id })
    }

    /// Get the Unix socket path for this notebook server.
    #[cfg(unix)]
    pub fn socket_path(&self) -> PathBuf {
        let runtime_dir = dirs::cache_dir()
            .unwrap_or_else(|| PathBuf::from("/tmp"))
            .join("runt");
        runtime_dir.join(format!("runt-{}.sock", self.notebook_id))
    }

    /// Get the named pipe path for this notebook server.
    #[cfg(windows)]
    pub fn socket_path(&self) -> PathBuf {
        PathBuf::from(format!(r"\\.\pipe\runt-{}", self.notebook_id))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_new() {
        let server = NotebookServer::new("test-notebook".into()).unwrap();
        assert_eq!(server.notebook_id, "test-notebook");
    }

    #[test]
    fn test_new_with_underscores_and_digits() {
        let server = NotebookServer::new("my_notebook_123".into()).unwrap();
        assert_eq!(server.notebook_id, "my_notebook_123");
    }

    #[test]
    fn test_socket_path_contains_notebook_id() {
        let server = NotebookServer::new("my-notebook-123".into()).unwrap();
        let path = server.socket_path();
        let path_str = path.to_str().unwrap();
        assert!(path_str.contains("runt-my-notebook-123"));
    }

    #[cfg(unix)]
    #[test]
    fn test_socket_path_ends_with_sock() {
        let server = NotebookServer::new("test".into()).unwrap();
        let path = server.socket_path();
        assert!(path.to_str().unwrap().ends_with(".sock"));
    }

    // ── Sanitization tests ──────────────────────────────────────────────

    #[test]
    fn test_rejects_path_traversal() {
        let result = NotebookServer::new("../../../etc/passwd".into());
        assert!(matches!(result, Err(NotebookServerError::InvalidNotebookId(_))));
    }

    #[test]
    fn test_rejects_slash() {
        let result = NotebookServer::new("foo/bar".into());
        assert!(matches!(result, Err(NotebookServerError::InvalidNotebookId(_))));
    }

    #[test]
    fn test_rejects_dot_dot() {
        let result = NotebookServer::new("..".into());
        assert!(matches!(result, Err(NotebookServerError::InvalidNotebookId(_))));
    }

    #[test]
    fn test_rejects_empty() {
        let result = NotebookServer::new("".into());
        assert!(matches!(result, Err(NotebookServerError::InvalidNotebookId(_))));
    }

    #[test]
    fn test_rejects_spaces() {
        let result = NotebookServer::new("foo bar".into());
        assert!(matches!(result, Err(NotebookServerError::InvalidNotebookId(_))));
    }

    #[test]
    fn test_error_display() {
        let err = NotebookServerError::InvalidNotebookId("../bad".into());
        assert_eq!(
            err.to_string(),
            "invalid notebook id: \"../bad\" (must contain only [A-Za-z0-9_-])"
        );
    }
}
