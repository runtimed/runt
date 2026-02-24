//! IPC protocol types for pool daemon communication.
//!
//! Request and Response enums are serialized as JSON and sent over
//! length-prefixed frames (see `connection.rs`).

use serde::{Deserialize, Serialize};

use crate::{EnvType, PoolStats, PooledEnv};

/// Requests that clients can send to the daemon.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Request {
    /// Request an environment from the pool.
    /// If available, the daemon will claim it and return the path.
    Take { env_type: EnvType },

    /// Return an environment to the pool (optional - daemon reclaims on death).
    Return { env: PooledEnv },

    /// Get current pool statistics.
    Status,

    /// Ping to check if daemon is alive.
    Ping,

    /// Request daemon shutdown (for clean termination).
    Shutdown,

    /// Flush all pooled environments and rebuild with current settings.
    FlushPool,
}

/// Responses from the daemon to clients.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Response {
    /// Successfully took an environment.
    Env { env: PooledEnv },

    /// No environment available right now.
    Empty,

    /// Environment returned successfully.
    Returned,

    /// Pool statistics.
    Stats { stats: PoolStats },

    /// Pong response to ping.
    Pong,

    /// Shutdown acknowledged.
    ShuttingDown,

    /// Pool flush acknowledged — environments will be rebuilt.
    Flushed,

    /// An error occurred.
    Error { message: String },
}

/// Blob channel request.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "action", rename_all = "snake_case")]
pub enum BlobRequest {
    /// Store a blob. The next frame is the raw binary data.
    Store { media_type: String },
    /// Query the blob HTTP server port.
    GetPort,
}

/// Blob channel response.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum BlobResponse {
    /// Blob stored successfully.
    Stored { hash: String },
    /// Blob server port.
    Port { port: u16 },
    /// Error.
    Error { error: String },
}

/// JSON request on the notebook sync channel.
///
/// These requests are sent with `FrameKind::JsonRequest` and processed
/// server-side to create output manifests with blob store access.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "action", rename_all = "snake_case")]
pub enum NotebookSyncRequest {
    /// Append output to a cell. Server creates manifest and stores hash in CRDT.
    AppendOutput {
        cell_id: String,
        /// Raw Jupyter output as JSON string.
        output_json: String,
    },
    /// Clear outputs for a cell.
    ClearOutputs { cell_id: String },
    /// Set execution count for a cell.
    SetExecutionCount { cell_id: String, count: String },
    /// Mark a cell as currently executing.
    MarkCellRunning { cell_id: String },
    /// Mark a cell as no longer executing.
    MarkCellNotRunning { cell_id: String },

    /// Register a kernel with the daemon.
    ///
    /// The daemon will connect to the kernel's iopub socket and become
    /// the authoritative source for outputs across all windows.
    RegisterKernel {
        /// Path to the Jupyter connection file.
        connection_file: String,
        /// Kernel type (e.g., "python", "deno").
        kernel_type: String,
        /// Environment source label (e.g., "uv:inline", "conda:prewarmed").
        env_source: String,
    },
    /// Unregister the kernel from this room.
    UnregisterKernel {},
    /// Query the currently registered kernel info.
    GetKernelInfo {},
}

/// JSON response from notebook sync server.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "result", rename_all = "snake_case")]
pub enum NotebookSyncResponse {
    /// Output manifest stored successfully.
    OutputStored {
        /// The manifest hash stored in the CRDT.
        hash: String,
    },
    /// Operation completed successfully.
    Ok {},
    /// Operation failed.
    Error { error: String },

    /// Kernel registered successfully. Daemon is now watching iopub.
    KernelRegistered {},
    /// A kernel is already registered for this notebook.
    KernelAlreadyRegistered {
        /// Path to the existing connection file.
        connection_file: String,
        /// Environment source label.
        env_source: String,
        /// Kernel type.
        kernel_type: String,
    },
    /// Kernel info response.
    KernelInfo {
        /// Path to connection file (None if no kernel registered).
        connection_file: Option<String>,
        /// Environment source label.
        env_source: Option<String>,
        /// Kernel type.
        kernel_type: Option<String>,
    },
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn roundtrip_request(req: &Request) -> Request {
        let bytes = serde_json::to_vec(req).unwrap();
        serde_json::from_slice(&bytes).unwrap()
    }

