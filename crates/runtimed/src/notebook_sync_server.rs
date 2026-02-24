//! Room-based notebook synchronization server.
//!
//! Each open notebook gets a "room" in the daemon. Multiple windows editing
//! the same notebook sync through the room's canonical Automerge document.
//!
//! Follows the same sync protocol pattern as `sync_server.rs` (settings sync)
//! but with per-notebook state managed through rooms.
//!
//! ## Room lifecycle
//!
//! 1. First window opens notebook → daemon creates room, loads persisted doc
//! 2. Client exchanges Automerge sync messages with the room
//! 3. Additional windows join the same room
//! 4. Changes from any peer broadcast to all others in the room
//! 5. When the last peer disconnects, the room is evicted from memory
//!    (the doc is already persisted on every change)
//! 6. Documents persist to `~/.cache/runt/notebook-docs/{hash}.automerge`
//!
//! ## Phase 6: Manifest-based outputs
//!
//! Clients can send JSON requests (via `FrameKind::JsonRequest`) to append
//! outputs. The server creates output manifests with blob store access,
//! stores the manifest hash in the CRDT, and returns the hash to the client.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

use automerge::sync;
use log::{info, warn};
use tokio::io::{AsyncRead, AsyncWrite};
use tokio::sync::{broadcast, Mutex, RwLock};

use crate::blob_store::BlobStore;
use crate::connection::{self, FrameKind};
use crate::notebook_doc::{notebook_doc_filename, NotebookDoc};
use crate::output_store::{create_manifest, store_manifest, DEFAULT_INLINE_THRESHOLD};
use crate::protocol::{NotebookSyncRequest, NotebookSyncResponse};

/// A notebook sync room — holds the canonical document and a broadcast
/// channel for notifying peers of changes.
pub struct NotebookRoom {
    /// The canonical Automerge notebook document.
    pub doc: Arc<RwLock<NotebookDoc>>,
    /// Broadcast channel to notify all peers in this room of changes.
    pub changed_tx: broadcast::Sender<()>,
    /// Persistence path for this room's document.
    pub persist_path: PathBuf,
    /// Number of active peer connections in this room.
    pub active_peers: AtomicUsize,
}

impl NotebookRoom {
    /// Create a new room by loading a persisted document or creating a fresh one.
    pub fn load_or_create(notebook_id: &str, docs_dir: &Path) -> Self {
        let filename = notebook_doc_filename(notebook_id);
        let persist_path = docs_dir.join(filename);
        let doc = NotebookDoc::load_or_create(&persist_path, notebook_id);
        let (changed_tx, _) = broadcast::channel(16);
        Self {
            doc: Arc::new(RwLock::new(doc)),
            changed_tx,
            persist_path,
            active_peers: AtomicUsize::new(0),
        }
    }
}

/// Thread-safe map of notebook rooms, keyed by notebook_id.
pub type NotebookRooms = Arc<Mutex<HashMap<String, Arc<NotebookRoom>>>>;

/// Get or create a room for a notebook.
///
/// The caller must hold the rooms mutex. This function will create a new
/// room (loading from disk if available) if one doesn't exist.
pub fn get_or_create_room(
    rooms: &mut HashMap<String, Arc<NotebookRoom>>,
    notebook_id: &str,
    docs_dir: &Path,
) -> Arc<NotebookRoom> {
    rooms
        .entry(notebook_id.to_string())
        .or_insert_with(|| {
            info!("[notebook-sync] Creating room for {}", notebook_id);
            Arc::new(NotebookRoom::load_or_create(notebook_id, docs_dir))
        })
        .clone()
}

