//! IPC protocol for pool daemon communication.
//!
//! Messages are newline-delimited JSON (NDJSON) for simplicity.

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

impl Request {
    /// Serialize request to JSON line (with newline terminator).
    pub fn to_line(&self) -> Result<String, serde_json::Error> {
        let mut line = serde_json::to_string(self)?;
        line.push('\n');
        Ok(line)
    }

    /// Parse request from JSON line.
    pub fn from_line(line: &str) -> Result<Self, serde_json::Error> {
        serde_json::from_str(line.trim())
    }
}

impl Response {
    /// Serialize response to JSON line (with newline terminator).
    pub fn to_line(&self) -> Result<String, serde_json::Error> {
        let mut line = serde_json::to_string(self)?;
        line.push('\n');
        Ok(line)
    }

    /// Parse response from JSON line.
    pub fn from_line(line: &str) -> Result<Self, serde_json::Error> {
        serde_json::from_str(line.trim())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn test_request_take_uv() {
        let req = Request::Take {
            env_type: EnvType::Uv,
        };
        let line = req.to_line().unwrap();
        assert!(line.ends_with('\n'));
        assert!(line.contains("take"));
        assert!(line.contains("uv"));

        let parsed = Request::from_line(&line).unwrap();
        match parsed {
            Request::Take { env_type } => assert_eq!(env_type, EnvType::Uv),
            _ => panic!("unexpected request type"),
        }
    }

    #[test]
    fn test_request_take_conda() {
        let req = Request::Take {
            env_type: EnvType::Conda,
        };
        let line = req.to_line().unwrap();
        assert!(line.contains("conda"));

        let parsed = Request::from_line(&line).unwrap();
        match parsed {
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
        let line = req.to_line().unwrap();
        assert!(line.contains("return"));

        let parsed = Request::from_line(&line).unwrap();
        match parsed {
            Request::Return { env: parsed_env } => {
                assert_eq!(parsed_env.venv_path, env.venv_path);
                assert_eq!(parsed_env.python_path, env.python_path);
            }
            _ => panic!("unexpected request type"),
        }
    }

    #[test]
    fn test_request_status() {
        let req = Request::Status;
        let line = req.to_line().unwrap();
        assert!(line.contains("status"));

        let parsed = Request::from_line(&line).unwrap();
        assert!(matches!(parsed, Request::Status));
    }

    #[test]
    fn test_request_ping() {
        let req = Request::Ping;
        let line = req.to_line().unwrap();
        assert!(line.contains("ping"));

        let parsed = Request::from_line(&line).unwrap();
        assert!(matches!(parsed, Request::Ping));
    }

    #[test]
    fn test_request_shutdown() {
        let req = Request::Shutdown;
        let line = req.to_line().unwrap();
        assert!(line.contains("shutdown"));

        let parsed = Request::from_line(&line).unwrap();
        assert!(matches!(parsed, Request::Shutdown));
    }

    #[test]
    fn test_response_env() {
        let env = PooledEnv {
            env_type: EnvType::Uv,
            venv_path: PathBuf::from("/tmp/test-venv"),
            python_path: PathBuf::from("/tmp/test-venv/bin/python"),
        };
        let resp = Response::Env { env: env.clone() };
        let line = resp.to_line().unwrap();
        assert!(line.ends_with('\n'));

        let parsed = Response::from_line(&line).unwrap();
        match parsed {
            Response::Env { env: parsed_env } => {
                assert_eq!(parsed_env.venv_path, env.venv_path);
            }
            _ => panic!("unexpected response type"),
        }
    }

    #[test]
    fn test_response_empty() {
        let resp = Response::Empty;
        let line = resp.to_line().unwrap();
        assert!(line.ends_with('\n'));

        let parsed = Response::from_line(&line).unwrap();
        assert!(matches!(parsed, Response::Empty));
    }

    #[test]
    fn test_response_returned() {
        let resp = Response::Returned;
        let line = resp.to_line().unwrap();

        let parsed = Response::from_line(&line).unwrap();
        assert!(matches!(parsed, Response::Returned));
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
        let line = resp.to_line().unwrap();

        let parsed = Response::from_line(&line).unwrap();
        match parsed {
            Response::Stats { stats: parsed_stats } => {
                assert_eq!(parsed_stats.uv_available, 3);
                assert_eq!(parsed_stats.uv_warming, 1);
                assert_eq!(parsed_stats.conda_available, 2);
                assert_eq!(parsed_stats.conda_warming, 0);
            }
            _ => panic!("unexpected response type"),
        }
    }

    #[test]
    fn test_response_pong() {
        let resp = Response::Pong;
        let line = resp.to_line().unwrap();

        let parsed = Response::from_line(&line).unwrap();
        assert!(matches!(parsed, Response::Pong));
    }

    #[test]
    fn test_response_shutting_down() {
        let resp = Response::ShuttingDown;
        let line = resp.to_line().unwrap();

        let parsed = Response::from_line(&line).unwrap();
        assert!(matches!(parsed, Response::ShuttingDown));
    }

    #[test]
    fn test_request_flush_pool() {
        let req = Request::FlushPool;
        let line = req.to_line().unwrap();
        assert!(line.contains("flush_pool"));

        let parsed = Request::from_line(&line).unwrap();
        assert!(matches!(parsed, Request::FlushPool));
    }

    #[test]
    fn test_response_flushed() {
        let resp = Response::Flushed;
        let line = resp.to_line().unwrap();
        assert!(line.contains("flushed"));

        let parsed = Response::from_line(&line).unwrap();
        assert!(matches!(parsed, Response::Flushed));
    }

    #[test]
    fn test_response_error() {
        let resp = Response::Error {
            message: "test error".to_string(),
        };
        let line = resp.to_line().unwrap();

        let parsed = Response::from_line(&line).unwrap();
        match parsed {
            Response::Error { message } => assert_eq!(message, "test error"),
            _ => panic!("unexpected response type"),
        }
    }

    #[test]
    fn test_invalid_json() {
        let result = Request::from_line("not valid json");
        assert!(result.is_err());
    }

    #[test]
    fn test_whitespace_handling() {
        let req = Request::Ping;
        let line = req.to_line().unwrap();

        // Test with extra whitespace
        let padded = format!("  {}  ", line.trim());
        let parsed = Request::from_line(&padded).unwrap();
        assert!(matches!(parsed, Request::Ping));
    }
}
