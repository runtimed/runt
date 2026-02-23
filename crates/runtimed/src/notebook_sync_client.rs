//! Client for the notebook sync service.
//!
//! Each notebook window creates a `NotebookSyncClient` that maintains a local
//! Automerge document replica of the notebook. Changes made locally are sent
//! to the daemon, and changes from other peers arrive as sync messages.
//!
//! Follows the same pattern as `sync_client.rs` (settings sync client).

use std::path::PathBuf;
use std::time::Duration;

use automerge::sync::{self, SyncDoc};
use automerge::transaction::Transactable;
use automerge::{AutoCommit, ObjType, ReadDoc};
use log::info;
use tokio::io::{AsyncRead, AsyncWrite};

use crate::connection::{self, Handshake};
use crate::notebook_doc::{get_cells_from_doc, CellSnapshot};

/// Error type for notebook sync client operations.
#[derive(Debug, thiserror::Error)]
pub enum NotebookSyncError {
    #[error("Failed to connect: {0}")]
    ConnectionFailed(#[from] std::io::Error),

    #[error("Sync protocol error: {0}")]
    SyncError(String),

    #[error("Connection timeout")]
    Timeout,

    #[error("Disconnected")]
    Disconnected,

    #[error("Cell not found: {0}")]
    CellNotFound(String),
}

/// Client for the notebook sync service.
///
/// Holds a local Automerge document replica that stays in sync with the
/// daemon's canonical copy for a specific notebook.
pub struct NotebookSyncClient<S> {
    doc: AutoCommit,
    peer_state: sync::State,
    stream: S,
    notebook_id: String,
}

#[cfg(unix)]
impl NotebookSyncClient<tokio::net::UnixStream> {
    /// Connect to the daemon and join the notebook room.
    pub async fn connect(
        socket_path: PathBuf,
        notebook_id: String,
    ) -> Result<Self, NotebookSyncError> {
        Self::connect_with_timeout(socket_path, notebook_id, Duration::from_secs(2)).await
    }