/// Handle a single notebook sync client connection.
///
/// The caller has already consumed the handshake frame and resolved the room.
/// This function runs the Automerge sync protocol:
/// 1. Initial sync: server sends first message
/// 2. Watch loop: wait for changes (from other peers or from this client),
///    exchange sync messages to propagate
///
/// JSON requests (like `AppendOutput`) are handled inline. The server creates
/// output manifests using the blob store and stores hashes in the CRDT.
///
/// When the connection closes (client disconnect or error), the peer count
/// is decremented. If it reaches zero, the room is evicted from the rooms
/// map (the doc has already been persisted on every change).
pub async fn handle_notebook_sync_connection<R, W>(
    mut reader: R,
    mut writer: W,
    room: Arc<NotebookRoom>,
    rooms: NotebookRooms,
    notebook_id: String,
    blob_store: Arc<BlobStore>,
) -> anyhow::Result<()>
where
    R: AsyncRead + Unpin,
    W: AsyncWrite + Unpin,
{
    room.active_peers.fetch_add(1, Ordering::Relaxed);
    let peers = room.active_peers.load(Ordering::Relaxed);
    info!(
        "[notebook-sync] Client connected to room {} ({} peer{})",
        notebook_id,
        peers,
        if peers == 1 { "" } else { "s" }
    );

    let result = run_sync_loop(&mut reader, &mut writer, &room, &blob_store).await;

    // Peer disconnected — decrement and possibly evict the room
    let remaining = room.active_peers.fetch_sub(1, Ordering::Relaxed) - 1;
    if remaining == 0 {
        let mut rooms_guard = rooms.lock().await;
        // Re-check under the lock — another peer may have joined between
        // our decrement and acquiring the lock.
        if room.active_peers.load(Ordering::Relaxed) == 0 {
            rooms_guard.remove(&notebook_id);
            info!(
                "[notebook-sync] Evicted room {} (no remaining peers)",
                notebook_id
            );
        }
    } else {
        info!(
            "[notebook-sync] Client disconnected from room {} ({} peer{} remaining)",
            notebook_id,
            remaining,
            if remaining == 1 { "" } else { "s" }
        );
    }

    result
}

/// Inner sync protocol loop, factored out so the caller can handle
/// peer-count bookkeeping around it.
///
/// Handles two types of frames:
/// - `FrameKind::AutomergeSync`: Standard Automerge sync messages
/// - `FrameKind::JsonRequest`: JSON requests like AppendOutput
async fn run_sync_loop<R, W>(
    reader: &mut R,
    writer: &mut W,
    room: &NotebookRoom,
    blob_store: &BlobStore,
) -> anyhow::Result<()>
where
    R: AsyncRead + Unpin,
    W: AsyncWrite + Unpin,
{
    let mut peer_state = sync::State::new();
    let mut changed_rx = room.changed_tx.subscribe();

    // Phase 1: Initial sync — server sends first
    {
        let mut doc = room.doc.write().await;
        if let Some(msg) = doc.generate_sync_message(&mut peer_state) {
            connection::send_typed_frame(writer, FrameKind::AutomergeSync, &msg.encode()).await?;
        }
    }

    // Phase 2: Exchange messages until sync is complete, then watch for changes
    loop {
        tokio::select! {
            // Incoming message from this client
            result = connection::recv_typed_frame(reader) => {
                match result? {
                    Some((FrameKind::AutomergeSync, data)) => {
                        let message = sync::Message::decode(&data)
                            .map_err(|e| anyhow::anyhow!("decode error: {}", e))?;

                        // Serialize bytes inside the lock, then persist outside it
                        let persist_bytes = {
                            let mut doc = room.doc.write().await;
                            doc.receive_sync_message(&mut peer_state, message)?;

                            let bytes = doc.save();

                            // Notify other peers in this room
                            let _ = room.changed_tx.send(());

                            // Send our response while still holding the lock
                            if let Some(reply) = doc.generate_sync_message(&mut peer_state) {
                                connection::send_typed_frame(
                                    writer,
                                    FrameKind::AutomergeSync,
                                    &reply.encode()
                                ).await?;
                            }

                            bytes
                        };

                        // Persist outside the write lock
                        persist_notebook_bytes(&persist_bytes, &room.persist_path);
                    }
                    Some((FrameKind::JsonRequest, data)) => {
                        // Handle JSON request (append_output, clear_outputs, etc.)
                        let response = handle_json_request(&data, room, blob_store).await;
                        let response_bytes = serde_json::to_vec(&response)?;
                        connection::send_typed_frame(
                            writer,
                            FrameKind::JsonRequest,
                            &response_bytes
                        ).await?;
                    }
                    None => {
                        // Client disconnected
                        return Ok(());
                    }
                }
            }

            // Another peer changed the document — push update to this client
            _ = changed_rx.recv() => {
                let mut doc = room.doc.write().await;
                if let Some(msg) = doc.generate_sync_message(&mut peer_state) {
                    connection::send_typed_frame(
                        writer,
                        FrameKind::AutomergeSync,
                        &msg.encode()
                    ).await?;
                }
            }
        }
    }
}

