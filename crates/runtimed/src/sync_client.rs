//! Client for the Automerge settings sync service.
//!
//! Each notebook window creates a `SyncClient` that maintains a local
//! Automerge document replica. Changes made locally are sent to the daemon,
//! and changes from other peers arrive as sync messages.

use std::path::PathBuf;
use std::time::Duration;

use automerge::sync::{self, SyncDoc};
use automerge::transaction::Transactable;
use automerge::{AutoCommit, ReadDoc};
use log::info;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};

use crate::settings_doc::SyncedSettings;

/// Error type for sync client operations.
#[derive(Debug, thiserror::Error)]
pub enum SyncClientError {
    #[error("Failed to connect: {0}")]
    ConnectionFailed(#[from] std::io::Error),

    #[error("Sync protocol error: {0}")]
    SyncError(String),

    #[error("Connection timeout")]
    Timeout,

    #[error("Disconnected")]
    Disconnected,
}

/// Client for the Automerge settings sync service.
///
/// Holds a local Automerge document replica that stays in sync with the
/// daemon's canonical copy via the Automerge sync protocol.
pub struct SyncClient<S> {
    doc: AutoCommit,
    peer_state: sync::State,
    stream: S,
}

/// Send a length-prefixed message.
async fn send_framed<W: AsyncWrite + Unpin>(
    writer: &mut W,
    data: &[u8],
) -> std::io::Result<()> {
    let len = (data.len() as u32).to_be_bytes();
    writer.write_all(&len).await?;
    writer.write_all(data).await?;
    writer.flush().await?;
    Ok(())
}

/// Receive a length-prefixed message. Returns `None` on clean disconnect.
async fn recv_framed<R: AsyncRead + Unpin>(
    reader: &mut R,
) -> std::io::Result<Option<Vec<u8>>> {
    let mut len_buf = [0u8; 4];
    match reader.read_exact(&mut len_buf).await {
        Ok(_) => {}
        Err(e) if e.kind() == std::io::ErrorKind::UnexpectedEof => return Ok(None),
        Err(e) => return Err(e),
    }
    let len = u32::from_be_bytes(len_buf) as usize;

    if len > 1_048_576 {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            format!("sync message too large: {} bytes", len),
        ));
    }

    let mut buf = vec![0u8; len];
    reader.read_exact(&mut buf).await?;
    Ok(Some(buf))
}

#[cfg(unix)]
impl SyncClient<tokio::net::UnixStream> {
    /// Connect to the daemon's sync socket and perform initial sync.
    pub async fn connect(socket_path: PathBuf) -> Result<Self, SyncClientError> {
        Self::connect_with_timeout(socket_path, Duration::from_secs(2)).await
    }

    /// Connect with a custom timeout.
    pub async fn connect_with_timeout(
        socket_path: PathBuf,
        timeout: Duration,
    ) -> Result<Self, SyncClientError> {
        let stream = tokio::time::timeout(
            timeout,
            tokio::net::UnixStream::connect(&socket_path),
        )
        .await
        .map_err(|_| SyncClientError::Timeout)?
        .map_err(SyncClientError::ConnectionFailed)?;

        info!("[sync-client] Connected to {:?}", socket_path);

        Self::init(stream).await
    }
}

#[cfg(windows)]
impl SyncClient<tokio::net::windows::named_pipe::NamedPipeClient> {
    /// Connect to the daemon's sync socket and perform initial sync.
    pub async fn connect(socket_path: PathBuf) -> Result<Self, SyncClientError> {
        let pipe_name = socket_path.to_string_lossy().to_string();
        let client = tokio::net::windows::named_pipe::ClientOptions::new()
            .open(&pipe_name)
            .map_err(SyncClientError::ConnectionFailed)?;
        Self::init(client).await
    }
}

