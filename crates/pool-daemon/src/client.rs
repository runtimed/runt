//! Client for communicating with the pool daemon.
//!
//! Notebook windows use this client to request prewarmed environments
//! from the central daemon.

use std::path::PathBuf;
use std::time::Duration;

use log::{info, warn};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::UnixStream;

use crate::protocol::{Request, Response};
use crate::{default_socket_path, EnvType, PoolStats, PooledEnv};

/// Error type for client operations.
#[derive(Debug, thiserror::Error)]
pub enum ClientError {
    #[error("Failed to connect to daemon: {0}")]
    ConnectionFailed(#[from] std::io::Error),

    #[error("Protocol error: {0}")]
    ProtocolError(String),

    #[error("Daemon returned error: {0}")]
    DaemonError(String),

    #[error("Connection timeout")]
    Timeout,
}

/// Client for the pool daemon.
pub struct PoolClient {
    socket_path: PathBuf,
    connect_timeout: Duration,
}

impl Default for PoolClient {
    fn default() -> Self {
        Self::new(default_socket_path())
    }
}

impl PoolClient {
    /// Create a new client with a custom socket path.
    pub fn new(socket_path: PathBuf) -> Self {
        Self {
            socket_path,
            connect_timeout: Duration::from_secs(2),
        }
    }

    /// Set the connection timeout.
    pub fn with_timeout(mut self, timeout: Duration) -> Self {
        self.connect_timeout = timeout;
        self
    }

    /// Check if the daemon is running.
    pub async fn is_daemon_running(&self) -> bool {
        match self.ping().await {
            Ok(()) => true,
            Err(_) => false,
        }
    }

    /// Ping the daemon to check if it's alive.
    pub async fn ping(&self) -> Result<(), ClientError> {
        let response = self.send_request(Request::Ping).await?;
        match response {
            Response::Pong => Ok(()),
            Response::Error { message } => Err(ClientError::DaemonError(message)),
            _ => Err(ClientError::ProtocolError("Unexpected response".to_string())),
        }
    }

    /// Request an environment from the pool.
    ///
    /// Returns `Ok(Some(env))` if an environment was available,
    /// `Ok(None)` if the pool was empty.
    pub async fn take(&self, env_type: EnvType) -> Result<Option<PooledEnv>, ClientError> {
        let response = self.send_request(Request::Take { env_type }).await?;
        match response {
            Response::Env { env } => {
                info!(
                    "[pool-client] Got {} env from daemon: {:?}",
                    env_type, env.venv_path
                );
                Ok(Some(env))
            }
            Response::Empty => {
                info!("[pool-client] Daemon pool empty for {}", env_type);
                Ok(None)
            }
            Response::Error { message } => Err(ClientError::DaemonError(message)),
            _ => Err(ClientError::ProtocolError("Unexpected response".to_string())),
        }
    }

    /// Return an environment to the pool.
    pub async fn return_env(&self, env: PooledEnv) -> Result<(), ClientError> {
        let response = self.send_request(Request::Return { env }).await?;
        match response {
            Response::Returned => Ok(()),
            Response::Error { message } => Err(ClientError::DaemonError(message)),
            _ => Err(ClientError::ProtocolError("Unexpected response".to_string())),
        }
    }

    /// Get pool statistics.
    pub async fn status(&self) -> Result<PoolStats, ClientError> {
        let response = self.send_request(Request::Status).await?;
        match response {
            Response::Stats { stats } => Ok(stats),
            Response::Error { message } => Err(ClientError::DaemonError(message)),
            _ => Err(ClientError::ProtocolError("Unexpected response".to_string())),
        }
    }

    /// Request daemon shutdown.
    pub async fn shutdown(&self) -> Result<(), ClientError> {
        let response = self.send_request(Request::Shutdown).await?;
        match response {
            Response::ShuttingDown => Ok(()),
            Response::Error { message } => Err(ClientError::DaemonError(message)),
            _ => Err(ClientError::ProtocolError("Unexpected response".to_string())),
        }
    }

    /// Send a request to the daemon and receive a response.
    async fn send_request(&self, request: Request) -> Result<Response, ClientError> {
        let connect_result = tokio::time::timeout(
            self.connect_timeout,
            UnixStream::connect(&self.socket_path),
        )
        .await;

        let stream = match connect_result {
            Ok(Ok(s)) => s,
            Ok(Err(e)) => return Err(ClientError::ConnectionFailed(e)),
            Err(_) => return Err(ClientError::Timeout),
        };

        let (reader, mut writer) = stream.into_split();
        let mut reader = BufReader::new(reader);

        // Send request
        let line = request
            .to_line()
            .map_err(|e| ClientError::ProtocolError(format!("Failed to serialize: {}", e)))?;
        writer
            .write_all(line.as_bytes())
            .await
            .map_err(ClientError::ConnectionFailed)?;

        // Read response
        let mut response_line = String::new();
        reader
            .read_line(&mut response_line)
            .await
            .map_err(ClientError::ConnectionFailed)?;

        Response::from_line(&response_line)
            .map_err(|e| ClientError::ProtocolError(format!("Failed to parse response: {}", e)))
    }
}

/// Try to get an environment from the daemon, falling back gracefully.
///
/// This is a convenience function that:
/// 1. Tries to connect to the daemon
/// 2. If successful, requests an environment
/// 3. If daemon is unavailable or pool is empty, returns None
///
/// This allows notebook code to optionally use the daemon without requiring it.
pub async fn try_get_pooled_env(env_type: EnvType) -> Option<PooledEnv> {
    let client = PoolClient::default();

    match client.take(env_type).await {
        Ok(Some(env)) => Some(env),
        Ok(None) => {
            info!(
                "[pool-client] Daemon pool empty for {}, will create locally",
                env_type
            );
            None
        }
        Err(e) => {
            warn!(
                "[pool-client] Could not connect to daemon ({:?}), will create locally",
                e
            );
            None
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_client_default() {
        let client = PoolClient::default();
        assert!(client.socket_path.to_string_lossy().contains("pool-daemon.sock"));
    }

    #[test]
    fn test_client_custom_path() {
        let client = PoolClient::new(PathBuf::from("/tmp/test.sock"));
        assert_eq!(client.socket_path, PathBuf::from("/tmp/test.sock"));
    }
}
