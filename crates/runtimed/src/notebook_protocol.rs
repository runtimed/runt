//! Notebook sync protocol message types.
//!
//! Defines the complete wire protocol for notebook synchronization between the
//! daemon (single source of truth) and connected clients (Tauri UI, agents, MCP
//! servers, TUI). Messages are JSON with two-level tagging:
//!
//! - Outer: `{"type": "edit", ...}` via `#[serde(tag = "type")]`
//! - Inner: `{"op": "cell_create", ...}` via `#[serde(tag = "op")]` + flatten

use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;

// ─── Shared Enums ────────────────────────────────────────────────────────────

/// The kind of client connecting to the daemon.
/// Determines what operations the client is permitted to perform.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ClientKind {
    Ui,
    Agent,
    Mcp,
    Tui,
    Kernel,
}

/// Jupyter cell types. Pure Jupyter — no sql/ai cell types.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CellType {
    Code,
    Markdown,
    Raw,
}

/// Client activity state for presence.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Activity {
    Editing,
    Viewing,
    Executing,
    Idle,
}

/// Actor type — who or what is performing an action.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ActorType {
    Human,
    RuntimeAgent,
}

/// Cell execution state.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ExecutionState {
    Idle,
    Queued,
    Running,
    Completed,
    Error,
}

/// Runtime session status.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RuntimeStatus {
    Starting,
    Ready,
    Busy,
    Restarting,
    Terminated,
}

/// Execution queue entry status.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum QueueStatus {
    Pending,
    Assigned,
    Executing,
    Completed,
    Failed,
    Cancelled,
}

/// Output type discriminant.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OutputType {
    MultimediaDisplay,
    MultimediaResult,
    Terminal,
    Markdown,
    Error,
}

/// Error codes returned by the daemon.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ErrorCode {
    Unauthorized,
    Conflict,
    NotFound,
    InvalidOp,
    KernelError,
}

/// Execution completion status.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CompletionStatus {
    Success,
    Error,
    Cancelled,
}

// ─── Shared Structs ──────────────────────────────────────────────────────────

/// An actor (user or agent) performing actions.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Actor {
    pub id: String,
    #[serde(rename = "type")]
    pub actor_type: ActorType,
    pub display_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub avatar: Option<String>,
}

/// Cursor position within a cell's source.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct CursorPosition {
    pub line: u32,
    pub ch: u32,
}

/// An incremental text patch for cell source editing.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TextPatch {
    pub pos: u32,
    pub delete: u32,
    pub insert: String,
}

/// Media representation for output MIME data.
///
/// `Inline` for small data (base64 for binary, string for text).
/// `Blob` for large outputs served via HTTP from local blob storage.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum MediaRepresentation {
    Inline {
        data: Value,
        #[serde(skip_serializing_if = "Option::is_none")]
        metadata: Option<Value>,
    },
    Blob {
        blob_path: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        metadata: Option<Value>,
    },
}

/// Error output data from kernel execution.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ErrorOutputData {
    pub ename: String,
    pub evalue: String,
    pub traceback: Vec<String>,
}

/// Runtime capabilities reported on session start.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RuntimeCapabilities {
    pub can_execute_code: bool,
}

/// A cell in a batch execution request.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ExecutionCell {
    pub id: String,
    pub execution_count: u64,
    pub queue_id: String,
}

/// Presence info for a single connected peer.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PeerPresence {
    pub client_kind: ClientKind,
    pub actor: Actor,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub focus_cell: Option<String>,
    pub activity: Activity,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cursor: Option<CursorPosition>,
    #[serde(default)]
    pub custom: Value,
}

// ─── Client → Server Messages ────────────────────────────────────────────────

/// Messages sent from clients to the daemon.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ClientMessage {
    /// Initial handshake. Must be the first message on a new connection.
    Hello {
        client_id: String,
        client_kind: ClientKind,
        client_name: String,
        actor: Actor,
        /// `None` for fresh connect, version number for reconnect.
        #[serde(skip_serializing_if = "Option::is_none")]
        last_version: Option<u64>,
    },

    /// Update presence state. Actor identity comes from the hello handshake.
    Presence {
        #[serde(skip_serializing_if = "Option::is_none")]
        focus_cell: Option<String>,
        activity: Activity,
        #[serde(skip_serializing_if = "Option::is_none")]
        cursor: Option<CursorPosition>,
        #[serde(default)]
        custom: Value,
    },

    /// An edit operation. Wire format: `{"type":"edit","op":"cell_create",...}`
    Edit {
        #[serde(flatten)]
        op: EditOp,
    },

    /// Request a checkpoint (save to disk).
    Checkpoint {},
}

/// Edit operations sent by clients. Nested inside `ClientMessage::Edit`.
///
/// # Security note
///
/// Several variants include actor identity fields (`created_by`, `actor_id`,
/// `modified_by`, `requested_by`, `cancelled_by`). The server MUST NOT trust
/// these values from the wire — it must overwrite them with the authenticated
/// identity established during the `Hello` handshake. Failing to do so allows
/// clients to impersonate other actors.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "op", rename_all = "snake_case")]
pub enum EditOp {
    /// Create a new cell.
    CellCreate {
        id: String,
        cell_type: CellType,
        created_by: String,
        /// Cell ID to insert after, or `None` for beginning.
        after: Option<String>,
    },

    /// Delete a cell.
    CellDelete { id: String, actor_id: String },

    /// Move a cell to a new position.
    CellMove {
        id: String,
        /// Cell ID to move after, or `None` for beginning.
        after: Option<String>,
        actor_id: String,
    },

    /// Replace cell source entirely (last-write-wins).
    CellSourceSet {
        id: String,
        source: String,
        modified_by: String,
    },

    /// Apply incremental patches to cell source.
    CellSourcePatch {
        id: String,
        modified_by: String,
        patches: Vec<TextPatch>,
    },

    /// Change cell type.
    CellTypeChanged { id: String, cell_type: CellType },

    /// Toggle cell source visibility.
    CellSourceVisibility { id: String, visible: bool },

    /// Toggle cell output visibility.
    CellOutputVisibility { id: String, visible: bool },

    /// Set a notebook metadata key-value pair.
    NotebookMetadataSet { key: String, value: String },

    /// Request execution of a single cell.
    ExecutionRequested {
        queue_id: String,
        cell_id: String,
        execution_count: u64,
        requested_by: String,
    },

    /// Request execution of multiple cells.
    MultipleExecutionRequested {
        requested_by: String,
        cells: Vec<ExecutionCell>,
    },

    /// Cancel a queued or running execution.
    ExecutionCancelled {
        queue_id: String,
        cell_id: String,
        cancelled_by: String,
        reason: String,
    },

    /// Cancel all pending/running executions.
    AllExecutionsCancelled {},

    /// Interrupt a running kernel.
    RuntimeInterrupt { session_id: String },

    /// Restart a kernel session.
    RuntimeRestart { session_id: String },

    /// Shut down a kernel session.
    RuntimeShutdown { session_id: String },

    /// Send a comm message to the kernel (widget interaction).
    CommMsg {
        comm_id: String,
        data: Value,
        #[serde(default)]
        buffers: u32,
    },
}

