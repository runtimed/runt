//! Comm channel state tracking for widget synchronization.
//!
//! This module manages the state of active Jupyter comm channels (used by ipywidgets).
//! When a new client connects to a notebook room, the stored comm state is sent to allow
//! the client to reconstruct widget models that were created before it connected.
//!
//! ## Comm Protocol Overview
//!
//! The Jupyter comm protocol uses three message types:
//! - `comm_open`: Creates a new comm channel with initial state
//! - `comm_msg`: Sends updates or custom messages on the channel
//! - `comm_close`: Closes the channel
//!
//! For widgets, the `comm_open` establishes the model with initial state, and
//! `comm_msg` with `method: "update"` sends state deltas.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};

use serde::{Deserialize, Serialize};
use tokio::sync::RwLock;

/// A snapshot of a comm channel's state.
///
/// This is stored in the daemon and sent to newly connected clients so they can
/// reconstruct widget models that were created before they connected.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommSnapshot {
    /// The comm_id (unique identifier for this comm channel).
    pub comm_id: String,

    /// Target name (e.g., "jupyter.widget", "jupyter.widget.version").
    pub target_name: String,

    /// Current state snapshot (merged from all updates).
    /// For widgets, this contains the full model state.
    pub state: serde_json::Value,

    /// Model module (e.g., "@jupyter-widgets/controls", "anywidget").
    /// Extracted from `_model_module` in state for convenience.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model_module: Option<String>,

    /// Model name (e.g., "IntSliderModel", "AnyModel").
    /// Extracted from `_model_name` in state for convenience.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model_name: Option<String>,

    /// Binary buffers associated with this comm (e.g., for images, arrays).
    /// Stored inline for simplicity; large buffers could be moved to blob store.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub buffers: Vec<Vec<u8>>,
}

/// Internal entry with sequence number for ordering.
struct CommEntry {
    snapshot: CommSnapshot,
    seq: u64,
}

/// Thread-safe storage for active comm channels.
///
/// Tracks all active comm channels in a notebook room, allowing new clients
/// to receive the current state and reconstruct widget models.
///
/// Comms are returned in insertion order to ensure deterministic replay,
/// which matters for widgets that reference other widgets (e.g., layouts).
pub struct CommState {
    /// Active comms: comm_id -> (CommSnapshot, sequence_number)
    comms: RwLock<HashMap<String, CommEntry>>,
    /// Counter for insertion order
    next_seq: AtomicU64,
}

impl CommState {
    /// Create a new empty comm state.
    pub fn new() -> Self {
        Self {
            comms: RwLock::new(HashMap::new()),
            next_seq: AtomicU64::new(0),
        }
    }

    /// Handle a `comm_open` message: create new comm entry.
    ///
    /// Extracts model info from the data payload and stores the initial state.
    pub async fn on_comm_open(
        &self,
        comm_id: &str,
        target_name: &str,
        data: &serde_json::Value,
        buffers: Vec<Vec<u8>>,
    ) {
        // Extract state from the data object (ipywidgets puts state in data.state)
        let state = data
            .get("state")
            .cloned()
            .unwrap_or_else(|| serde_json::json!({}));

        // Extract model info from state for convenience
        let model_module = state
            .get("_model_module")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());

        let model_name = state
            .get("_model_name")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());

        let snapshot = CommSnapshot {
            comm_id: comm_id.to_string(),
            target_name: target_name.to_string(),
            state,
            model_module,
            model_name,
            buffers,
        };

        let seq = self.next_seq.fetch_add(1, Ordering::Relaxed);
        let mut comms = self.comms.write().await;
        comms.insert(comm_id.to_string(), CommEntry { snapshot, seq });
    }

    /// Handle a `comm_msg` with `method: "update"`: merge state delta.
    ///
    /// Updates only the keys present in the delta, preserving other state.
    pub async fn on_comm_update(&self, comm_id: &str, state_delta: &serde_json::Value) {
        let mut comms = self.comms.write().await;

        if let Some(entry) = comms.get_mut(comm_id) {
            // Merge delta into existing state
            if let (Some(existing), Some(delta)) = (
                entry.snapshot.state.as_object_mut(),
                state_delta.as_object(),
            ) {
                for (key, value) in delta {
                    existing.insert(key.clone(), value.clone());
                }
            }
        }
        // If comm doesn't exist, ignore the update (might be out-of-order)
    }

    /// Handle a `comm_close` message: remove comm entry.
    pub async fn on_comm_close(&self, comm_id: &str) {
        let mut comms = self.comms.write().await;
        comms.remove(comm_id);
    }

    /// Get all active comm snapshots in insertion order.
    ///
    /// Used to send current state to newly connected clients.
    /// Returns comms sorted by creation order, which ensures widget dependencies
    /// (e.g., layout models referenced by other widgets) are replayed correctly.
    pub async fn get_all(&self) -> Vec<CommSnapshot> {
        let comms = self.comms.read().await;
        let mut entries: Vec<_> = comms.values().collect();
        entries.sort_by_key(|e| e.seq);
        entries.into_iter().map(|e| e.snapshot.clone()).collect()
    }

    /// Clear all comm state.
    ///
    /// Called when the kernel shuts down, as all widgets become invalid.
    pub async fn clear(&self) {
        let mut comms = self.comms.write().await;
        comms.clear();
        self.next_seq.store(0, Ordering::Relaxed);
    }

    /// Check if there are any active comms.
    pub async fn is_empty(&self) -> bool {
        let comms = self.comms.read().await;
        comms.is_empty()
    }
}

