//! Client for communicating with the pool daemon.
//!
//! Notebook windows use this client to request prewarmed environments
//! from the central daemon.
//!
//! Note: The daemon uses Unix sockets and is only available on Unix platforms.
//! On Windows, functions gracefully return None/errors and the notebook
//! falls back to in-process prewarming.

use std::path::PathBuf;
use std::time::Duration;

use log::{info, warn};

use crate::{EnvType, PooledEnv};

#[cfg(unix)]
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
#[cfg(unix)]
use tokio::net::UnixStream;

#[cfg(unix)]
use crate::protocol::{Request, Response};
#[cfg(unix)]
use crate::{default_socket_path, PoolStats};

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

    #[error("Daemon not supported on this platform")]
    NotSupported,
}

/// Client for the pool daemon.
#[cfg(unix)]
pub struct PoolClient {
    socket_path: PathBuf,
    connect_timeout: Duration,
}

#[cfg(unix)]
impl Default for PoolClient {
    fn default() -> Self {
        Self::new(default_socket_path())
    }
}

#[cfg(unix)]
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
///
/// Note: On Windows, this always returns None as the daemon is not supported.
#[cfg(unix)]
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

/// On Windows, daemon is not supported. Always returns None.
#[cfg(not(unix))]
pub async fn try_get_pooled_env(_env_type: EnvType) -> Option<PooledEnv> {
    info!("[pool-client] Daemon not supported on Windows, using in-process prewarming");
    None
}

/// Ensure the pool daemon is running, installing and starting it if needed.
///
/// This function:
/// 1. Checks if the daemon responds to ping
/// 2. If running, checks version - upgrades if bundled version differs
/// 3. If not responding, checks if the service is installed
/// 4. If not installed, installs the service using the provided binary path
/// 5. Starts the service if not running
/// 6. Waits for the daemon to be ready
///
/// Returns Ok(endpoint) if daemon is running, Err if it couldn't be started.
///
/// Note: On Windows, this returns NotSupported error.
#[cfg(unix)]
pub async fn ensure_daemon_running(
    daemon_binary: Option<std::path::PathBuf>,
) -> Result<String, EnsureDaemonError> {
    use crate::service::ServiceManager;
    use crate::singleton::get_running_daemon_info;

    let client = PoolClient::default();
    let manager = ServiceManager::default();

    // Version of the bundled/calling binary
    let bundled_version = env!("CARGO_PKG_VERSION");

    // First, try to ping the daemon
    if client.ping().await.is_ok() {
        if let Some(info) = get_running_daemon_info() {
            // Check if we need to upgrade
            if info.version != bundled_version {
                info!(
                    "[pool-client] Version mismatch: running={}, bundled={}",
                    info.version, bundled_version
                );

                if let Some(binary_path) = &daemon_binary {
                    if !binary_path.exists() {
                        return Err(EnsureDaemonError::BinaryNotFound(binary_path.clone()));
                    }

                    info!("[pool-client] Upgrading daemon...");
                    manager
                        .upgrade(binary_path)
                        .map_err(|e| EnsureDaemonError::UpgradeFailed(e.to_string()))?;

                    // Wait for upgraded daemon to be ready
                    return wait_for_daemon_ready(&client).await;
                } else {
                    // No binary path provided, can't upgrade - just use existing
                    info!("[pool-client] No binary path provided, using existing daemon");
                }
            }

            info!("[pool-client] Daemon already running at {}", info.endpoint);
            return Ok(info.endpoint);
        }
    }

    info!("[pool-client] Daemon not responding, checking service...");

    // Install if not already installed
    if !manager.is_installed() {
        info!("[pool-client] Service not installed, installing...");

        let binary_path = daemon_binary.ok_or(EnsureDaemonError::NoBinaryPath)?;

        if !binary_path.exists() {
            return Err(EnsureDaemonError::BinaryNotFound(binary_path));
        }

        manager
            .install(&binary_path)
            .map_err(|e| EnsureDaemonError::InstallFailed(e.to_string()))?;
    }

    // Start the service
    info!("[pool-client] Starting service...");
    manager
        .start()
        .map_err(|e| EnsureDaemonError::StartFailed(e.to_string()))?;

    // Wait for daemon to be ready
    wait_for_daemon_ready(&client).await
}

/// Wait for the daemon to become ready (up to 10 seconds).
#[cfg(unix)]
async fn wait_for_daemon_ready(client: &PoolClient) -> Result<String, EnsureDaemonError> {
    use crate::singleton::get_running_daemon_info;

    info!("[pool-client] Waiting for daemon to be ready...");
    for i in 0..20 {
        tokio::time::sleep(Duration::from_millis(500)).await;

        if client.ping().await.is_ok() {
            if let Some(info) = get_running_daemon_info() {
                info!(
                    "[pool-client] Daemon ready at {} (waited {}ms)",
                    info.endpoint,
                    (i + 1) * 500
                );
                return Ok(info.endpoint);
            }
        }
    }

    Err(EnsureDaemonError::Timeout)
}

/// On Windows, daemon is not supported.
#[cfg(not(unix))]
pub async fn ensure_daemon_running(
    _daemon_binary: Option<std::path::PathBuf>,
) -> Result<String, EnsureDaemonError> {
    info!("[pool-client] Daemon not supported on Windows");
    Err(EnsureDaemonError::NotSupported)
}

/// Errors that can occur when ensuring the daemon is running.
#[derive(Debug, thiserror::Error)]
pub enum EnsureDaemonError {
    #[error("No daemon binary path provided for installation")]
    NoBinaryPath,

    #[error("Daemon binary not found at {0}")]
    BinaryNotFound(std::path::PathBuf),

    #[error("Failed to install daemon service: {0}")]
    InstallFailed(String),

    #[error("Failed to start daemon service: {0}")]
    StartFailed(String),

    #[error("Failed to upgrade daemon service: {0}")]
    UpgradeFailed(String),

    #[error("Daemon did not become ready within timeout")]
    Timeout,

    #[error("Daemon not supported on this platform")]
    NotSupported,
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;

    #[test]
    fn test_client_default() {
        let client = PoolClient::default();
        assert!(client.socket_path.to_string_lossy().contains("runtimed.sock"));
    }

    #[test]
    fn test_client_custom_path() {
        let client = PoolClient::new(PathBuf::from("/tmp/test.sock"));
        assert_eq!(client.socket_path, PathBuf::from("/tmp/test.sock"));
    }
}