// ─── Server → Client Messages ────────────────────────────────────────────────

/// Messages sent from the daemon to clients.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ServerMessage {
    /// Sent after a successful hello. Contains full state or catch-up deltas.
    Welcome {
        client_id: String,
        version: u64,
        snapshot: Box<NotebookSnapshot>,
        #[serde(default)]
        catch_up: Vec<DeltaEvent>,
        #[serde(default)]
        presence: HashMap<String, PeerPresence>,
    },

    /// Full presence state broadcast. Sent on any presence change.
    PresenceState {
        peers: HashMap<String, PeerPresence>,
    },

    /// A versioned delta broadcast to all clients.
    Delta {
        #[serde(flatten)]
        event: DeltaEvent,
    },

    /// Error response to a client edit.
    Error {
        /// Correlation ID from the original message.
        #[serde(rename = "ref", skip_serializing_if = "Option::is_none")]
        ref_id: Option<String>,
        code: ErrorCode,
        message: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        cell_id: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        current_source: Option<String>,
    },

    /// Checkpoint completed.
    Checkpointed { version: u64 },
}

/// A versioned delta event. Used both as a standalone `ServerMessage::Delta`
/// and inside `Welcome.catch_up`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DeltaEvent {
    pub version: u64,
    pub timestamp: String,
    pub origin: String,
    #[serde(flatten)]
    pub op: DeltaOp,
}

/// Delta operations broadcast by the daemon.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "op", rename_all = "snake_case")]
pub enum DeltaOp {
    // ── Cell structure ──────────────────────────────────────────────────

    CellCreated {
        id: String,
        cell_type: CellType,
        created_by: String,
        after: Option<String>,
        fractional_index: String,
    },

    CellDeleted {
        id: String,
        actor_id: String,
    },

    CellMoved {
        id: String,
        after: Option<String>,
        actor_id: String,
        fractional_index: String,
    },

    CellSourceSet {
        id: String,
        source: String,
        modified_by: String,
    },

    CellSourcePatched {
        id: String,
        modified_by: String,
        patches: Vec<TextPatch>,
    },

    CellTypeChanged {
        id: String,
        cell_type: CellType,
    },

    CellSourceVisibility {
        id: String,
        visible: bool,
    },

    CellOutputVisibility {
        id: String,
        visible: bool,
    },

    NotebookMetadataSet {
        key: String,
        value: String,
    },

    // ── Output deltas (from kernel execution) ───────────────────────────

    TerminalOutputAdded {
        id: String,
        cell_id: String,
        position: f64,
        stream_name: String,
        data: String,
    },

    TerminalOutputAppended {
        id: String,
        output_id: String,
        delta: String,
        sequence_number: u64,
    },

    MultimediaDisplayAdded {
        id: String,
        cell_id: String,
        position: f64,
        #[serde(skip_serializing_if = "Option::is_none")]
        display_id: Option<String>,
        representations: HashMap<String, MediaRepresentation>,
    },

    MultimediaDisplayUpdated {
        display_id: String,
        representations: HashMap<String, MediaRepresentation>,
    },

    MultimediaResultAdded {
        id: String,
        cell_id: String,
        position: f64,
        execution_count: u64,
        representations: HashMap<String, MediaRepresentation>,
    },

    ErrorOutputAdded {
        id: String,
        cell_id: String,
        position: f64,
        data: ErrorOutputData,
    },

    CellOutputsCleared {
        cell_id: String,
        #[serde(default)]
        wait: bool,
    },

    AllOutputsCleared {},

    // ── Execution lifecycle ──────────────────────────────────────────────

    ExecutionAssigned {
        queue_id: String,
        runtime_session_id: String,
    },

    ExecutionStarted {
        queue_id: String,
        cell_id: String,
        runtime_session_id: String,
        started_at: String,
    },

    ExecutionCompleted {
        queue_id: String,
        cell_id: String,
        status: CompletionStatus,
        #[serde(skip_serializing_if = "Option::is_none")]
        execution_duration_ms: Option<u64>,
    },

    // ── Runtime session (daemon-originated, informational) ──────────────

    RuntimeSessionStarted {
        session_id: String,
        runtime_id: String,
        runtime_type: String,
        capabilities: RuntimeCapabilities,
    },

    RuntimeSessionStatusChanged {
        session_id: String,
        status: RuntimeStatus,
    },

    RuntimeSessionRenewal {
        session_id: String,
        renewed_at: String,
        valid_for_ms: u64,
    },

    RuntimeSessionTerminated {
        session_id: String,
        reason: String,
    },

    // ── Comm/widget (daemon relays between kernel and UI clients) ───────

    CommOpen {
        comm_id: String,
        target_name: String,
        data: Value,
        #[serde(default)]
        buffers: u32,
    },

    CommMsg {
        comm_id: String,
        data: Value,
        #[serde(default)]
        buffers: u32,
    },

    CommClose {
        comm_id: String,
        data: Value,
    },
}

// ─── Snapshot Types ──────────────────────────────────────────────────────────

/// Full materialized notebook state, sent in `Welcome` on fresh connect.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct NotebookSnapshot {
    pub version: u64,
    #[serde(default)]
    pub metadata: HashMap<String, String>,
    #[serde(default)]
    pub cells: Vec<CellSnapshot>,
    #[serde(default)]
    pub outputs: HashMap<String, Vec<OutputSnapshot>>,
    #[serde(default)]
    pub output_deltas: HashMap<String, Vec<OutputDeltaSnapshot>>,
    #[serde(default)]
    pub comms: HashMap<String, CommSnapshot>,
    #[serde(default)]
    pub runtime_sessions: Vec<RuntimeSessionSnapshot>,
    #[serde(default)]
    pub execution_queue: Vec<QueueEntrySnapshot>,
    #[serde(default)]
    pub actors: Vec<Actor>,
}

/// A cell in the snapshot.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CellSnapshot {
    pub id: String,
    pub cell_type: CellType,
    pub source: String,
    pub fractional_index: String,
    #[serde(default)]
    pub execution_state: ExecutionState,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub execution_count: Option<u64>,
    #[serde(default = "default_true")]
    pub source_visible: bool,
    #[serde(default = "default_true")]
    pub output_visible: bool,
    pub created_by: String,
}

fn default_true() -> bool {
    true
}

impl Default for ExecutionState {
    fn default() -> Self {
        Self::Idle
    }
}

/// An output in the snapshot.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct OutputSnapshot {
    pub id: String,
    pub output_type: OutputType,
    pub position: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mime_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub representations: Option<HashMap<String, MediaRepresentation>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub execution_count: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub display_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stream_name: Option<String>,
}

/// A streaming delta for an output (e.g. terminal append).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct OutputDeltaSnapshot {
    pub id: String,
    pub delta: String,
    pub sequence_number: u64,
}

/// Accumulated comm/widget state.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CommSnapshot {
    pub target_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cell_id: Option<String>,
    pub state: Value,
    #[serde(default)]
    pub buffer_paths: Vec<Vec<String>>,
}