impl Default for CommState {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_comm_open_creates_entry() {
        let state = CommState::new();
        let widget_state = serde_json::json!({
            "state": {
                "_model_name": "IntSliderModel",
                "_model_module": "@jupyter-widgets/controls",
                "value": 50,
                "min": 0,
                "max": 100
            }
        });

        state
            .on_comm_open("comm-1", "jupyter.widget", &widget_state, vec![])
            .await;

        let comms = state.get_all().await;
        assert_eq!(comms.len(), 1);
        assert_eq!(comms[0].comm_id, "comm-1");
        assert_eq!(comms[0].target_name, "jupyter.widget");
        assert_eq!(comms[0].model_name, Some("IntSliderModel".to_string()));
        assert_eq!(
            comms[0].model_module,
            Some("@jupyter-widgets/controls".to_string())
        );
        assert_eq!(comms[0].state["value"], 50);
    }

    #[tokio::test]
    async fn test_comm_update_merges_state() {
        let state = CommState::new();
        state
            .on_comm_open(
                "comm-1",
                "jupyter.widget",
                &serde_json::json!({
                    "state": {"value": 0, "min": 0, "max": 100}
                }),
                vec![],
            )
            .await;

        state
            .on_comm_update("comm-1", &serde_json::json!({"value": 50}))
            .await;

        let comms = state.get_all().await;
        assert_eq!(comms[0].state["value"], 50);
        assert_eq!(comms[0].state["min"], 0); // preserved
        assert_eq!(comms[0].state["max"], 100); // preserved
    }

    #[tokio::test]
    async fn test_comm_close_removes_entry() {
        let state = CommState::new();
        state
            .on_comm_open(
                "comm-1",
                "jupyter.widget",
                &serde_json::json!({"state": {}}),
                vec![],
            )
            .await;

        assert!(!state.is_empty().await);
        state.on_comm_close("comm-1").await;
        assert!(state.is_empty().await);
    }

    #[tokio::test]
    async fn test_clear_removes_all_entries() {
        let state = CommState::new();
        state
            .on_comm_open(
                "comm-1",
                "jupyter.widget",
                &serde_json::json!({"state": {}}),
                vec![],
            )
            .await;
        state
            .on_comm_open(
                "comm-2",
                "jupyter.widget",
                &serde_json::json!({"state": {}}),
                vec![],
            )
            .await;

        assert_eq!(state.get_all().await.len(), 2);
        state.clear().await;
        assert!(state.is_empty().await);
    }

    #[tokio::test]
    async fn test_update_nonexistent_comm_is_ignored() {
        let state = CommState::new();

        // Update for a comm that doesn't exist should not panic
        state
            .on_comm_update("nonexistent", &serde_json::json!({"value": 42}))
            .await;

        assert!(state.is_empty().await);
    }

    #[tokio::test]
    async fn test_buffers_are_stored() {
        let state = CommState::new();
        let buffers = vec![vec![1, 2, 3], vec![4, 5, 6]];

        state
            .on_comm_open(
                "comm-1",
                "jupyter.widget",
                &serde_json::json!({"state": {}}),
                buffers.clone(),
            )
            .await;

        let comms = state.get_all().await;
        assert_eq!(comms[0].buffers, buffers);
    }

    #[tokio::test]
    async fn test_get_all_returns_insertion_order() {
        let state = CommState::new();

        // Insert comms in a specific order
        for i in 0..10 {
            state
                .on_comm_open(
                    &format!("comm-{}", i),
                    "jupyter.widget",
                    &serde_json::json!({"state": {"index": i}}),
                    vec![],
                )
                .await;
        }

        // Verify they come back in insertion order
        let comms = state.get_all().await;
        assert_eq!(comms.len(), 10);
        for (i, comm) in comms.iter().enumerate() {
            assert_eq!(comm.comm_id, format!("comm-{}", i));
        }
    }
}
