//! Automerge sync socket server for settings synchronization.
//!
//! Runs alongside the pool daemon on a separate Unix socket (named pipe on
//! Windows). Each connected client exchanges Automerge sync messages to keep
//! a shared settings document in sync across all notebook windows.
//!
//! Wire protocol: length-prefix framed binary.
//! Each message is `[4-byte big-endian length][payload]` where payload is an
//! encoded `automerge::sync::Message`.

use std::path::PathBuf;
use std::sync::Arc;

use automerge::sync;
use log::{error, info, warn};
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};
use tokio::sync::{broadcast, Mutex, RwLock};

#[cfg(unix)]
use tokio::net::UnixListener;

#[cfg(windows)]
use tokio::net::windows::named_pipe::ServerOptions;

use crate::settings_doc::SettingsDoc;

/// Send a length-prefixed message over a writer.
async fn send_framed<W: AsyncWrite + Unpin>(writer: &mut W, data: &[u8]) -> std::io::Result<()> {
    let len = (data.len() as u32).to_be_bytes();
    writer.write_all(&len).await?;
    writer.write_all(data).await?;
    writer.flush().await?;
    Ok(())
}

/// Receive a length-prefixed message from a reader.
/// Returns `None` on clean disconnect (EOF).
async fn recv_framed<R: AsyncRead + Unpin>(reader: &mut R) -> std::io::Result<Option<Vec<u8>>> {
    let mut len_buf = [0u8; 4];
    match reader.read_exact(&mut len_buf).await {
        Ok(_) => {}
        Err(e) if e.kind() == std::io::ErrorKind::UnexpectedEof => return Ok(None),
        Err(e) => return Err(e),
    }
    let len = u32::from_be_bytes(len_buf) as usize;

    // Sanity check: reject messages larger than 1 MB
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

/// Run the settings sync server.
///
/// Binds to `socket_path`, accepts connections, and runs the Automerge sync
/// protocol with each client. When any client makes a change, all other
/// connected clients are notified via `settings_changed`.
pub async fn run_sync_server(
    socket_path: PathBuf,
    settings: Arc<RwLock<SettingsDoc>>,
    settings_changed: broadcast::Sender<()>,
    shutdown: Arc<Mutex<bool>>,
    shutdown_notify: Arc<tokio::sync::Notify>,
) -> anyhow::Result<()> {
    #[cfg(unix)]
    {
        run_unix_sync_server(
            socket_path,
            settings,
            settings_changed,
            shutdown,
            shutdown_notify,
        )
        .await
    }

    #[cfg(windows)]
    {
        run_windows_sync_server(
            socket_path,
            settings,
            settings_changed,
            shutdown,
            shutdown_notify,
        )
        .await
    }
}

#[cfg(unix)]
async fn run_unix_sync_server(
    socket_path: PathBuf,
    settings: Arc<RwLock<SettingsDoc>>,
    settings_changed: broadcast::Sender<()>,
    shutdown: Arc<Mutex<bool>>,
    shutdown_notify: Arc<tokio::sync::Notify>,
) -> anyhow::Result<()> {
    // Ensure socket directory exists
    if let Some(parent) = socket_path.parent() {
        tokio::fs::create_dir_all(parent).await?;
    }

    // Remove stale socket file
    if socket_path.exists() {
        tokio::fs::remove_file(&socket_path).await?;
    }

    let listener = UnixListener::bind(&socket_path)?;
    info!("[sync] Listening on {:?}", socket_path);

    loop {
        tokio::select! {
            accept_result = listener.accept() => {
                match accept_result {
                    Ok((stream, _)) => {
                        let settings = settings.clone();
                        let changed_tx = settings_changed.clone();
                        let changed_rx = settings_changed.subscribe();
                        tokio::spawn(async move {
                            let (reader, writer) = tokio::io::split(stream);
                            if let Err(e) = handle_sync_connection(
                                reader, writer, settings, changed_tx, changed_rx,
                            ).await {
                                if !is_connection_closed(&e) {
                                    error!("[sync] Connection error: {}", e);
                                }
                            }
                            info!("[sync] Client disconnected");
                        });
                    }
                    Err(e) => {
                        error!("[sync] Accept error: {}", e);
                    }
                }
            }
            _ = shutdown_notify.notified() => {
                if *shutdown.lock().await {
                    info!("[sync] Shutting down");
                    break;
                }
            }
        }
    }

    // Cleanup socket
    tokio::fs::remove_file(&socket_path).await.ok();
    Ok(())
}

#[cfg(windows)]
async fn run_windows_sync_server(
    socket_path: PathBuf,
    settings: Arc<RwLock<SettingsDoc>>,
    settings_changed: broadcast::Sender<()>,
    shutdown: Arc<Mutex<bool>>,
    shutdown_notify: Arc<tokio::sync::Notify>,
) -> anyhow::Result<()> {
    let pipe_name = socket_path.to_string_lossy().to_string();
    info!("[sync] Listening on {}", pipe_name);

    let mut server = ServerOptions::new()
        .first_pipe_instance(true)
        .create(&pipe_name)?;

    loop {
        tokio::select! {
            connect_result = server.connect() => {
                if let Err(e) = connect_result {
                    error!("[sync] Pipe connect error: {}", e);
                    continue;
                }

                let connected = server;
                server = match ServerOptions::new().create(&pipe_name) {
                    Ok(s) => s,
                    Err(e) => {
                        error!("[sync] Failed to create new pipe server: {}", e);
                        match ServerOptions::new().first_pipe_instance(true).create(&pipe_name) {
                            Ok(s) => s,
                            Err(e) => {
                                error!("[sync] Fatal: cannot create pipe server: {}", e);
                                break;
                            }
                        }
                    }
                };

                let settings = settings.clone();
                let changed_tx = settings_changed.clone();
                let changed_rx = settings_changed.subscribe();
                tokio::spawn(async move {
                    let (reader, writer) = tokio::io::split(connected);
                    if let Err(e) = handle_sync_connection(
                        reader, writer, settings, changed_tx, changed_rx,
                    ).await {
                        if !is_connection_closed(&e) {
                            error!("[sync] Connection error: {}", e);
                        }
                    }
                    info!("[sync] Client disconnected");
                });
            }
            _ = shutdown_notify.notified() => {
                if *shutdown.lock().await {
                    info!("[sync] Shutting down");
                    break;
                }
            }
        }
    }

    Ok(())
}

/// Check if an error is just a normal connection close.
fn is_connection_closed(e: &anyhow::Error) -> bool {
    if let Some(io_err) = e.downcast_ref::<std::io::Error>() {
        matches!(
            io_err.kind(),
            std::io::ErrorKind::ConnectionReset
                | std::io::ErrorKind::BrokenPipe
                | std::io::ErrorKind::UnexpectedEof
        )
    } else {
        false
    }
}

/// Handle a single sync client connection.
///
/// Protocol flow:
/// 1. Initial sync: exchange messages until both sides converge
/// 2. Watch loop: wait for changes (from other peers or from this client),
///    exchange sync messages to propagate
async fn handle_sync_connection<R, W>(
    mut reader: R,
    mut writer: W,
    settings: Arc<RwLock<SettingsDoc>>,
    changed_tx: broadcast::Sender<()>,
    mut changed_rx: broadcast::Receiver<()>,
) -> anyhow::Result<()>
where
    R: AsyncRead + Unpin,
    W: AsyncWrite + Unpin,
{
    let mut peer_state = sync::State::new();
    info!("[sync] New client connected, starting initial sync");

    // Phase 1: Initial sync — server sends first
    {
        let mut doc = settings.write().await;
        if let Some(msg) = doc.generate_sync_message(&mut peer_state) {
            send_framed(&mut writer, &msg.encode()).await?;
        }
    }

    // Phase 2: Exchange messages until sync is complete, then watch for changes
    loop {
        tokio::select! {
            // Incoming message from this client
            result = recv_framed(&mut reader) => {
                match result? {
                    Some(data) => {
                        let message = sync::Message::decode(&data)
                            .map_err(|e| anyhow::anyhow!("decode error: {}", e))?;

                        let mut doc = settings.write().await;
                        doc.receive_sync_message(&mut peer_state, message)?;

                        // Persist and notify others
                        persist_settings(&mut doc);
                        let _ = changed_tx.send(());

                        // Send our response
                        if let Some(reply) = doc.generate_sync_message(&mut peer_state) {
                            send_framed(&mut writer, &reply.encode()).await?;
                        }
                    }
                    None => {
                        // Client disconnected
                        return Ok(());
                    }
                }
            }

            // Another peer changed settings — push update to this client
            _ = changed_rx.recv() => {
                let mut doc = settings.write().await;
                if let Some(msg) = doc.generate_sync_message(&mut peer_state) {
                    send_framed(&mut writer, &msg.encode()).await?;
                }
            }
        }
    }
}

/// Persist the settings document to disk (both Automerge binary and JSON mirror).
fn persist_settings(doc: &mut SettingsDoc) {
    let automerge_path = crate::default_settings_doc_path();
    let json_path = crate::settings_json_path();

    if let Err(e) = doc.save_to_file(&automerge_path) {
        warn!("[sync] Failed to save Automerge doc: {}", e);
    }
    if let Err(e) = doc.save_json_mirror(&json_path) {
        warn!("[sync] Failed to write JSON mirror: {}", e);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_framed_roundtrip() {
        let data = b"hello world";

        let mut buf = Vec::new();
        send_framed(&mut buf, data).await.unwrap();

        assert_eq!(buf.len(), 4 + data.len());

        let mut cursor = std::io::Cursor::new(buf);
        let received = recv_framed(&mut cursor).await.unwrap().unwrap();
        assert_eq!(received, data);
    }

    #[tokio::test]
    async fn test_framed_eof() {
        let buf: &[u8] = &[];
        let mut cursor = std::io::Cursor::new(buf);
        let result = recv_framed(&mut cursor).await.unwrap();
        assert!(result.is_none());
    }

    #[tokio::test]
    async fn test_framed_too_large() {
        // Craft a message claiming to be 2 MB
        let len_bytes = (2_000_000u32).to_be_bytes();
        let mut cursor = std::io::Cursor::new(len_bytes.to_vec());
        let result = recv_framed(&mut cursor).await;
        assert!(result.is_err());
    }
}