/// Handle a JSON request from a client.
///
/// For `AppendOutput`: creates an output manifest, stores it in the blob store,
/// and appends the manifest hash to the cell's outputs in the CRDT.
async fn handle_json_request(
    data: &[u8],
    room: &NotebookRoom,
    blob_store: &BlobStore,
) -> NotebookSyncResponse {
    // Parse the request
    let request: NotebookSyncRequest = match serde_json::from_slice(data) {
        Ok(r) => r,
        Err(e) => {
            return NotebookSyncResponse::Error {
                error: format!("invalid JSON request: {}", e),
            }
        }
    };

    match request {
        NotebookSyncRequest::AppendOutput {
            cell_id,
            output_json,
        } => {
            // Parse the output JSON
            let output: serde_json::Value = match serde_json::from_str(&output_json) {
                Ok(v) => v,
                Err(e) => {
                    return NotebookSyncResponse::Error {
                        error: format!("invalid output JSON: {}", e),
                    }
                }
            };

            // Create manifest (handles inlining and blob storage)
            let manifest_json =
                match create_manifest(&output, blob_store, DEFAULT_INLINE_THRESHOLD).await {
                    Ok(m) => m,
                    Err(e) => {
                        return NotebookSyncResponse::Error {
                            error: format!("manifest creation failed: {}", e),
                        }
                    }
                };

            // Store manifest in blob store
            let hash = match store_manifest(&manifest_json, blob_store).await {
                Ok(h) => h,
                Err(e) => {
                    return NotebookSyncResponse::Error {
                        error: format!("manifest storage failed: {}", e),
                    }
                }
            };

            // Append hash to cell outputs in CRDT
            let persist_bytes = {
                let mut doc = room.doc.write().await;
                if let Err(e) = doc.append_output(&cell_id, &hash) {
                    return NotebookSyncResponse::Error {
                        error: format!("CRDT append failed: {}", e),
                    };
                }
                let bytes = doc.save();
                let _ = room.changed_tx.send(());
                bytes
            };

            persist_notebook_bytes(&persist_bytes, &room.persist_path);
            NotebookSyncResponse::OutputStored { hash }
        }

        NotebookSyncRequest::ClearOutputs { cell_id } => {
            let persist_bytes = {
                let mut doc = room.doc.write().await;
                if let Err(e) = doc.clear_outputs(&cell_id) {
                    return NotebookSyncResponse::Error {
                        error: format!("clear outputs failed: {}", e),
                    };
                }
                // Also reset execution count to null (matches pre-execution state)
                if let Err(e) = doc.set_execution_count(&cell_id, "null") {
                    return NotebookSyncResponse::Error {
                        error: format!("reset execution count failed: {}", e),
                    };
                }
                let bytes = doc.save();
                let _ = room.changed_tx.send(());
                bytes
            };
            persist_notebook_bytes(&persist_bytes, &room.persist_path);
            NotebookSyncResponse::Ok {}
        }

        NotebookSyncRequest::SetExecutionCount { cell_id, count } => {
            let persist_bytes = {
                let mut doc = room.doc.write().await;
                if let Err(e) = doc.set_execution_count(&cell_id, &count) {
                    return NotebookSyncResponse::Error {
                        error: format!("set execution count failed: {}", e),
                    };
                }
                let bytes = doc.save();
                let _ = room.changed_tx.send(());
                bytes
            };
            persist_notebook_bytes(&persist_bytes, &room.persist_path);
            NotebookSyncResponse::Ok {}
        }

        NotebookSyncRequest::MarkCellRunning { cell_id } => {
            let persist_bytes = {
                let mut doc = room.doc.write().await;
                if let Err(e) = doc.mark_cell_running(&cell_id) {
                    return NotebookSyncResponse::Error {
                        error: format!("mark cell running failed: {}", e),
                    };
                }
                let bytes = doc.save();
                let _ = room.changed_tx.send(());
                bytes
            };
            persist_notebook_bytes(&persist_bytes, &room.persist_path);
            NotebookSyncResponse::Ok {}
        }

        NotebookSyncRequest::MarkCellNotRunning { cell_id } => {
            let persist_bytes = {
                let mut doc = room.doc.write().await;
                if let Err(e) = doc.mark_cell_not_running(&cell_id) {
                    return NotebookSyncResponse::Error {
                        error: format!("mark cell not running failed: {}", e),
                    };
                }
                let bytes = doc.save();
                let _ = room.changed_tx.send(());
                bytes
            };
            persist_notebook_bytes(&persist_bytes, &room.persist_path);
            NotebookSyncResponse::Ok {}
        }
    }
}