    fn roundtrip_response(resp: &Response) -> Response {
        let bytes = serde_json::to_vec(resp).unwrap();
        serde_json::from_slice(&bytes).unwrap()
    }

    #[test]
    fn test_request_take_uv() {
        let req = Request::Take {
            env_type: EnvType::Uv,
        };
        let json = serde_json::to_string(&req).unwrap();
        assert!(json.contains("take"));
        assert!(json.contains("uv"));

        match roundtrip_request(&req) {
            Request::Take { env_type } => assert_eq!(env_type, EnvType::Uv),
            _ => panic!("unexpected request type"),
        }
    }

    #[test]
    fn test_request_take_conda() {
        let req = Request::Take {
            env_type: EnvType::Conda,
        };
        match roundtrip_request(&req) {
            Request::Take { env_type } => assert_eq!(env_type, EnvType::Conda),
            _ => panic!("unexpected request type"),
        }
    }

    #[test]
    fn test_request_return() {
        let env = PooledEnv {
            env_type: EnvType::Uv,
            venv_path: PathBuf::from("/tmp/test-venv"),
            python_path: PathBuf::from("/tmp/test-venv/bin/python"),
        };
        let req = Request::Return { env: env.clone() };
        match roundtrip_request(&req) {
            Request::Return { env: parsed_env } => {
                assert_eq!(parsed_env.venv_path, env.venv_path);
                assert_eq!(parsed_env.python_path, env.python_path);
            }
            _ => panic!("unexpected request type"),
        }
    }

    #[test]
    fn test_request_status() {
        assert!(matches!(
            roundtrip_request(&Request::Status),
            Request::Status
        ));
    }

    #[test]
    fn test_request_ping() {
        assert!(matches!(roundtrip_request(&Request::Ping), Request::Ping));
    }

    #[test]
    fn test_request_shutdown() {
        assert!(matches!(
            roundtrip_request(&Request::Shutdown),
            Request::Shutdown
        ));
    }

    #[test]
    fn test_request_flush_pool() {
        assert!(matches!(
            roundtrip_request(&Request::FlushPool),
            Request::FlushPool
        ));
    }

    #[test]
    fn test_response_env() {
        let env = PooledEnv {
            env_type: EnvType::Uv,
            venv_path: PathBuf::from("/tmp/test-venv"),
            python_path: PathBuf::from("/tmp/test-venv/bin/python"),
        };
        let resp = Response::Env { env: env.clone() };
        match roundtrip_response(&resp) {
            Response::Env { env: parsed_env } => {
                assert_eq!(parsed_env.venv_path, env.venv_path);
            }
            _ => panic!("unexpected response type"),
        }
    }

    #[test]
    fn test_response_empty() {
        assert!(matches!(
            roundtrip_response(&Response::Empty),
            Response::Empty
        ));
    }

    #[test]
    fn test_response_returned() {
        assert!(matches!(
            roundtrip_response(&Response::Returned),
            Response::Returned
        ));
    }

    #[test]
    fn test_response_stats() {
        let stats = PoolStats {
            uv_available: 3,
            uv_warming: 1,
            conda_available: 2,
            conda_warming: 0,
        };
        let resp = Response::Stats {
            stats: stats.clone(),
        };
        match roundtrip_response(&resp) {
            Response::Stats { stats: s } => {
                assert_eq!(s.uv_available, 3);
                assert_eq!(s.uv_warming, 1);
                assert_eq!(s.conda_available, 2);
                assert_eq!(s.conda_warming, 0);
            }
            _ => panic!("unexpected response type"),
        }
    }

    #[test]
    fn test_response_pong() {
        assert!(matches!(
            roundtrip_response(&Response::Pong),
            Response::Pong
        ));
    }

    #[test]
    fn test_response_shutting_down() {
        assert!(matches!(
            roundtrip_response(&Response::ShuttingDown),
            Response::ShuttingDown
        ));
    }

    #[test]
    fn test_response_flushed() {
        assert!(matches!(
            roundtrip_response(&Response::Flushed),
            Response::Flushed
        ));
    }