/// A runtime session in the snapshot.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RuntimeSessionSnapshot {
    pub session_id: String,
    pub runtime_id: String,
    pub runtime_type: String,
    pub status: RuntimeStatus,
    #[serde(default)]
    pub is_active: bool,
    #[serde(default)]
    pub can_execute_code: bool,
}

/// An execution queue entry in the snapshot.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct QueueEntrySnapshot {
    pub id: String,
    pub cell_id: String,
    pub execution_count: u64,
    pub requested_by: String,
    pub status: QueueStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub assigned_runtime_session: Option<String>,
}

// ─── Permission Methods ──────────────────────────────────────────────────────

impl ClientKind {
    /// Can this client create, delete, move, or modify cells?
    pub fn can_edit_cells(&self) -> bool {
        !matches!(self, Self::Kernel)
    }

    /// Can this client emit output deltas (terminal, multimedia, error)?
    pub fn can_emit_outputs(&self) -> bool {
        matches!(self, Self::Kernel | Self::Agent)
    }

    /// Can this client manage runtime sessions (start, restart, shutdown)?
    pub fn can_manage_runtime(&self) -> bool {
        matches!(self, Self::Agent)
    }

    /// Can this client request cell execution?
    pub fn can_request_execution(&self) -> bool {
        !matches!(self, Self::Kernel)
    }

    /// Can this client send comm messages to the kernel (widget interaction)?
    pub fn can_send_comm_to_kernel(&self) -> bool {
        matches!(self, Self::Ui | Self::Agent | Self::Mcp)
    }

    /// Can this client emit comm messages from the kernel side?
    pub fn can_emit_comm_from_kernel(&self) -> bool {
        matches!(self, Self::Kernel)
    }

    /// Can this client set notebook metadata?
    pub fn can_set_metadata(&self) -> bool {
        matches!(self, Self::Ui | Self::Agent | Self::Mcp)
    }

    /// Can this client request a checkpoint?
    pub fn can_checkpoint(&self) -> bool {
        matches!(self, Self::Ui | Self::Agent | Self::Mcp)
    }

    /// Can this client update presence?
    pub fn can_update_presence(&self) -> bool {
        !matches!(self, Self::Kernel)
    }
}

// ─── Serialization Helpers ───────────────────────────────────────────────────

impl ClientMessage {
    /// Serialize to JSON string.
    pub fn to_json(&self) -> Result<String, serde_json::Error> {
        serde_json::to_string(self)
    }

    /// Parse from JSON string.
    pub fn from_json(json: &str) -> Result<Self, serde_json::Error> {
        serde_json::from_str(json)
    }
}

impl ServerMessage {
    /// Serialize to JSON string.
    pub fn to_json(&self) -> Result<String, serde_json::Error> {
        serde_json::to_string(self)
    }

    /// Parse from JSON string.
    pub fn from_json(json: &str) -> Result<Self, serde_json::Error> {
        serde_json::from_str(json)
    }
}