/// Persist pre-serialized notebook bytes to disk.
fn persist_notebook_bytes(data: &[u8], path: &Path) {
    if let Some(parent) = path.parent() {
        if let Err(e) = std::fs::create_dir_all(parent) {
            warn!(
                "[notebook-sync] Failed to create parent dir for {:?}: {}",
                path, e
            );
            return;
        }
    }
    if let Err(e) = std::fs::write(path, data) {
        warn!("[notebook-sync] Failed to save notebook doc: {}", e);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_room_load_or_create_new() {
        let tmp = tempfile::TempDir::new().unwrap();
        let room = NotebookRoom::load_or_create("test-nb", tmp.path());

        let doc = room.doc.try_read().unwrap();
        assert_eq!(doc.notebook_id(), Some("test-nb".to_string()));
        assert_eq!(doc.cell_count(), 0);
        assert_eq!(room.active_peers.load(Ordering::Relaxed), 0);
    }

    #[test]
    fn test_room_persists_and_reloads() {
        let tmp = tempfile::TempDir::new().unwrap();

        // Create room and add a cell
        {
            let room = NotebookRoom::load_or_create("persist-test", tmp.path());
            let mut doc = room.doc.try_write().unwrap();
            doc.add_cell(0, "c1", "code").unwrap();
            doc.update_source("c1", "hello").unwrap();
            let bytes = doc.save();
            persist_notebook_bytes(&bytes, &room.persist_path);
        }

        // Load again — should have the cell
        {
            let room = NotebookRoom::load_or_create("persist-test", tmp.path());
            let doc = room.doc.try_read().unwrap();
            assert_eq!(doc.cell_count(), 1);
            let cell = doc.get_cell("c1").unwrap();
            assert_eq!(cell.source, "hello");
        }
    }

    #[test]
    fn test_get_or_create_room_reuses_existing() {
        let tmp = tempfile::TempDir::new().unwrap();
        let mut rooms = HashMap::new();

        let room1 = get_or_create_room(&mut rooms, "nb1", tmp.path());
        let room2 = get_or_create_room(&mut rooms, "nb1", tmp.path());

        // Should be the same Arc (same room)
        assert!(Arc::ptr_eq(&room1, &room2));
    }

    #[test]
    fn test_get_or_create_room_different_notebooks() {
        let tmp = tempfile::TempDir::new().unwrap();
        let mut rooms = HashMap::new();

        let room1 = get_or_create_room(&mut rooms, "nb1", tmp.path());
        let room2 = get_or_create_room(&mut rooms, "nb2", tmp.path());

        // Should be different rooms
        assert!(!Arc::ptr_eq(&room1, &room2));
        assert_eq!(rooms.len(), 2);
    }

    #[test]
    fn test_room_peer_counting() {
        let tmp = tempfile::TempDir::new().unwrap();
        let room = NotebookRoom::load_or_create("peer-test", tmp.path());

        assert_eq!(room.active_peers.load(Ordering::Relaxed), 0);

        room.active_peers.fetch_add(1, Ordering::Relaxed);
        room.active_peers.fetch_add(1, Ordering::Relaxed);
        assert_eq!(room.active_peers.load(Ordering::Relaxed), 2);

        room.active_peers.fetch_sub(1, Ordering::Relaxed);
        assert_eq!(room.active_peers.load(Ordering::Relaxed), 1);

        room.active_peers.fetch_sub(1, Ordering::Relaxed);
        assert_eq!(room.active_peers.load(Ordering::Relaxed), 0);
    }
}