    #[test]
    fn test_response_error() {
        let resp = Response::Error {
            message: "test error".to_string(),
        };
        match roundtrip_response(&resp) {
            Response::Error { message } => assert_eq!(message, "test error"),
            _ => panic!("unexpected response type"),
        }
    }

    #[test]
    fn test_invalid_json() {
        let result: Result<Request, _> = serde_json::from_slice(b"not valid json");
        assert!(result.is_err());
    }

    #[test]
    fn test_blob_request_store() {
        let req = BlobRequest::Store {
            media_type: "image/png".into(),
        };
        let json = serde_json::to_string(&req).unwrap();
        assert!(json.contains("store"));
        assert!(json.contains("image/png"));
        let parsed: BlobRequest = serde_json::from_str(&json).unwrap();
        assert!(matches!(parsed, BlobRequest::Store { .. }));
    }

    #[test]
    fn test_blob_request_get_port() {
        let req = BlobRequest::GetPort;
        let json = serde_json::to_string(&req).unwrap();
        assert!(json.contains("get_port"));
    }

    #[test]
    fn test_blob_response_stored() {
        let resp = BlobResponse::Stored {
            hash: "abc123".into(),
        };
        let json = serde_json::to_string(&resp).unwrap();
        assert!(json.contains("abc123"));
    }

    #[test]
    fn test_notebook_sync_request_append_output() {
        let req = NotebookSyncRequest::AppendOutput {
            cell_id: "cell-123".into(),
            output_json: r#"{"output_type":"stream"}"#.into(),
        };
        let json = serde_json::to_string(&req).unwrap();
        assert!(json.contains("append_output"));
        assert!(json.contains("cell-123"));

        let parsed: NotebookSyncRequest = serde_json::from_str(&json).unwrap();
        assert!(matches!(parsed, NotebookSyncRequest::AppendOutput { .. }));
    }

    #[test]
    fn test_notebook_sync_request_clear_outputs() {
        let req = NotebookSyncRequest::ClearOutputs {
            cell_id: "cell-456".into(),
        };
        let json = serde_json::to_string(&req).unwrap();
        assert!(json.contains("clear_outputs"));
        assert!(json.contains("cell-456"));

        let parsed: NotebookSyncRequest = serde_json::from_str(&json).unwrap();
        assert!(matches!(parsed, NotebookSyncRequest::ClearOutputs { .. }));
    }

    #[test]
    fn test_notebook_sync_request_set_execution_count() {
        let req = NotebookSyncRequest::SetExecutionCount {
            cell_id: "cell-789".into(),
            count: "5".into(),
        };
        let json = serde_json::to_string(&req).unwrap();
        assert!(json.contains("set_execution_count"));

        let parsed: NotebookSyncRequest = serde_json::from_str(&json).unwrap();
        assert!(matches!(
            parsed,
            NotebookSyncRequest::SetExecutionCount { .. }
        ));
    }

    #[test]
    fn test_notebook_sync_request_mark_cell_running() {
        let req = NotebookSyncRequest::MarkCellRunning {
            cell_id: "cell-abc".into(),
        };
        let json = serde_json::to_string(&req).unwrap();
        assert!(json.contains("mark_cell_running"));

        let parsed: NotebookSyncRequest = serde_json::from_str(&json).unwrap();
        assert!(matches!(
            parsed,
            NotebookSyncRequest::MarkCellRunning { .. }
        ));
    }

    #[test]
    fn test_notebook_sync_response_output_stored() {
        let resp = NotebookSyncResponse::OutputStored {
            hash: "deadbeef".into(),
        };
        let json = serde_json::to_string(&resp).unwrap();
        assert!(json.contains("output_stored"));
        assert!(json.contains("deadbeef"));

        let parsed: NotebookSyncResponse = serde_json::from_str(&json).unwrap();
        assert!(matches!(parsed, NotebookSyncResponse::OutputStored { .. }));
    }

    #[test]
    fn test_notebook_sync_response_ok() {
        let resp = NotebookSyncResponse::Ok {};
        let json = serde_json::to_string(&resp).unwrap();
        assert!(json.contains("ok"));

        let parsed: NotebookSyncResponse = serde_json::from_str(&json).unwrap();
        assert!(matches!(parsed, NotebookSyncResponse::Ok {}));
    }