    /// Connect with a custom timeout.
    pub async fn connect_with_timeout(
        socket_path: PathBuf,
        notebook_id: String,
        timeout: Duration,
    ) -> Result<Self, NotebookSyncError> {
        let stream = tokio::time::timeout(timeout, tokio::net::UnixStream::connect(&socket_path))
            .await
            .map_err(|_| NotebookSyncError::Timeout)?
            .map_err(NotebookSyncError::ConnectionFailed)?;

        info!(
            "[notebook-sync-client] Connected to {:?} for {}",
            socket_path, notebook_id
        );

        Self::init(stream, notebook_id).await
    }
}

#[cfg(windows)]
impl NotebookSyncClient<tokio::net::windows::named_pipe::NamedPipeClient> {
    /// Connect to the daemon and join the notebook room.
    pub async fn connect(
        socket_path: PathBuf,
        notebook_id: String,
    ) -> Result<Self, NotebookSyncError> {
        let pipe_name = socket_path.to_string_lossy().to_string();
        let client = tokio::net::windows::named_pipe::ClientOptions::new()
            .open(&pipe_name)
            .map_err(NotebookSyncError::ConnectionFailed)?;
        Self::init(client, notebook_id).await
    }
}

impl<S> NotebookSyncClient<S>
where
    S: AsyncRead + AsyncWrite + Unpin,
{
    /// Initialize the client by sending the handshake and performing initial sync.
    async fn init(mut stream: S, notebook_id: String) -> Result<Self, NotebookSyncError> {
        // Send the channel handshake
        connection::send_json_frame(
            &mut stream,
            &Handshake::NotebookSync {
                notebook_id: notebook_id.clone(),
            },
        )
        .await
        .map_err(|e| NotebookSyncError::SyncError(format!("handshake: {}", e)))?;

        let mut doc = AutoCommit::new();
        let mut peer_state = sync::State::new();

        // The server sends first — receive and apply
        match connection::recv_frame(&mut stream).await? {
            Some(data) => {
                let message = sync::Message::decode(&data)
                    .map_err(|e| NotebookSyncError::SyncError(format!("decode: {}", e)))?;
                doc.sync()
                    .receive_sync_message(&mut peer_state, message)
                    .map_err(|e| NotebookSyncError::SyncError(format!("receive: {}", e)))?;
            }
            None => return Err(NotebookSyncError::Disconnected),
        }

        // Send our sync message back
        if let Some(msg) = doc.sync().generate_sync_message(&mut peer_state) {
            connection::send_frame(&mut stream, &msg.encode()).await?;
        }

        // Continue sync rounds until no more messages (short timeout)
        loop {
            match tokio::time::timeout(
                Duration::from_millis(100),
                connection::recv_frame(&mut stream),
            )
            .await
            {
                Ok(Ok(Some(data))) => {
                    let message = sync::Message::decode(&data)
                        .map_err(|e| NotebookSyncError::SyncError(format!("decode: {}", e)))?;
                    doc.sync()
                        .receive_sync_message(&mut peer_state, message)
                        .map_err(|e| NotebookSyncError::SyncError(format!("receive: {}", e)))?;

                    if let Some(msg) = doc.sync().generate_sync_message(&mut peer_state) {
                        connection::send_frame(&mut stream, &msg.encode()).await?;
                    }
                }
                Ok(Ok(None)) => return Err(NotebookSyncError::Disconnected),
                Ok(Err(e)) => return Err(NotebookSyncError::ConnectionFailed(e)),
                Err(_) => break, // Timeout — initial sync is done
            }
        }

        let cells = get_cells_from_doc(&doc);
        info!(
            "[notebook-sync-client] Initial sync complete for {}: {} cells",
            notebook_id,
            cells.len()
        );

        Ok(Self {
            doc,
            peer_state,
            stream,
            notebook_id,
        })
    }

    /// Get the notebook ID this client is syncing.
    pub fn notebook_id(&self) -> &str {
        &self.notebook_id
    }

    // ── Read operations ─────────────────────────────────────────────

    /// Get all cells from the local replica.
    pub fn get_cells(&self) -> Vec<CellSnapshot> {
        get_cells_from_doc(&self.doc)
    }

    /// Get a single cell by ID from the local replica.
    pub fn get_cell(&self, cell_id: &str) -> Option<CellSnapshot> {
        self.get_cells().into_iter().find(|c| c.id == cell_id)
    }

    // ── Write operations (mutate local + sync) ──────────────────────

    /// Add a new cell at the given index and sync to daemon.
    pub async fn add_cell(
        &mut self,
        index: usize,
        cell_id: &str,
        cell_type: &str,
    ) -> Result<(), NotebookSyncError> {
        let cells_id = self
            .ensure_cells_list()
            .map_err(|e| NotebookSyncError::SyncError(format!("ensure cells: {}", e)))?;

        let len = self.doc.length(&cells_id);
        let index = index.min(len);

        let cell_map = self
            .doc
            .insert_object(&cells_id, index, ObjType::Map)
            .map_err(|e| NotebookSyncError::SyncError(format!("insert: {}", e)))?;
        self.doc
            .put(&cell_map, "id", cell_id)
            .map_err(|e| NotebookSyncError::SyncError(format!("put id: {}", e)))?;
        self.doc
            .put(&cell_map, "cell_type", cell_type)
            .map_err(|e| NotebookSyncError::SyncError(format!("put type: {}", e)))?;
        self.doc
            .put_object(&cell_map, "source", ObjType::Text)
            .map_err(|e| NotebookSyncError::SyncError(format!("put source: {}", e)))?;
        self.doc
            .put(&cell_map, "execution_count", "null")
            .map_err(|e| NotebookSyncError::SyncError(format!("put exec_count: {}", e)))?;
        self.doc
            .put_object(&cell_map, "outputs", ObjType::List)
            .map_err(|e| NotebookSyncError::SyncError(format!("put outputs: {}", e)))?;

        self.sync_to_daemon().await
    }

    /// Delete a cell by ID and sync to daemon.
    pub async fn delete_cell(&mut self, cell_id: &str) -> Result<(), NotebookSyncError> {
        let cells_id = match self.cells_list_id() {
            Some(id) => id,
            None => return Err(NotebookSyncError::CellNotFound(cell_id.to_string())),
        };

        let idx = match self.find_cell_index(&cells_id, cell_id) {
            Some(i) => i,
            None => return Err(NotebookSyncError::CellNotFound(cell_id.to_string())),
        };

        self.doc
            .delete(&cells_id, idx)
            .map_err(|e| NotebookSyncError::SyncError(format!("delete: {}", e)))?;

        self.sync_to_daemon().await
    }

    /// Update a cell's source text and sync to daemon.
    pub async fn update_source(
        &mut self,
        cell_id: &str,
        source: &str,
    ) -> Result<(), NotebookSyncError> {
        let cells_id = match self.cells_list_id() {
            Some(id) => id,
            None => return Err(NotebookSyncError::CellNotFound(cell_id.to_string())),
        };
        let idx = match self.find_cell_index(&cells_id, cell_id) {
            Some(i) => i,
            None => return Err(NotebookSyncError::CellNotFound(cell_id.to_string())),
        };
        let cell_obj = match self.cell_at_index(&cells_id, idx) {
            Some(o) => o,
            None => return Err(NotebookSyncError::CellNotFound(cell_id.to_string())),
        };
        let source_id = match self.text_id(&cell_obj, "source") {
            Some(id) => id,
            None => {
                return Err(NotebookSyncError::SyncError(
                    "source Text not found".to_string(),
                ))
            }
        };

        self.doc
            .update_text(&source_id, source)
            .map_err(|e| NotebookSyncError::SyncError(format!("update_text: {}", e)))?;

        self.sync_to_daemon().await
    }

    /// Set outputs for a cell and sync to daemon.
    pub async fn set_outputs(
        &mut self,
        cell_id: &str,
        outputs: &[String],
    ) -> Result<(), NotebookSyncError> {
        let cells_id = match self.cells_list_id() {
            Some(id) => id,
            None => return Err(NotebookSyncError::CellNotFound(cell_id.to_string())),
        };
        let idx = match self.find_cell_index(&cells_id, cell_id) {
            Some(i) => i,
            None => return Err(NotebookSyncError::CellNotFound(cell_id.to_string())),
        };
        let cell_obj = match self.cell_at_index(&cells_id, idx) {
            Some(o) => o,
            None => return Err(NotebookSyncError::CellNotFound(cell_id.to_string())),
        };

        let _ = self.doc.delete(&cell_obj, "outputs");
        let list_id = self
            .doc
            .put_object(&cell_obj, "outputs", ObjType::List)
            .map_err(|e| NotebookSyncError::SyncError(format!("put outputs: {}", e)))?;
        for (i, output) in outputs.iter().enumerate() {
            self.doc
                .insert(&list_id, i, output.as_str())
                .map_err(|e| NotebookSyncError::SyncError(format!("insert output: {}", e)))?;
        }

        self.sync_to_daemon().await
    }

    /// Set execution count for a cell and sync to daemon.
    pub async fn set_execution_count(
        &mut self,
        cell_id: &str,
        count: &str,
    ) -> Result<(), NotebookSyncError> {
        let cells_id = match self.cells_list_id() {
            Some(id) => id,
            None => return Err(NotebookSyncError::CellNotFound(cell_id.to_string())),
        };
        let idx = match self.find_cell_index(&cells_id, cell_id) {
            Some(i) => i,
            None => return Err(NotebookSyncError::CellNotFound(cell_id.to_string())),
        };
        let cell_obj = match self.cell_at_index(&cells_id, idx) {
            Some(o) => o,
            None => return Err(NotebookSyncError::CellNotFound(cell_id.to_string())),
        };

        self.doc
            .put(&cell_obj, "execution_count", count)
            .map_err(|e| NotebookSyncError::SyncError(format!("put: {}", e)))?;

        self.sync_to_daemon().await
    }

    // ── Receiving changes ───────────────────────────────────────────

    /// Wait for the next change from the daemon.
    ///
    /// Blocks until a sync message arrives, applies it, and returns
    /// the updated cells.
    pub async fn recv_changes(&mut self) -> Result<Vec<CellSnapshot>, NotebookSyncError> {
        match connection::recv_frame(&mut self.stream).await? {
            Some(data) => {
                let message = sync::Message::decode(&data)
                    .map_err(|e| NotebookSyncError::SyncError(format!("decode: {}", e)))?;
                self.doc
                    .sync()
                    .receive_sync_message(&mut self.peer_state, message)
                    .map_err(|e| NotebookSyncError::SyncError(format!("receive: {}", e)))?;

                // Send ack if needed
                if let Some(msg) = self.doc.sync().generate_sync_message(&mut self.peer_state) {
                    connection::send_frame(&mut self.stream, &msg.encode()).await?;
                }

                Ok(self.get_cells())
            }
            None => Err(NotebookSyncError::Disconnected),
        }
    }

    // ── Internal helpers ────────────────────────────────────────────

    /// Generate and send sync message to daemon, then wait for the
    /// server's acknowledgment.
    ///
    /// The Automerge sync protocol is bidirectional: after the server
    /// applies our changes, it sends back a sync message confirming
    /// what it now has. By waiting for this reply, callers know the
    /// daemon has processed and persisted the change when the write
    /// method returns.
    async fn sync_to_daemon(&mut self) -> Result<(), NotebookSyncError> {
        // Generate the sync message (drops the mutable borrow on self.doc
        // before we need it again for receiving the reply).
        let encoded = {
            let msg = self.doc.sync().generate_sync_message(&mut self.peer_state);
            msg.map(|m| m.encode())
        };

        if let Some(data) = encoded {
            connection::send_frame(&mut self.stream, &data).await?;

            // Wait for the daemon's ack. The server always sends a reply
            // after processing a client's sync message (to advance the
            // sync state). A short timeout handles the rare case where
            // the server has nothing to send back (already converged).
            match tokio::time::timeout(
                Duration::from_millis(500),
                connection::recv_frame(&mut self.stream),
            )
            .await
            {
                Ok(Ok(Some(reply))) => {
                    let message = sync::Message::decode(&reply)
                        .map_err(|e| NotebookSyncError::SyncError(format!("decode: {}", e)))?;
                    self.doc
                        .sync()
                        .receive_sync_message(&mut self.peer_state, message)
                        .map_err(|e| NotebookSyncError::SyncError(format!("receive: {}", e)))?;
                }
                Ok(Ok(None)) => return Err(NotebookSyncError::Disconnected),
                Ok(Err(e)) => return Err(NotebookSyncError::ConnectionFailed(e)),
                Err(_) => {} // Timeout — server had nothing to send back
            }
        }
        Ok(())
    }

    fn cells_list_id(&self) -> Option<automerge::ObjId> {
        self.doc
            .get(automerge::ROOT, "cells")
            .ok()
            .flatten()
            .and_then(|(value, id)| match value {
                automerge::Value::Object(ObjType::List) => Some(id),
                _ => None,
            })
    }

    fn ensure_cells_list(&mut self) -> Result<automerge::ObjId, automerge::AutomergeError> {
        if let Some(id) = self.cells_list_id() {
            return Ok(id);
        }
        self.doc.put_object(automerge::ROOT, "cells", ObjType::List)
    }

    fn cell_at_index(&self, cells_id: &automerge::ObjId, index: usize) -> Option<automerge::ObjId> {
        self.doc
            .get(cells_id, index)
            .ok()
            .flatten()
            .and_then(|(value, id)| match value {
                automerge::Value::Object(ObjType::Map) => Some(id),
                _ => None,
            })
    }

    fn find_cell_index(&self, cells_id: &automerge::ObjId, cell_id: &str) -> Option<usize> {
        let len = self.doc.length(cells_id);
        for i in 0..len {
            if let Some(cell_obj) = self.cell_at_index(cells_id, i) {
                if self
                    .doc
                    .get(&cell_obj, "id")
                    .ok()
                    .flatten()
                    .and_then(|(v, _)| match v {
                        automerge::Value::Scalar(s) => match s.as_ref() {
                            automerge::ScalarValue::Str(s) => Some(s.to_string()),
                            _ => None,
                        },
                        _ => None,
                    })
                    .as_deref()
                    == Some(cell_id)
                {
                    return Some(i);
                }
            }
        }
        None
    }

    fn text_id(&self, parent: &automerge::ObjId, key: &str) -> Option<automerge::ObjId> {
        self.doc
            .get(parent, key)
            .ok()
            .flatten()
            .and_then(|(value, id)| match value {
                automerge::Value::Object(ObjType::Text) => Some(id),
                _ => None,
            })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_get_cells_from_empty_doc() {
        let doc = AutoCommit::new();
        let cells = get_cells_from_doc(&doc);
        assert!(cells.is_empty());
    }

    #[test]
    fn test_get_cells_from_populated_doc() {
        // Manually build a notebook structure in an AutoCommit
        let mut doc = AutoCommit::new();
        doc.put(automerge::ROOT, "notebook_id", "test").unwrap();
        let cells_id = doc
            .put_object(automerge::ROOT, "cells", ObjType::List)
            .unwrap();

        // Add a code cell
        let cell = doc.insert_object(&cells_id, 0, ObjType::Map).unwrap();
        doc.put(&cell, "id", "c1").unwrap();
        doc.put(&cell, "cell_type", "code").unwrap();
        let source = doc.put_object(&cell, "source", ObjType::Text).unwrap();
        doc.splice_text(&source, 0, 0, "x = 1").unwrap();
        doc.put(&cell, "execution_count", "1").unwrap();
        let outputs = doc.put_object(&cell, "outputs", ObjType::List).unwrap();
        doc.insert(&outputs, 0, r#"{"output_type":"stream"}"#)
            .unwrap();

        let cells = get_cells_from_doc(&doc);
        assert_eq!(cells.len(), 1);
        assert_eq!(cells[0].id, "c1");
        assert_eq!(cells[0].cell_type, "code");
        assert_eq!(cells[0].source, "x = 1");
        assert_eq!(cells[0].execution_count, "1");
        assert_eq!(cells[0].outputs.len(), 1);
    }
}