impl<S> SyncClient<S>
where
    S: AsyncRead + AsyncWrite + Unpin,
{
    /// Initialize the client by performing the initial sync exchange.
    async fn init(mut stream: S) -> Result<Self, SyncClientError> {
        let mut doc = AutoCommit::new();
        let mut peer_state = sync::State::new();

        // The server sends first — receive and apply
        match recv_framed(&mut stream).await? {
            Some(data) => {
                let message = sync::Message::decode(&data)
                    .map_err(|e| SyncClientError::SyncError(format!("decode: {}", e)))?;
                doc.sync()
                    .receive_sync_message(&mut peer_state, message)
                    .map_err(|e| SyncClientError::SyncError(format!("receive: {}", e)))?;
            }
            None => return Err(SyncClientError::Disconnected),
        }

        // Send our sync message back (to complete the handshake)
        if let Some(msg) = doc.sync().generate_sync_message(&mut peer_state) {
            send_framed(&mut stream, &msg.encode()).await?;
        }

        // There might be more rounds needed — keep going until no more messages
        loop {
            // Try to receive with a short timeout (the server may not have more to say)
            match tokio::time::timeout(Duration::from_millis(100), recv_framed(&mut stream)).await {
                Ok(Ok(Some(data))) => {
                    let message = sync::Message::decode(&data)
                        .map_err(|e| SyncClientError::SyncError(format!("decode: {}", e)))?;
                    doc.sync()
                        .receive_sync_message(&mut peer_state, message)
                        .map_err(|e| SyncClientError::SyncError(format!("receive: {}", e)))?;

                    if let Some(msg) = doc.sync().generate_sync_message(&mut peer_state) {
                        send_framed(&mut stream, &msg.encode()).await?;
                    }
                }
                Ok(Ok(None)) => return Err(SyncClientError::Disconnected),
                Ok(Err(e)) => return Err(SyncClientError::ConnectionFailed(e)),
                Err(_) => break, // Timeout — initial sync is done
            }
        }

        let settings = get_all_from_doc(&doc);
        info!("[sync-client] Initial sync complete: {:?}", settings);

        Ok(Self {
            doc,
            peer_state,
            stream,
        })
    }

    /// Get a snapshot of all settings from the local replica.
    pub fn get_all(&self) -> SyncedSettings {
        get_all_from_doc(&self.doc)
    }

    /// Get a single setting value.
    pub fn get(&self, key: &str) -> Option<String> {
        self.doc
            .get(automerge::ROOT, key)
            .ok()
            .flatten()
            .and_then(|(value, _)| match value {
                automerge::Value::Scalar(s) => match s.as_ref() {
                    automerge::ScalarValue::Str(s) => Some(s.to_string()),
                    _ => None,
                },
                _ => None,
            })
    }

    /// Update a setting and sync the change to the daemon.
    pub async fn put(&mut self, key: &str, value: &str) -> Result<(), SyncClientError> {
        self.doc
            .put(automerge::ROOT, key, value)
            .map_err(|e| SyncClientError::SyncError(format!("put: {}", e)))?;

        // Generate and send sync message
        if let Some(msg) = self.doc.sync().generate_sync_message(&mut self.peer_state) {
            send_framed(&mut self.stream, &msg.encode()).await?;
        }

        Ok(())
    }

    /// Wait for the next settings change from the daemon.
    ///
    /// Blocks until a sync message arrives, applies it, and returns the
    /// updated settings snapshot.
    pub async fn recv_changes(&mut self) -> Result<SyncedSettings, SyncClientError> {
        match recv_framed(&mut self.stream).await? {
            Some(data) => {
                let message = sync::Message::decode(&data)
                    .map_err(|e| SyncClientError::SyncError(format!("decode: {}", e)))?;
                self.doc
                    .sync()
                    .receive_sync_message(&mut self.peer_state, message)
                    .map_err(|e| SyncClientError::SyncError(format!("receive: {}", e)))?;

                // Send ack if needed
                if let Some(msg) = self.doc.sync().generate_sync_message(&mut self.peer_state) {
                    send_framed(&mut self.stream, &msg.encode()).await?;
                }

                Ok(self.get_all())
            }
            None => Err(SyncClientError::Disconnected),
        }
    }
}

/// Extract all settings from an Automerge document.
fn get_all_from_doc(doc: &AutoCommit) -> SyncedSettings {
    let defaults = SyncedSettings::default();

    let get_str = |key: &str| -> Option<String> {
        doc.get(automerge::ROOT, key)
            .ok()
            .flatten()
            .and_then(|(value, _)| match value {
                automerge::Value::Scalar(s) => match s.as_ref() {
                    automerge::ScalarValue::Str(s) => Some(s.to_string()),
                    _ => None,
                },
                _ => None,
            })
    };

    SyncedSettings {
        theme: get_str("theme").unwrap_or(defaults.theme),
        default_runtime: get_str("default_runtime").unwrap_or(defaults.default_runtime),
        default_python_env: get_str("default_python_env").unwrap_or(defaults.default_python_env),
        default_uv_packages: get_str("default_uv_packages")
            .unwrap_or(defaults.default_uv_packages),
        default_conda_packages: get_str("default_conda_packages")
            .unwrap_or(defaults.default_conda_packages),
    }
}

/// Try to connect to the sync daemon and get current settings.
///
/// Returns an error if the daemon is unavailable. Callers should
/// fall back to their own local state (e.g. localStorage) on error
/// rather than silently adopting defaults.
pub async fn try_get_synced_settings() -> Result<SyncedSettings, SyncClientError> {
    #[cfg(unix)]
    {
        let client = SyncClient::connect(crate::default_sync_socket_path()).await?;
        let settings = client.get_all();
        info!("[sync-client] Got settings from daemon: {:?}", settings);
        Ok(settings)
    }

    #[cfg(windows)]
    {
        // TODO: Windows named pipe sync client
        Err(SyncClientError::SyncError(
            "Windows sync not yet implemented".to_string(),
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_get_all_from_empty_doc() {
        let doc = AutoCommit::new();
        let settings = get_all_from_doc(&doc);
        assert_eq!(settings, SyncedSettings::default());
    }

    #[test]
    fn test_get_all_from_populated_doc() {
        let mut doc = AutoCommit::new();
        doc.put(automerge::ROOT, "theme", "dark").unwrap();
        doc.put(automerge::ROOT, "default_runtime", "deno").unwrap();
        doc.put(automerge::ROOT, "default_python_env", "conda")
            .unwrap();

        let settings = get_all_from_doc(&doc);
        assert_eq!(settings.theme, "dark");
        assert_eq!(settings.default_runtime, "deno");
        assert_eq!(settings.default_python_env, "conda");
    }
}