    #[test]
    fn test_notebook_sync_response_error() {
        let resp = NotebookSyncResponse::Error {
            error: "something went wrong".into(),
        };
        let json = serde_json::to_string(&resp).unwrap();
        assert!(json.contains("error"));
        assert!(json.contains("something went wrong"));

        let parsed: NotebookSyncResponse = serde_json::from_str(&json).unwrap();
        assert!(matches!(parsed, NotebookSyncResponse::Error { .. }));
    }

    #[test]
    fn test_notebook_sync_request_register_kernel() {
        let req = NotebookSyncRequest::RegisterKernel {
            connection_file: "/tmp/kernel-12345.json".into(),
            kernel_type: "python".into(),
            env_source: "uv:inline".into(),
        };
        let json = serde_json::to_string(&req).unwrap();
        assert!(json.contains("register_kernel"));
        assert!(json.contains("kernel-12345"));
        assert!(json.contains("python"));
        assert!(json.contains("uv:inline"));

        let parsed: NotebookSyncRequest = serde_json::from_str(&json).unwrap();
        assert!(matches!(parsed, NotebookSyncRequest::RegisterKernel { .. }));
    }

    #[test]
    fn test_notebook_sync_request_unregister_kernel() {
        let req = NotebookSyncRequest::UnregisterKernel {};
        let json = serde_json::to_string(&req).unwrap();
        assert!(json.contains("unregister_kernel"));

        let parsed: NotebookSyncRequest = serde_json::from_str(&json).unwrap();
        assert!(matches!(parsed, NotebookSyncRequest::UnregisterKernel {}));
    }

    #[test]
    fn test_notebook_sync_request_get_kernel_info() {
        let req = NotebookSyncRequest::GetKernelInfo {};
        let json = serde_json::to_string(&req).unwrap();
        assert!(json.contains("get_kernel_info"));

        let parsed: NotebookSyncRequest = serde_json::from_str(&json).unwrap();
        assert!(matches!(parsed, NotebookSyncRequest::GetKernelInfo {}));
    }

    #[test]
    fn test_notebook_sync_response_kernel_registered() {
        let resp = NotebookSyncResponse::KernelRegistered {};
        let json = serde_json::to_string(&resp).unwrap();
        assert!(json.contains("kernel_registered"));

        let parsed: NotebookSyncResponse = serde_json::from_str(&json).unwrap();
        assert!(matches!(parsed, NotebookSyncResponse::KernelRegistered {}));
    }

    #[test]
    fn test_notebook_sync_response_kernel_already_registered() {
        let resp = NotebookSyncResponse::KernelAlreadyRegistered {
            connection_file: "/tmp/kernel-99.json".into(),
            env_source: "conda:prewarmed".into(),
            kernel_type: "python".into(),
        };
        let json = serde_json::to_string(&resp).unwrap();
        assert!(json.contains("kernel_already_registered"));
        assert!(json.contains("kernel-99"));

        let parsed: NotebookSyncResponse = serde_json::from_str(&json).unwrap();
        assert!(matches!(
            parsed,
            NotebookSyncResponse::KernelAlreadyRegistered { .. }
        ));
    }

    #[test]
    fn test_notebook_sync_response_kernel_info_some() {
        let resp = NotebookSyncResponse::KernelInfo {
            connection_file: Some("/tmp/kernel-55.json".into()),
            env_source: Some("uv:pyproject".into()),
            kernel_type: Some("python".into()),
        };
        let json = serde_json::to_string(&resp).unwrap();
        assert!(json.contains("kernel_info"));
        assert!(json.contains("kernel-55"));

        let parsed: NotebookSyncResponse = serde_json::from_str(&json).unwrap();
        assert!(matches!(parsed, NotebookSyncResponse::KernelInfo { .. }));
    }

    #[test]
    fn test_notebook_sync_response_kernel_info_none() {
        let resp = NotebookSyncResponse::KernelInfo {
            connection_file: None,
            env_source: None,
            kernel_type: None,
        };
        let json = serde_json::to_string(&resp).unwrap();
        assert!(json.contains("kernel_info"));
        assert!(json.contains("null"));

        let parsed: NotebookSyncResponse = serde_json::from_str(&json).unwrap();
        assert!(matches!(parsed, NotebookSyncResponse::KernelInfo { .. }));
    }
}