// ─── Tests ───────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn test_actor() -> Actor {
        Actor {
            id: "user-123".into(),
            actor_type: ActorType::Human,
            display_name: "Kyle".into(),
            avatar: None,
        }
    }

    // ── ClientMessage roundtrips ────────────────────────────────────────

    #[test]
    fn test_hello_roundtrip() {
        let msg = ClientMessage::Hello {
            client_id: "tauri-ui-1".into(),
            client_kind: ClientKind::Ui,
            client_name: "Anode UI".into(),
            actor: test_actor(),
            last_version: None,
        };
        let json = msg.to_json().unwrap();
        let parsed = ClientMessage::from_json(&json).unwrap();
        assert_eq!(msg, parsed);
    }

    #[test]
    fn test_hello_with_last_version() {
        let msg = ClientMessage::Hello {
            client_id: "agent-1".into(),
            client_kind: ClientKind::Agent,
            client_name: "Test Agent".into(),
            actor: Actor {
                id: "agent-1".into(),
                actor_type: ActorType::RuntimeAgent,
                display_name: "Agent".into(),
                avatar: Some("https://example.com/avatar.png".into()),
            },
            last_version: Some(42),
        };
        let json = msg.to_json().unwrap();
        let parsed = ClientMessage::from_json(&json).unwrap();
        assert_eq!(msg, parsed);
    }

    #[test]
    fn test_presence_roundtrip() {
        let msg = ClientMessage::Presence {
            focus_cell: Some("cell_03".into()),
            activity: Activity::Editing,
            cursor: Some(CursorPosition { line: 5, ch: 12 }),
            custom: Value::Object(serde_json::Map::new()),
        };
        let json = msg.to_json().unwrap();
        let parsed = ClientMessage::from_json(&json).unwrap();
        assert_eq!(msg, parsed);
    }

    #[test]
    fn test_checkpoint_roundtrip() {
        let msg = ClientMessage::Checkpoint {};
        let json = msg.to_json().unwrap();
        let parsed = ClientMessage::from_json(&json).unwrap();
        assert_eq!(msg, parsed);
    }

    // ── EditOp roundtrips ───────────────────────────────────────────────

    #[test]
    fn test_cell_create_roundtrip() {
        let msg = ClientMessage::Edit {
            op: EditOp::CellCreate {
                id: "cell_01".into(),
                cell_type: CellType::Code,
                created_by: "user-123".into(),
                after: None,
            },
        };
        let json = msg.to_json().unwrap();
        let parsed = ClientMessage::from_json(&json).unwrap();
        assert_eq!(msg, parsed);
    }

    #[test]
    fn test_cell_create_after_roundtrip() {
        let msg = ClientMessage::Edit {
            op: EditOp::CellCreate {
                id: "cell_02".into(),
                cell_type: CellType::Markdown,
                created_by: "user-123".into(),
                after: Some("cell_01".into()),
            },
        };
        let json = msg.to_json().unwrap();
        let parsed = ClientMessage::from_json(&json).unwrap();
        assert_eq!(msg, parsed);
    }

    #[test]
    fn test_cell_delete_roundtrip() {
        let msg = ClientMessage::Edit {
            op: EditOp::CellDelete {
                id: "cell_01".into(),
                actor_id: "user-123".into(),
            },
        };
        let json = msg.to_json().unwrap();
        let parsed = ClientMessage::from_json(&json).unwrap();
        assert_eq!(msg, parsed);
    }

    #[test]
    fn test_cell_move_roundtrip() {
        let msg = ClientMessage::Edit {
            op: EditOp::CellMove {
                id: "cell_03".into(),
                after: Some("cell_01".into()),
                actor_id: "user-123".into(),
            },
        };
        let json = msg.to_json().unwrap();
        let parsed = ClientMessage::from_json(&json).unwrap();
        assert_eq!(msg, parsed);
    }

    #[test]
    fn test_cell_source_set_roundtrip() {
        let msg = ClientMessage::Edit {
            op: EditOp::CellSourceSet {
                id: "cell_01".into(),
                source: "import numpy as np\n".into(),
                modified_by: "user-123".into(),
            },
        };
        let json = msg.to_json().unwrap();
        let parsed = ClientMessage::from_json(&json).unwrap();
        assert_eq!(msg, parsed);
    }

    #[test]
    fn test_cell_source_patch_roundtrip() {
        let msg = ClientMessage::Edit {
            op: EditOp::CellSourcePatch {
                id: "cell_01".into(),
                modified_by: "user-123".into(),
                patches: vec![
                    TextPatch {
                        pos: 0,
                        delete: 0,
                        insert: "import ".into(),
                    },
                    TextPatch {
                        pos: 14,
                        delete: 3,
                        insert: "numpy".into(),
                    },
                ],
            },
        };
        let json = msg.to_json().unwrap();
        let parsed = ClientMessage::from_json(&json).unwrap();
        assert_eq!(msg, parsed);
    }

    #[test]
    fn test_cell_type_changed_roundtrip() {
        let msg = ClientMessage::Edit {
            op: EditOp::CellTypeChanged {
                id: "cell_01".into(),
                cell_type: CellType::Markdown,
            },
        };
        let json = msg.to_json().unwrap();
        let parsed = ClientMessage::from_json(&json).unwrap();
        assert_eq!(msg, parsed);
    }

    #[test]
    fn test_cell_source_visibility_roundtrip() {
        let msg = ClientMessage::Edit {
            op: EditOp::CellSourceVisibility {
                id: "cell_01".into(),
                visible: false,
            },
        };
        let json = msg.to_json().unwrap();
        let parsed = ClientMessage::from_json(&json).unwrap();
        assert_eq!(msg, parsed);
    }

    #[test]
    fn test_cell_output_visibility_roundtrip() {
        let msg = ClientMessage::Edit {
            op: EditOp::CellOutputVisibility {
                id: "cell_01".into(),
                visible: true,
            },
        };
        let json = msg.to_json().unwrap();
        let parsed = ClientMessage::from_json(&json).unwrap();
        assert_eq!(msg, parsed);
    }

    #[test]
    fn test_notebook_metadata_set_roundtrip() {
        let msg = ClientMessage::Edit {
            op: EditOp::NotebookMetadataSet {
                key: "title".into(),
                value: "My Notebook".into(),
            },
        };
        let json = msg.to_json().unwrap();
        let parsed = ClientMessage::from_json(&json).unwrap();
        assert_eq!(msg, parsed);
    }

    #[test]
    fn test_execution_requested_roundtrip() {
        let msg = ClientMessage::Edit {
            op: EditOp::ExecutionRequested {
                queue_id: "q_01".into(),
                cell_id: "cell_01".into(),
                execution_count: 5,
                requested_by: "user-123".into(),
            },
        };
        let json = msg.to_json().unwrap();
        let parsed = ClientMessage::from_json(&json).unwrap();
        assert_eq!(msg, parsed);
    }

    #[test]
    fn test_multiple_execution_requested_roundtrip() {
        let msg = ClientMessage::Edit {
            op: EditOp::MultipleExecutionRequested {
                requested_by: "user-123".into(),
                cells: vec![
                    ExecutionCell {
                        id: "cell_01".into(),
                        execution_count: 2,
                        queue_id: "q_01".into(),
                    },
                    ExecutionCell {
                        id: "cell_02".into(),
                        execution_count: 1,
                        queue_id: "q_02".into(),
                    },
                ],
            },
        };
        let json = msg.to_json().unwrap();
        let parsed = ClientMessage::from_json(&json).unwrap();
        assert_eq!(msg, parsed);
    }

    #[test]
    fn test_execution_cancelled_roundtrip() {
        let msg = ClientMessage::Edit {
            op: EditOp::ExecutionCancelled {
                queue_id: "q_01".into(),
                cell_id: "cell_01".into(),
                cancelled_by: "user-123".into(),
                reason: "user requested".into(),
            },
        };
        let json = msg.to_json().unwrap();
        let parsed = ClientMessage::from_json(&json).unwrap();
        assert_eq!(msg, parsed);
    }

    #[test]
    fn test_all_executions_cancelled_roundtrip() {
        let msg = ClientMessage::Edit {
            op: EditOp::AllExecutionsCancelled {},
        };
        let json = msg.to_json().unwrap();
        let parsed = ClientMessage::from_json(&json).unwrap();
        assert_eq!(msg, parsed);
    }

    #[test]
    fn test_runtime_interrupt_roundtrip() {
        let msg = ClientMessage::Edit {
            op: EditOp::RuntimeInterrupt {
                session_id: "session_01".into(),
            },
        };
        let json = msg.to_json().unwrap();
        let parsed = ClientMessage::from_json(&json).unwrap();
        assert_eq!(msg, parsed);
    }

    #[test]
    fn test_runtime_restart_roundtrip() {
        let msg = ClientMessage::Edit {
            op: EditOp::RuntimeRestart {
                session_id: "session_01".into(),
            },
        };
        let json = msg.to_json().unwrap();
        let parsed = ClientMessage::from_json(&json).unwrap();
        assert_eq!(msg, parsed);
    }

    #[test]
    fn test_runtime_shutdown_roundtrip() {
        let msg = ClientMessage::Edit {
            op: EditOp::RuntimeShutdown {
                session_id: "session_01".into(),
            },
        };
        let json = msg.to_json().unwrap();
        let parsed = ClientMessage::from_json(&json).unwrap();
        assert_eq!(msg, parsed);
    }

    #[test]
    fn test_comm_msg_edit_roundtrip() {
        let msg = ClientMessage::Edit {
            op: EditOp::CommMsg {
                comm_id: "comm_01".into(),
                data: serde_json::json!({"method": "update", "state": {"index": 3}}),
                buffers: 0,
            },
        };
        let json = msg.to_json().unwrap();
        let parsed = ClientMessage::from_json(&json).unwrap();
        assert_eq!(msg, parsed);
    }

    // ── Wire format shape ───────────────────────────────────────────────

    #[test]
    fn test_edit_wire_format_has_type_and_op() {
        let msg = ClientMessage::Edit {
            op: EditOp::CellCreate {
                id: "cell_01".into(),
                cell_type: CellType::Code,
                created_by: "user-123".into(),
                after: None,
            },
        };
        let json = msg.to_json().unwrap();
        let v: Value = serde_json::from_str(&json).unwrap();
        assert_eq!(v["type"], "edit");
        assert_eq!(v["op"], "cell_create");
        assert_eq!(v["id"], "cell_01");
        assert_eq!(v["cell_type"], "code");
    }

    #[test]
    fn test_hello_wire_format() {
        let msg = ClientMessage::Hello {
            client_id: "tauri-ui-1".into(),
            client_kind: ClientKind::Ui,
            client_name: "Anode UI".into(),
            actor: test_actor(),
            last_version: None,
        };
        let json = msg.to_json().unwrap();
        let v: Value = serde_json::from_str(&json).unwrap();
        assert_eq!(v["type"], "hello");
        assert_eq!(v["client_id"], "tauri-ui-1");
        assert_eq!(v["client_kind"], "ui");
        assert_eq!(v["actor"]["type"], "human");
        assert_eq!(v["actor"]["display_name"], "Kyle");
    }

    #[test]
    fn test_checkpoint_wire_format() {
        let msg = ClientMessage::Checkpoint {};
        let json = msg.to_json().unwrap();
        let v: Value = serde_json::from_str(&json).unwrap();
        assert_eq!(v["type"], "checkpoint");
    }

    #[test]
    fn test_delta_wire_format() {
        let msg = ServerMessage::Delta {
            event: DeltaEvent {
                version: 848,
                timestamp: "2026-02-20T15:30:00.123Z".into(),
                origin: "user-123".into(),
                op: DeltaOp::CellCreated {
                    id: "cell_01".into(),
                    cell_type: CellType::Code,
                    created_by: "user-123".into(),
                    after: None,
                    fractional_index: "a".into(),
                },
            },
        };
        let json = msg.to_json().unwrap();
        let v: Value = serde_json::from_str(&json).unwrap();
        assert_eq!(v["type"], "delta");
        assert_eq!(v["version"], 848);
        assert_eq!(v["op"], "cell_created");
        assert_eq!(v["fractional_index"], "a");
    }

    #[test]
    fn test_error_wire_format() {
        let msg = ServerMessage::Error {
            ref_id: Some("msg_01".into()),
            code: ErrorCode::Unauthorized,
            message: "ui clients cannot emit output deltas".into(),
            cell_id: None,
            current_source: None,
        };
        let json = msg.to_json().unwrap();
        let v: Value = serde_json::from_str(&json).unwrap();
        assert_eq!(v["type"], "error");
        assert_eq!(v["ref"], "msg_01");
        assert_eq!(v["code"], "UNAUTHORIZED");
    }

    #[test]
    fn test_error_code_serialization() {
        assert_eq!(
            serde_json::to_string(&ErrorCode::Unauthorized).unwrap(),
            "\"UNAUTHORIZED\""
        );
        assert_eq!(
            serde_json::to_string(&ErrorCode::NotFound).unwrap(),
            "\"NOT_FOUND\""
        );
        assert_eq!(
            serde_json::to_string(&ErrorCode::InvalidOp).unwrap(),
            "\"INVALID_OP\""
        );
        assert_eq!(
            serde_json::to_string(&ErrorCode::KernelError).unwrap(),
            "\"KERNEL_ERROR\""
        );
    }

    // ── ServerMessage roundtrips ────────────────────────────────────────

    #[test]
    fn test_welcome_roundtrip() {
        let msg = ServerMessage::Welcome {
            client_id: "tauri-ui-1".into(),
            version: 847,
            snapshot: Box::new(NotebookSnapshot {
                version: 847,
                metadata: HashMap::from([("title".into(), "Test Notebook".into())]),
                cells: vec![CellSnapshot {
                    id: "cell_01".into(),
                    cell_type: CellType::Code,
                    source: "print('hello')".into(),
                    fractional_index: "a0".into(),
                    execution_state: ExecutionState::Idle,
                    execution_count: Some(1),
                    source_visible: true,
                    output_visible: true,
                    created_by: "user-123".into(),
                }],
                outputs: HashMap::new(),
                output_deltas: HashMap::new(),
                comms: HashMap::new(),
                runtime_sessions: vec![],
                execution_queue: vec![],
                actors: vec![test_actor()],
            }),
            catch_up: vec![],
            presence: HashMap::new(),
        };
        let json = msg.to_json().unwrap();
        let parsed = ServerMessage::from_json(&json).unwrap();
        assert_eq!(msg, parsed);
    }

    #[test]
    fn test_presence_state_roundtrip() {
        let mut peers = HashMap::new();
        peers.insert(
            "tauri-ui-1".into(),
            PeerPresence {
                client_kind: ClientKind::Ui,
                actor: test_actor(),
                focus_cell: Some("cell_01".into()),
                activity: Activity::Editing,
                cursor: Some(CursorPosition { line: 5, ch: 12 }),
                custom: Value::Object(serde_json::Map::new()),
            },
        );
        let msg = ServerMessage::PresenceState { peers };
        let json = msg.to_json().unwrap();
        let parsed = ServerMessage::from_json(&json).unwrap();
        assert_eq!(msg, parsed);
    }

    #[test]
    fn test_checkpointed_roundtrip() {
        let msg = ServerMessage::Checkpointed { version: 900 };
        let json = msg.to_json().unwrap();
        let parsed = ServerMessage::from_json(&json).unwrap();
        assert_eq!(msg, parsed);
    }

    #[test]
    fn test_error_roundtrip() {
        let msg = ServerMessage::Error {
            ref_id: Some("msg_01".into()),
            code: ErrorCode::Conflict,
            message: "source has changed".into(),
            cell_id: Some("cell_01".into()),
            current_source: Some("current contents".into()),
        };
        let json = msg.to_json().unwrap();
        let parsed = ServerMessage::from_json(&json).unwrap();
        assert_eq!(msg, parsed);
    }

    // ── DeltaOp roundtrips ──────────────────────────────────────────────

    fn wrap_delta(op: DeltaOp) -> ServerMessage {
        ServerMessage::Delta {
            event: DeltaEvent {
                version: 1,
                timestamp: "2026-02-20T15:30:00Z".into(),
                origin: "user-123".into(),
                op,
            },
        }
    }

    #[test]
    fn test_delta_cell_created_roundtrip() {
        let msg = wrap_delta(DeltaOp::CellCreated {
            id: "cell_01".into(),
            cell_type: CellType::Code,
            created_by: "user-123".into(),
            after: None,
            fractional_index: "a".into(),
        });
        let json = msg.to_json().unwrap();
        let parsed = ServerMessage::from_json(&json).unwrap();
        assert_eq!(msg, parsed);
    }

    #[test]
    fn test_delta_cell_deleted_roundtrip() {
        let msg = wrap_delta(DeltaOp::CellDeleted {
            id: "cell_01".into(),
            actor_id: "user-123".into(),
        });
        let json = msg.to_json().unwrap();
        let parsed = ServerMessage::from_json(&json).unwrap();
        assert_eq!(msg, parsed);
    }

    #[test]
    fn test_delta_cell_moved_roundtrip() {
        let msg = wrap_delta(DeltaOp::CellMoved {
            id: "cell_03".into(),
            after: Some("cell_01".into()),
            actor_id: "user-123".into(),
            fractional_index: "a5".into(),
        });
        let json = msg.to_json().unwrap();
        let parsed = ServerMessage::from_json(&json).unwrap();
        assert_eq!(msg, parsed);
    }

    #[test]
    fn test_delta_cell_source_set_roundtrip() {
        let msg = wrap_delta(DeltaOp::CellSourceSet {
            id: "cell_01".into(),
            source: "x = 42".into(),
            modified_by: "user-123".into(),
        });
        let json = msg.to_json().unwrap();
        let parsed = ServerMessage::from_json(&json).unwrap();
        assert_eq!(msg, parsed);
    }

    #[test]
    fn test_delta_cell_source_patched_roundtrip() {
        let msg = wrap_delta(DeltaOp::CellSourcePatched {
            id: "cell_01".into(),
            modified_by: "user-123".into(),
            patches: vec![TextPatch {
                pos: 0,
                delete: 1,
                insert: "y".into(),
            }],
        });
        let json = msg.to_json().unwrap();
        let parsed = ServerMessage::from_json(&json).unwrap();
        assert_eq!(msg, parsed);
    }

    #[test]
    fn test_delta_terminal_output_added_roundtrip() {
        let msg = wrap_delta(DeltaOp::TerminalOutputAdded {
            id: "out_01".into(),
            cell_id: "cell_01".into(),
            position: 0.0,
            stream_name: "stdout".into(),
            data: "Processing...\n".into(),
        });
        let json = msg.to_json().unwrap();
        let parsed = ServerMessage::from_json(&json).unwrap();
        assert_eq!(msg, parsed);
    }

    #[test]
    fn test_delta_terminal_output_appended_roundtrip() {
        let msg = wrap_delta(DeltaOp::TerminalOutputAppended {
            id: "d_01".into(),
            output_id: "out_01".into(),
            delta: "more text\n".into(),
            sequence_number: 1,
        });
        let json = msg.to_json().unwrap();
        let parsed = ServerMessage::from_json(&json).unwrap();
        assert_eq!(msg, parsed);
    }

    #[test]
    fn test_delta_multimedia_display_added_roundtrip() {
        let mut representations = HashMap::new();
        representations.insert(
            "text/html".into(),
            MediaRepresentation::Inline {
                data: Value::String("<b>hello</b>".into()),
                metadata: None,
            },
        );
        let msg = wrap_delta(DeltaOp::MultimediaDisplayAdded {
            id: "out_02".into(),
            cell_id: "cell_01".into(),
            position: 1.0,
            display_id: Some("display_01".into()),
            representations,
        });
        let json = msg.to_json().unwrap();
        let parsed = ServerMessage::from_json(&json).unwrap();
        assert_eq!(msg, parsed);
    }

    #[test]
    fn test_delta_multimedia_display_updated_roundtrip() {
        let mut representations = HashMap::new();
        representations.insert(
            "text/plain".into(),
            MediaRepresentation::Inline {
                data: Value::String("updated".into()),
                metadata: None,
            },
        );
        let msg = wrap_delta(DeltaOp::MultimediaDisplayUpdated {
            display_id: "display_01".into(),
            representations,
        });
        let json = msg.to_json().unwrap();
        let parsed = ServerMessage::from_json(&json).unwrap();
        assert_eq!(msg, parsed);
    }

    #[test]
    fn test_delta_multimedia_result_added_roundtrip() {
        let mut representations = HashMap::new();
        representations.insert(
            "text/plain".into(),
            MediaRepresentation::Inline {
                data: Value::String("42".into()),
                metadata: None,
            },
        );
        representations.insert(
            "image/png".into(),
            MediaRepresentation::Blob {
                blob_path: "blobs/abc123".into(),
                metadata: None,
            },
        );
        let msg = wrap_delta(DeltaOp::MultimediaResultAdded {
            id: "out_03".into(),
            cell_id: "cell_01".into(),
            position: 2.0,
            execution_count: 5,
            representations,
        });
        let json = msg.to_json().unwrap();
        let parsed = ServerMessage::from_json(&json).unwrap();
        assert_eq!(msg, parsed);
    }

    #[test]
    fn test_delta_error_output_added_roundtrip() {
        let msg = wrap_delta(DeltaOp::ErrorOutputAdded {
            id: "out_04".into(),
            cell_id: "cell_01".into(),
            position: 3.0,
            data: ErrorOutputData {
                ename: "ValueError".into(),
                evalue: "invalid literal".into(),
                traceback: vec![
                    "Traceback (most recent call last):".into(),
                    "  File \"<stdin>\", line 1".into(),
                    "ValueError: invalid literal".into(),
                ],
            },
        });
        let json = msg.to_json().unwrap();
        let parsed = ServerMessage::from_json(&json).unwrap();
        assert_eq!(msg, parsed);
    }

    #[test]
    fn test_delta_cell_outputs_cleared_roundtrip() {
        let msg = wrap_delta(DeltaOp::CellOutputsCleared {
            cell_id: "cell_01".into(),
            wait: true,
        });
        let json = msg.to_json().unwrap();
        let parsed = ServerMessage::from_json(&json).unwrap();
        assert_eq!(msg, parsed);
    }

    #[test]
    fn test_delta_all_outputs_cleared_roundtrip() {
        let msg = wrap_delta(DeltaOp::AllOutputsCleared {});
        let json = msg.to_json().unwrap();
        let parsed = ServerMessage::from_json(&json).unwrap();
        assert_eq!(msg, parsed);
    }

    #[test]
    fn test_delta_execution_assigned_roundtrip() {
        let msg = wrap_delta(DeltaOp::ExecutionAssigned {
            queue_id: "q_01".into(),
            runtime_session_id: "session_01".into(),
        });
        let json = msg.to_json().unwrap();
        let parsed = ServerMessage::from_json(&json).unwrap();
        assert_eq!(msg, parsed);
    }

    #[test]
    fn test_delta_execution_started_roundtrip() {
        let msg = wrap_delta(DeltaOp::ExecutionStarted {
            queue_id: "q_01".into(),
            cell_id: "cell_01".into(),
            runtime_session_id: "session_01".into(),
            started_at: "2026-02-20T15:30:00Z".into(),
        });
        let json = msg.to_json().unwrap();
        let parsed = ServerMessage::from_json(&json).unwrap();
        assert_eq!(msg, parsed);
    }

    #[test]
    fn test_delta_execution_completed_roundtrip() {
        let msg = wrap_delta(DeltaOp::ExecutionCompleted {
            queue_id: "q_01".into(),
            cell_id: "cell_01".into(),
            status: CompletionStatus::Success,
            execution_duration_ms: Some(1234),
        });
        let json = msg.to_json().unwrap();
        let parsed = ServerMessage::from_json(&json).unwrap();
        assert_eq!(msg, parsed);
    }

    #[test]
    fn test_delta_runtime_session_started_roundtrip() {
        let msg = wrap_delta(DeltaOp::RuntimeSessionStarted {
            session_id: "session_01".into(),
            runtime_id: "runtime_01".into(),
            runtime_type: "python3".into(),
            capabilities: RuntimeCapabilities {
                can_execute_code: true,
            },
        });
        let json = msg.to_json().unwrap();
        let parsed = ServerMessage::from_json(&json).unwrap();
        assert_eq!(msg, parsed);
    }

    #[test]
    fn test_delta_runtime_session_status_changed_roundtrip() {
        let msg = wrap_delta(DeltaOp::RuntimeSessionStatusChanged {
            session_id: "session_01".into(),
            status: RuntimeStatus::Ready,
        });
        let json = msg.to_json().unwrap();
        let parsed = ServerMessage::from_json(&json).unwrap();
        assert_eq!(msg, parsed);
    }

    #[test]
    fn test_delta_runtime_session_renewal_roundtrip() {
        let msg = wrap_delta(DeltaOp::RuntimeSessionRenewal {
            session_id: "session_01".into(),
            renewed_at: "2026-02-20T15:30:00Z".into(),
            valid_for_ms: 30000,
        });
        let json = msg.to_json().unwrap();
        let parsed = ServerMessage::from_json(&json).unwrap();
        assert_eq!(msg, parsed);
    }

    #[test]
    fn test_delta_runtime_session_terminated_roundtrip() {
        let msg = wrap_delta(DeltaOp::RuntimeSessionTerminated {
            session_id: "session_01".into(),
            reason: "shutdown".into(),
        });
        let json = msg.to_json().unwrap();
        let parsed = ServerMessage::from_json(&json).unwrap();
        assert_eq!(msg, parsed);
    }

    #[test]
    fn test_delta_comm_open_roundtrip() {
        let msg = wrap_delta(DeltaOp::CommOpen {
            comm_id: "comm_01".into(),
            target_name: "jupyter.widget.comm".into(),
            data: serde_json::json!({"state": {"value": 0}}),
            buffers: 0,
        });
        let json = msg.to_json().unwrap();
        let parsed = ServerMessage::from_json(&json).unwrap();
        assert_eq!(msg, parsed);
    }

    #[test]
    fn test_delta_comm_msg_roundtrip() {
        let msg = wrap_delta(DeltaOp::CommMsg {
            comm_id: "comm_01".into(),
            data: serde_json::json!({"method": "update", "state": {"value": 5}}),
            buffers: 2,
        });
        let json = msg.to_json().unwrap();
        let parsed = ServerMessage::from_json(&json).unwrap();
        assert_eq!(msg, parsed);
    }

    #[test]
    fn test_delta_comm_close_roundtrip() {
        let msg = wrap_delta(DeltaOp::CommClose {
            comm_id: "comm_01".into(),
            data: serde_json::json!({}),
        });
        let json = msg.to_json().unwrap();
        let parsed = ServerMessage::from_json(&json).unwrap();
        assert_eq!(msg, parsed);
    }

    // ── Snapshot tests ──────────────────────────────────────────────────

    #[test]
    fn test_snapshot_mixed_cell_types() {
        let snapshot = NotebookSnapshot {
            version: 100,
            metadata: HashMap::from([
                ("title".into(), "Mixed Notebook".into()),
                ("kernel_name".into(), "python3".into()),
            ]),
            cells: vec![
                CellSnapshot {
                    id: "cell_01".into(),
                    cell_type: CellType::Code,
                    source: "x = 1".into(),
                    fractional_index: "a".into(),
                    execution_state: ExecutionState::Completed,
                    execution_count: Some(1),
                    source_visible: true,
                    output_visible: true,
                    created_by: "user-123".into(),
                },
                CellSnapshot {
                    id: "cell_02".into(),
                    cell_type: CellType::Markdown,
                    source: "# Hello".into(),
                    fractional_index: "n".into(),
                    execution_state: ExecutionState::Idle,
                    execution_count: None,
                    source_visible: true,
                    output_visible: true,
                    created_by: "user-123".into(),
                },
                CellSnapshot {
                    id: "cell_03".into(),
                    cell_type: CellType::Raw,
                    source: "raw content".into(),
                    fractional_index: "z".into(),
                    execution_state: ExecutionState::Idle,
                    execution_count: None,
                    source_visible: false,
                    output_visible: false,
                    created_by: "agent-1".into(),
                },
            ],
            outputs: HashMap::from([(
                "cell_01".into(),
                vec![OutputSnapshot {
                    id: "out_01".into(),
                    output_type: OutputType::MultimediaResult,
                    position: 0.0,
                    mime_type: Some("text/plain".into()),
                    data: Some("1".into()),
                    representations: Some(HashMap::from([(
                        "text/plain".into(),
                        MediaRepresentation::Inline {
                            data: Value::String("1".into()),
                            metadata: None,
                        },
                    )])),
                    execution_count: Some(1),
                    display_id: None,
                    stream_name: None,
                }],
            )]),
            output_deltas: HashMap::new(),
            comms: HashMap::from([(
                "comm_01".into(),
                CommSnapshot {
                    target_name: "jupyter.widget.comm".into(),
                    cell_id: Some("cell_01".into()),
                    state: serde_json::json!({"value": 42}),
                    buffer_paths: vec![],
                },
            )]),
            runtime_sessions: vec![RuntimeSessionSnapshot {
                session_id: "session_01".into(),
                runtime_id: "runtime_01".into(),
                runtime_type: "python3".into(),
                status: RuntimeStatus::Ready,
                is_active: true,
                can_execute_code: true,
            }],
            execution_queue: vec![],
            actors: vec![test_actor()],
        };

        let json = serde_json::to_string(&snapshot).unwrap();
        let parsed: NotebookSnapshot = serde_json::from_str(&json).unwrap();
        assert_eq!(snapshot, parsed);
        assert_eq!(parsed.cells.len(), 3);
        assert_eq!(parsed.cells[0].cell_type, CellType::Code);
        assert_eq!(parsed.cells[1].cell_type, CellType::Markdown);
        assert_eq!(parsed.cells[2].cell_type, CellType::Raw);
    }

    #[test]
    fn test_snapshot_with_output_deltas() {
        let snapshot = NotebookSnapshot {
            version: 50,
            metadata: HashMap::new(),
            cells: vec![],
            outputs: HashMap::from([(
                "cell_01".into(),
                vec![OutputSnapshot {
                    id: "out_01".into(),
                    output_type: OutputType::Terminal,
                    position: 0.0,
                    mime_type: None,
                    data: Some("line 1\n".into()),
                    representations: None,
                    execution_count: None,
                    display_id: None,
                    stream_name: Some("stdout".into()),
                }],
            )]),
            output_deltas: HashMap::from([(
                "out_01".into(),
                vec![
                    OutputDeltaSnapshot {
                        id: "d1".into(),
                        delta: "line 2\n".into(),
                        sequence_number: 0,
                    },
                    OutputDeltaSnapshot {
                        id: "d2".into(),
                        delta: "line 3\n".into(),
                        sequence_number: 1,
                    },
                ],
            )]),
            comms: HashMap::new(),
            runtime_sessions: vec![],
            execution_queue: vec![],
            actors: vec![],
        };

        let json = serde_json::to_string(&snapshot).unwrap();
        let parsed: NotebookSnapshot = serde_json::from_str(&json).unwrap();
        assert_eq!(snapshot, parsed);
        assert_eq!(parsed.output_deltas["out_01"].len(), 2);
    }

    // ── Permission matrix ───────────────────────────────────────────────

    #[test]
    fn test_kernel_cannot_edit_cells() {
        assert!(!ClientKind::Kernel.can_edit_cells());
        assert!(ClientKind::Ui.can_edit_cells());
        assert!(ClientKind::Agent.can_edit_cells());
        assert!(ClientKind::Mcp.can_edit_cells());
        assert!(ClientKind::Tui.can_edit_cells());
    }

    #[test]
    fn test_only_kernel_and_agent_emit_outputs() {
        assert!(ClientKind::Kernel.can_emit_outputs());
        assert!(ClientKind::Agent.can_emit_outputs());
        assert!(!ClientKind::Ui.can_emit_outputs());
        assert!(!ClientKind::Mcp.can_emit_outputs());
        assert!(!ClientKind::Tui.can_emit_outputs());
    }

    #[test]
    fn test_only_agent_manages_runtime() {
        assert!(ClientKind::Agent.can_manage_runtime());
        assert!(!ClientKind::Ui.can_manage_runtime());
        assert!(!ClientKind::Mcp.can_manage_runtime());
        assert!(!ClientKind::Kernel.can_manage_runtime());
        assert!(!ClientKind::Tui.can_manage_runtime());
    }

    #[test]
    fn test_kernel_cannot_request_execution() {
        assert!(!ClientKind::Kernel.can_request_execution());
        assert!(ClientKind::Ui.can_request_execution());
        assert!(ClientKind::Agent.can_request_execution());
        assert!(ClientKind::Mcp.can_request_execution());
        assert!(ClientKind::Tui.can_request_execution());
    }

    #[test]
    fn test_comm_to_kernel_permissions() {
        assert!(ClientKind::Ui.can_send_comm_to_kernel());
        assert!(ClientKind::Agent.can_send_comm_to_kernel());
        assert!(ClientKind::Mcp.can_send_comm_to_kernel());
        assert!(!ClientKind::Kernel.can_send_comm_to_kernel());
        assert!(!ClientKind::Tui.can_send_comm_to_kernel());
    }

    #[test]
    fn test_only_kernel_emits_comm_from_kernel() {
        assert!(ClientKind::Kernel.can_emit_comm_from_kernel());
        assert!(!ClientKind::Ui.can_emit_comm_from_kernel());
        assert!(!ClientKind::Agent.can_emit_comm_from_kernel());
        assert!(!ClientKind::Mcp.can_emit_comm_from_kernel());
        assert!(!ClientKind::Tui.can_emit_comm_from_kernel());
    }

    #[test]
    fn test_metadata_permissions() {
        assert!(ClientKind::Ui.can_set_metadata());
        assert!(ClientKind::Agent.can_set_metadata());
        assert!(ClientKind::Mcp.can_set_metadata());
        assert!(!ClientKind::Kernel.can_set_metadata());
        assert!(!ClientKind::Tui.can_set_metadata());
    }

    #[test]
    fn test_checkpoint_permissions() {
        assert!(ClientKind::Ui.can_checkpoint());
        assert!(ClientKind::Agent.can_checkpoint());
        assert!(ClientKind::Mcp.can_checkpoint());
        assert!(!ClientKind::Kernel.can_checkpoint());
        assert!(!ClientKind::Tui.can_checkpoint());
    }

    #[test]
    fn test_presence_permissions() {
        assert!(ClientKind::Ui.can_update_presence());
        assert!(ClientKind::Agent.can_update_presence());
        assert!(ClientKind::Mcp.can_update_presence());
        assert!(ClientKind::Tui.can_update_presence());
        assert!(!ClientKind::Kernel.can_update_presence());
    }

    // ── Error cases ─────────────────────────────────────────────────────

    #[test]
    fn test_invalid_json() {
        let result = ClientMessage::from_json("not valid json");
        assert!(result.is_err());
    }

    #[test]
    fn test_unknown_type_tag() {
        let result = ClientMessage::from_json(r#"{"type":"unknown_type"}"#);
        assert!(result.is_err());
    }

    #[test]
    fn test_unknown_op_tag() {
        let result = ClientMessage::from_json(r#"{"type":"edit","op":"unknown_op"}"#);
        assert!(result.is_err());
    }

    #[test]
    fn test_missing_required_fields() {
        // Hello without client_id
        let result = ClientMessage::from_json(r#"{"type":"hello","client_kind":"ui"}"#);
        assert!(result.is_err());
    }

    #[test]
    fn test_media_representation_inline_roundtrip() {
        let repr = MediaRepresentation::Inline {
            data: Value::String("hello".into()),
            metadata: Some(serde_json::json!({"isolated": true})),
        };
        let json = serde_json::to_string(&repr).unwrap();
        let parsed: MediaRepresentation = serde_json::from_str(&json).unwrap();
        assert_eq!(repr, parsed);
        let v: Value = serde_json::from_str(&json).unwrap();
        assert_eq!(v["type"], "inline");
    }

    #[test]
    fn test_media_representation_blob_roundtrip() {
        let repr = MediaRepresentation::Blob {
            blob_path: "blobs/abc123".into(),
            metadata: None,
        };
        let json = serde_json::to_string(&repr).unwrap();
        let parsed: MediaRepresentation = serde_json::from_str(&json).unwrap();
        assert_eq!(repr, parsed);
        let v: Value = serde_json::from_str(&json).unwrap();
        assert_eq!(v["type"], "blob");
    }

    #[test]
    fn test_client_kind_serialization() {
        assert_eq!(serde_json::to_string(&ClientKind::Ui).unwrap(), "\"ui\"");
        assert_eq!(
            serde_json::to_string(&ClientKind::Agent).unwrap(),
            "\"agent\""
        );
        assert_eq!(serde_json::to_string(&ClientKind::Mcp).unwrap(), "\"mcp\"");
        assert_eq!(serde_json::to_string(&ClientKind::Tui).unwrap(), "\"tui\"");
        assert_eq!(
            serde_json::to_string(&ClientKind::Kernel).unwrap(),
            "\"kernel\""
        );
    }

    #[test]
    fn test_cell_type_serialization() {
        assert_eq!(
            serde_json::to_string(&CellType::Code).unwrap(),
            "\"code\""
        );
        assert_eq!(
            serde_json::to_string(&CellType::Markdown).unwrap(),
            "\"markdown\""
        );
        assert_eq!(serde_json::to_string(&CellType::Raw).unwrap(), "\"raw\"");
    }

    #[test]
    fn test_queue_entry_snapshot_roundtrip() {
        let entry = QueueEntrySnapshot {
            id: "q_01".into(),
            cell_id: "cell_01".into(),
            execution_count: 3,
            requested_by: "user-123".into(),
            status: QueueStatus::Executing,
            assigned_runtime_session: Some("session_01".into()),
        };
        let json = serde_json::to_string(&entry).unwrap();
        let parsed: QueueEntrySnapshot = serde_json::from_str(&json).unwrap();
        assert_eq!(entry, parsed);
    }

    #[test]
    fn test_welcome_with_catch_up() {
        let msg = ServerMessage::Welcome {
            client_id: "agent-1".into(),
            version: 50,
            snapshot: Box::new(NotebookSnapshot {
                version: 48,
                metadata: HashMap::new(),
                cells: vec![],
                outputs: HashMap::new(),
                output_deltas: HashMap::new(),
                comms: HashMap::new(),
                runtime_sessions: vec![],
                execution_queue: vec![],
                actors: vec![],
            }),
            catch_up: vec![
                DeltaEvent {
                    version: 49,
                    timestamp: "2026-02-20T15:29:00Z".into(),
                    origin: "user-123".into(),
                    op: DeltaOp::CellSourceSet {
                        id: "cell_01".into(),
                        source: "updated".into(),
                        modified_by: "user-123".into(),
                    },
                },
                DeltaEvent {
                    version: 50,
                    timestamp: "2026-02-20T15:30:00Z".into(),
                    origin: "user-123".into(),
                    op: DeltaOp::NotebookMetadataSet {
                        key: "title".into(),
                        value: "New Title".into(),
                    },
                },
            ],
            presence: HashMap::new(),
        };
        let json = msg.to_json().unwrap();
        let parsed = ServerMessage::from_json(&json).unwrap();
        assert_eq!(msg, parsed);
    }
}
