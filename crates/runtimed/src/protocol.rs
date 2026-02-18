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

    #[test]
    fn test_request_serialization() {
        let req = Request::Take { env_type: EnvType::Uv };
        let line = req.to_line().unwrap();
        assert!(line.ends_with('\n'));
        assert!(line.contains("take"));

        let parsed = Request::from_line(&line).unwrap();
        match parsed {
            Request::Take { env_type } => assert_eq!(env_type, EnvType::Uv),
            _ => panic!("unexpected request type"),
        }
    }

    #[test]
    fn test_response_serialization() {
        let resp = Response::Empty;
        let line = resp.to_line().unwrap();
        assert!(line.ends_with('\n'));

        let parsed = Response::from_line(&line).unwrap();
        assert!(matches!(parsed, Response::Empty));
    }
}
