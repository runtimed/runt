//! Client for subscribing to daemon runtime state.
//!
//! Unlike settings which use Automerge for bi-directional sync, daemon state
//! is read-only for clients - the daemon is authoritative. This includes
//! ephemeral runtime state like pool health that exists only in memory.

use std::path::PathBuf;
use std::time::Duration;

use log::info;
use serde::{Deserialize, Serialize};
use tokio::io::{AsyncRead, AsyncWrite};

use crate::connection::{self, Handshake};
use crate::PoolError;

/// Error type for daemon state client operations.
#[derive(Debug, thiserror::Error)]
pub enum DaemonStateError {
    #[error("Failed to connect: {0}")]
    ConnectionFailed(#[from] std::io::Error),

    #[error("Protocol error: {0}")]
    ProtocolError(String),

    #[error("Connection timeout")]
    Timeout,

    #[error("Disconnected")]
    Disconnected,
}

/// Synchronized daemon state - ephemeral runtime state from the daemon.
///
/// This is read-only for clients. The daemon updates this state and
/// pushes changes to all subscribers.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct SyncedDaemonState {
    /// Current UV pool error, if any.
    pub uv_error: Option<PoolError>,
    /// Current Conda pool error, if any.
    pub conda_error: Option<PoolError>,
}

/// Client for subscribing to daemon state changes.
///
/// Connects to the daemon, receives the initial state, and then receives
/// updates whenever the state changes.
pub struct DaemonStateClient<S> {
    stream: S,
}

#[cfg(unix)]
impl DaemonStateClient<tokio::net::UnixStream> {
    /// Connect to the daemon and subscribe to state updates.
    pub async fn connect(socket_path: PathBuf) -> Result<Self, DaemonStateError> {
        Self::connect_with_timeout(socket_path, Duration::from_secs(2)).await
    }

    /// Connect with a custom timeout.
    pub async fn connect_with_timeout(
        socket_path: PathBuf,
        timeout: Duration,
    ) -> Result<Self, DaemonStateError> {
        let stream = tokio::time::timeout(timeout, tokio::net::UnixStream::connect(&socket_path))
            .await
            .map_err(|_| DaemonStateError::Timeout)?
            .map_err(DaemonStateError::ConnectionFailed)?;

        info!("[daemon-state-client] Connected to {:?}", socket_path);

        Self::init(stream).await
    }
}

#[cfg(windows)]
impl DaemonStateClient<tokio::net::windows::named_pipe::NamedPipeClient> {
    /// Connect to the daemon and subscribe to state updates.
    pub async fn connect(socket_path: PathBuf) -> Result<Self, DaemonStateError> {
        Self::connect_with_timeout(socket_path, Duration::from_secs(2)).await
    }

    /// Connect with a custom timeout.
    pub async fn connect_with_timeout(
        socket_path: PathBuf,
        timeout: Duration,
    ) -> Result<Self, DaemonStateError> {
        let pipe_name = socket_path.to_string_lossy().to_string();
        const ERROR_PIPE_BUSY: i32 = 231;
        let client = tokio::time::timeout(timeout, async {
            let mut attempts = 0;
            loop {
                match tokio::net::windows::named_pipe::ClientOptions::new().open(&pipe_name) {
                    Ok(client) => return Ok(client),
                    Err(e) if e.raw_os_error() == Some(ERROR_PIPE_BUSY) && attempts < 5 => {
                        attempts += 1;
                        tokio::time::sleep(Duration::from_millis(50)).await;
                    }
                    Err(e) => return Err(e),
                }
            }
        })
        .await
        .map_err(|_| DaemonStateError::Timeout)?
        .map_err(DaemonStateError::ConnectionFailed)?;

        info!("[daemon-state-client] Connected to {:?}", socket_path);

        Self::init(client).await
    }
}

impl<S> DaemonStateClient<S>
where
    S: AsyncRead + AsyncWrite + Unpin,
{
    /// Initialize the connection by sending the handshake.
    async fn init(mut stream: S) -> Result<Self, DaemonStateError> {
        // Send handshake to identify as a daemon state subscriber
        connection::send_json_frame(&mut stream, &Handshake::DaemonStateSubscribe)
            .await
            .map_err(|e| DaemonStateError::ProtocolError(e.to_string()))?;

        Ok(Self { stream })
    }

    /// Receive the next state update from the daemon.
    ///
    /// The first call returns the initial state. Subsequent calls block until
    /// the daemon pushes a state change.
    pub async fn recv(&mut self) -> Result<SyncedDaemonState, DaemonStateError> {
        match connection::recv_json_frame(&mut self.stream).await {
            Ok(Some(state)) => Ok(state),
            Ok(None) => Err(DaemonStateError::Disconnected),
            Err(e) => {
                if e.to_string().contains("eof") || e.to_string().contains("closed") {
                    Err(DaemonStateError::Disconnected)
                } else {
                    Err(DaemonStateError::ProtocolError(e.to_string()))
                }
            }
        }
    }
}
