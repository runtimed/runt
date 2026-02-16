use log::{error, info};
use serde::Serialize;
use std::collections::VecDeque;
use std::sync::{Arc, Mutex as StdMutex};
use tauri::{AppHandle, Emitter};
use tokio::sync::mpsc;

/// Status of a queued cell
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum CellQueueStatus {
    /// Waiting in queue
    Pending,
    /// Currently executing
    Executing,
}

/// A cell in the execution queue
#[derive(Debug, Clone, Serialize)]
pub struct QueuedCell {
    pub cell_id: String,
    pub status: CellQueueStatus,
    /// Position in queue (0 = currently executing or next)
    pub position: usize,
}

/// Queue state emitted to frontend via queue:state event
#[derive(Debug, Clone, Serialize)]
pub struct ExecutionQueueState {
    /// Is the queue processing (has pending or executing cells)?
    pub processing: bool,
    /// Cells currently in queue (pending + executing)
    pub cells: Vec<QueuedCell>,
    /// ID of currently executing cell (if any)
    pub executing_cell_id: Option<String>,
}

/// Commands sent to the queue processor
#[derive(Debug)]
pub enum QueueCommand {
    /// Enqueue a cell for execution
    Enqueue { cell_id: String },
    /// Clear all pending cells (keep currently executing)
    Clear,
    /// Interrupt current execution and clear queue
    InterruptAndClear,
    /// Signal that execution completed for a cell
    ExecutionDone { cell_id: String },
    /// Retry processing the queue (used when waiting for kernel)
    RetryProcessing,
}

/// Maximum number of kernel-not-running retries before cancelling (50 * 100ms = 5 seconds)
const MAX_KERNEL_RETRIES: usize = 50;

/// The execution queue - owns the pending/executing state
pub struct ExecutionQueue {
    /// Pending cell IDs (FIFO)
    pending: VecDeque<String>,
    /// Currently executing cell ID
    executing: Option<String>,
    /// Number of consecutive "kernel not running" retries
    kernel_retry_count: usize,
}

impl Default for ExecutionQueue {
    fn default() -> Self {
        Self::new()
    }
}

impl ExecutionQueue {
    pub fn new() -> Self {
        Self {
            pending: VecDeque::new(),
            executing: None,
            kernel_retry_count: 0,
        }
    }

    /// Increment kernel retry count and return whether we should keep retrying
    pub fn increment_kernel_retry(&mut self) -> bool {
        self.kernel_retry_count += 1;
        self.kernel_retry_count < MAX_KERNEL_RETRIES
    }

    /// Reset kernel retry count (called when execution succeeds)
    pub fn reset_kernel_retry(&mut self) {
        self.kernel_retry_count = 0;
    }

    /// Enqueue a cell for execution
    pub fn enqueue(&mut self, cell_id: String) {
        self.pending.push_back(cell_id);
    }

    /// Get next cell to execute (if queue is non-empty and nothing executing)
    pub fn dequeue(&mut self) -> Option<String> {
        if self.executing.is_some() {
            return None;
        }
        if let Some(cell_id) = self.pending.pop_front() {
            self.executing = Some(cell_id.clone());
            return Some(cell_id);
        }
        None
    }

    /// Mark current execution as complete
    pub fn complete(&mut self, cell_id: &str) {
        if self.executing.as_ref() == Some(&cell_id.to_string()) {
            self.executing = None;
        }
    }

    /// Clear all pending (but not currently executing)
    pub fn clear_pending(&mut self) -> Vec<String> {
        self.pending.drain(..).collect()
    }

    /// Check if a cell is currently executing
    pub fn is_executing(&self, cell_id: &str) -> bool {
        self.executing.as_ref() == Some(&cell_id.to_string())
    }

    /// Check if queue is empty (no pending and no executing)
    pub fn is_empty(&self) -> bool {
        self.pending.is_empty() && self.executing.is_none()
    }

    /// Get current state for frontend
    pub fn get_state(&self) -> ExecutionQueueState {
        let mut cells = Vec::new();
        let mut position = 0;

        if let Some(ref cell_id) = self.executing {
            cells.push(QueuedCell {
                cell_id: cell_id.clone(),
                status: CellQueueStatus::Executing,
                position,
            });
            position += 1;
        }

        for cell_id in &self.pending {
            cells.push(QueuedCell {
                cell_id: cell_id.clone(),
                status: CellQueueStatus::Pending,
                position,
            });
            position += 1;
        }

        ExecutionQueueState {
            processing: self.executing.is_some() || !self.pending.is_empty(),
            cells,
            executing_cell_id: self.executing.clone(),
        }
    }
}

/// Shared queue type for Tauri state
pub type SharedExecutionQueue = Arc<StdMutex<ExecutionQueue>>;

/// Event emitted when cells are cancelled from the queue
#[derive(Serialize, Clone)]
pub struct CellsCancelledEvent {
    pub cell_ids: Vec<String>,
}

/// Emit queue state to frontend
fn emit_queue_state(app: &AppHandle, queue: &ExecutionQueue) {
    let state = queue.get_state();
    if let Err(e) = app.emit("queue:state", &state) {
        error!("Failed to emit queue:state: {}", e);
    }
}

/// Emit cells cancelled event to frontend
fn emit_cells_cancelled(app: &AppHandle, cell_ids: Vec<String>) {
    if cell_ids.is_empty() {
        return;
    }
    let event = CellsCancelledEvent { cell_ids };
    if let Err(e) = app.emit("queue:cells_cancelled", &event) {
        error!("Failed to emit queue:cells_cancelled: {}", e);
    }
}

/// Spawn the queue processor task. Returns a sender for sending commands.
pub fn spawn_queue_processor(
    app: AppHandle,
    queue: SharedExecutionQueue,
    notebook_state: Arc<StdMutex<crate::notebook_state::NotebookState>>,
    kernel: Arc<tokio::sync::Mutex<crate::kernel::NotebookKernel>>,
) -> mpsc::Sender<QueueCommand> {
    let (tx, mut rx) = mpsc::channel::<QueueCommand>(100);
    let tx_return = tx.clone(); // Clone for return, original goes into async task

    // Use tauri's async runtime to ensure we're in the correct context
    tauri::async_runtime::spawn(async move {
        info!("[queue] Queue processor started");

        loop {
            match rx.recv().await {
                Some(cmd) => {
                    match cmd {
                        QueueCommand::Enqueue { cell_id } => {
                            info!("[queue] Enqueue cell: {}", cell_id);
                            {
                                let mut q = queue.lock().unwrap();
                                q.enqueue(cell_id);
                                emit_queue_state(&app, &q);
                            }
                            // Try to process next
                            process_next(&app, &queue, &notebook_state, &kernel, &tx).await;
                        }

                        QueueCommand::Clear => {
                            info!("[queue] Clear pending");
                            let cleared = {
                                let mut q = queue.lock().unwrap();
                                let cleared = q.clear_pending();
                                emit_queue_state(&app, &q);
                                cleared
                            };
                            emit_cells_cancelled(&app, cleared);
                        }

                        QueueCommand::InterruptAndClear => {
                            info!("[queue] Interrupt and clear");
                            // Interrupt kernel
                            {
                                let k = kernel.lock().await;
                                if let Err(e) = k.interrupt().await {
                                    error!("[queue] Failed to interrupt kernel: {}", e);
                                }
                            }
                            // Clear pending
                            let cleared = {
                                let mut q = queue.lock().unwrap();
                                let cleared = q.clear_pending();
                                emit_queue_state(&app, &q);
                                cleared
                            };
                            emit_cells_cancelled(&app, cleared);
                        }

                        QueueCommand::ExecutionDone { cell_id } => {
                            info!("[queue] Execution done: {}", cell_id);
                            {
                                let mut q = queue.lock().unwrap();
                                q.complete(&cell_id);
                                emit_queue_state(&app, &q);
                            }
                            // Process next queued cell
                            process_next(&app, &queue, &notebook_state, &kernel, &tx).await;
                        }

                        QueueCommand::RetryProcessing => {
                            info!("[queue] Retry processing");
                            process_next(&app, &queue, &notebook_state, &kernel, &tx).await;
                        }
                    }
                }
                None => {
                    info!("[queue] Queue processor channel closed");
                    break;
                }
            }
        }
    });

    tx_return
}

/// Process the next cell in the queue (if any and kernel ready)
async fn process_next(
    app: &AppHandle,
    queue: &SharedExecutionQueue,
    notebook_state: &Arc<StdMutex<crate::notebook_state::NotebookState>>,
    kernel: &Arc<tokio::sync::Mutex<crate::kernel::NotebookKernel>>,
    tx: &mpsc::Sender<QueueCommand>,
) {
    // Check if there's a cell to process
    let cell_id = {
        let mut q = queue.lock().unwrap();
        q.dequeue()
    };

    let Some(cell_id) = cell_id else {
        return; // Queue empty or already executing
    };

    info!("[queue] Processing cell: {}", cell_id);

    // Emit state showing this cell is now executing
    {
        let q = queue.lock().unwrap();
        emit_queue_state(app, &q);
    }

    // Get code from notebook state
    let code = {
        let mut nb = notebook_state.lock().unwrap();
        let src = nb.get_cell_source(&cell_id);
        if src.is_some() {
            nb.clear_cell_outputs(&cell_id);
        }
        src
    };

    let Some(code) = code else {
        // Cell was deleted, skip it
        info!("[queue] Cell {} not found, skipping", cell_id);
        let mut q = queue.lock().unwrap();
        q.complete(&cell_id);
        emit_queue_state(app, &q);
        return;
    };

    // Check if kernel is running
    let mut k = kernel.lock().await;
    if !k.is_running() {
        // Kernel not running - check if we should keep retrying
        let should_retry = {
            let mut q = queue.lock().unwrap();
            q.increment_kernel_retry()
        };

        if should_retry {
            // Put the cell back at the front and retry
            info!("[queue] Kernel not running, scheduling retry...");
            {
                let mut q = queue.lock().unwrap();
                q.complete(&cell_id); // Remove from executing
                // Re-add to front of queue
                q.pending.push_front(cell_id);
                emit_queue_state(app, &q);
            }
            // Schedule a retry after a short delay
            let tx_clone = tx.clone();
            tauri::async_runtime::spawn(async move {
                tokio::time::sleep(std::time::Duration::from_millis(100)).await;
                let _ = tx_clone.send(QueueCommand::RetryProcessing).await;
            });
        } else {
            // Exceeded retry limit - cancel all pending cells
            error!(
                "[queue] Kernel not running after {} retries, cancelling execution",
                MAX_KERNEL_RETRIES
            );
            let cancelled = {
                let mut q = queue.lock().unwrap();
                q.complete(&cell_id); // Remove from executing
                let mut cancelled = q.clear_pending();
                cancelled.insert(0, cell_id); // Include the current cell
                q.reset_kernel_retry();
                emit_queue_state(app, &q);
                cancelled
            };
            emit_cells_cancelled(app, cancelled);
        }
        return;
    }

    // Kernel is running - reset retry count
    {
        let mut q = queue.lock().unwrap();
        q.reset_kernel_retry();
    }

    // Execute the cell
    match k.execute(&code, &cell_id).await {
        Ok(msg_id) => {
            info!(
                "[queue] Execution started: cell={}, msg_id={}",
                cell_id, msg_id
            );
        }
        Err(e) => {
            error!("[queue] Execution failed: cell={}, error={}", cell_id, e);
            // Mark as complete so queue can continue
            let mut q = queue.lock().unwrap();
            q.complete(&cell_id);
            emit_queue_state(app, &q);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_new_creates_empty_queue() {
        let queue = ExecutionQueue::new();
        assert!(queue.is_empty());
        assert!(queue.executing.is_none());
        assert!(queue.pending.is_empty());
    }

    #[test]
    fn test_default_creates_empty_queue() {
        let queue = ExecutionQueue::default();
        assert!(queue.is_empty());
    }

    #[test]
    fn test_enqueue_adds_to_pending() {
        let mut queue = ExecutionQueue::new();
        queue.enqueue("cell-1".to_string());

        assert!(!queue.is_empty());
        assert_eq!(queue.pending.len(), 1);
        assert_eq!(queue.pending[0], "cell-1");
    }

    #[test]
    fn test_enqueue_maintains_fifo_order() {
        let mut queue = ExecutionQueue::new();
        queue.enqueue("cell-1".to_string());
        queue.enqueue("cell-2".to_string());
        queue.enqueue("cell-3".to_string());

        assert_eq!(queue.pending.len(), 3);
        assert_eq!(queue.pending[0], "cell-1");
        assert_eq!(queue.pending[1], "cell-2");
        assert_eq!(queue.pending[2], "cell-3");
    }

    #[test]
    fn test_dequeue_returns_first_cell_and_sets_executing() {
        let mut queue = ExecutionQueue::new();
        queue.enqueue("cell-1".to_string());
        queue.enqueue("cell-2".to_string());

        let result = queue.dequeue();

        assert_eq!(result, Some("cell-1".to_string()));
        assert_eq!(queue.executing, Some("cell-1".to_string()));
        assert_eq!(queue.pending.len(), 1);
        assert_eq!(queue.pending[0], "cell-2");
    }

    #[test]
    fn test_dequeue_returns_none_when_already_executing() {
        let mut queue = ExecutionQueue::new();
        queue.enqueue("cell-1".to_string());
        queue.enqueue("cell-2".to_string());

        queue.dequeue(); // Start executing cell-1
        let result = queue.dequeue(); // Should return None

        assert_eq!(result, None);
        assert_eq!(queue.executing, Some("cell-1".to_string()));
    }

    #[test]
    fn test_dequeue_returns_none_when_empty() {
        let mut queue = ExecutionQueue::new();
        assert_eq!(queue.dequeue(), None);
    }

    #[test]
    fn test_complete_clears_executing() {
        let mut queue = ExecutionQueue::new();
        queue.enqueue("cell-1".to_string());
        queue.dequeue();

        assert!(queue.executing.is_some());
        queue.complete("cell-1");
        assert!(queue.executing.is_none());
    }

    #[test]
    fn test_complete_only_clears_matching_cell() {
        let mut queue = ExecutionQueue::new();
        queue.enqueue("cell-1".to_string());
        queue.dequeue();

        queue.complete("cell-2"); // Wrong cell ID
        assert_eq!(queue.executing, Some("cell-1".to_string()));
    }

    #[test]
    fn test_clear_pending_returns_cleared_ids() {
        let mut queue = ExecutionQueue::new();
        queue.enqueue("cell-1".to_string());
        queue.enqueue("cell-2".to_string());
        queue.enqueue("cell-3".to_string());

        let cleared = queue.clear_pending();

        assert_eq!(cleared, vec!["cell-1", "cell-2", "cell-3"]);
        assert!(queue.pending.is_empty());
    }

    #[test]
    fn test_clear_pending_does_not_clear_executing() {
        let mut queue = ExecutionQueue::new();
        queue.enqueue("cell-1".to_string());
        queue.enqueue("cell-2".to_string());
        queue.dequeue(); // cell-1 now executing

        let cleared = queue.clear_pending();

        assert_eq!(cleared, vec!["cell-2"]);
        assert_eq!(queue.executing, Some("cell-1".to_string()));
    }

    #[test]
    fn test_is_executing_returns_true_for_executing_cell() {
        let mut queue = ExecutionQueue::new();
        queue.enqueue("cell-1".to_string());
        queue.dequeue();

        assert!(queue.is_executing("cell-1"));
    }

    #[test]
    fn test_is_executing_returns_false_for_non_executing_cell() {
        let mut queue = ExecutionQueue::new();
        queue.enqueue("cell-1".to_string());
        queue.enqueue("cell-2".to_string());
        queue.dequeue();

        assert!(!queue.is_executing("cell-2"));
    }

    #[test]
    fn test_is_executing_returns_false_when_nothing_executing() {
        let queue = ExecutionQueue::new();
        assert!(!queue.is_executing("cell-1"));
    }

    #[test]
    fn test_is_empty_true_when_no_pending_and_no_executing() {
        let queue = ExecutionQueue::new();
        assert!(queue.is_empty());
    }

    #[test]
    fn test_is_empty_false_when_pending() {
        let mut queue = ExecutionQueue::new();
        queue.enqueue("cell-1".to_string());
        assert!(!queue.is_empty());
    }

    #[test]
    fn test_is_empty_false_when_executing() {
        let mut queue = ExecutionQueue::new();
        queue.enqueue("cell-1".to_string());
        queue.dequeue();
        queue.pending.clear(); // Clear pending but keep executing
        assert!(!queue.is_empty());
    }

    #[test]
    fn test_get_state_empty_queue() {
        let queue = ExecutionQueue::new();
        let state = queue.get_state();

        assert!(!state.processing);
        assert!(state.cells.is_empty());
        assert!(state.executing_cell_id.is_none());
    }

    #[test]
    fn test_get_state_with_pending_cells() {
        let mut queue = ExecutionQueue::new();
        queue.enqueue("cell-1".to_string());
        queue.enqueue("cell-2".to_string());

        let state = queue.get_state();

        assert!(state.processing);
        assert_eq!(state.cells.len(), 2);
        assert!(state.executing_cell_id.is_none());

        // Both should be pending
        assert_eq!(state.cells[0].cell_id, "cell-1");
        assert_eq!(state.cells[0].status, CellQueueStatus::Pending);
        assert_eq!(state.cells[0].position, 0);

        assert_eq!(state.cells[1].cell_id, "cell-2");
        assert_eq!(state.cells[1].status, CellQueueStatus::Pending);
        assert_eq!(state.cells[1].position, 1);
    }

    #[test]
    fn test_get_state_with_executing_cell() {
        let mut queue = ExecutionQueue::new();
        queue.enqueue("cell-1".to_string());
        queue.enqueue("cell-2".to_string());
        queue.dequeue();

        let state = queue.get_state();

        assert!(state.processing);
        assert_eq!(state.cells.len(), 2);
        assert_eq!(state.executing_cell_id, Some("cell-1".to_string()));

        // First is executing
        assert_eq!(state.cells[0].cell_id, "cell-1");
        assert_eq!(state.cells[0].status, CellQueueStatus::Executing);
        assert_eq!(state.cells[0].position, 0);

        // Second is pending
        assert_eq!(state.cells[1].cell_id, "cell-2");
        assert_eq!(state.cells[1].status, CellQueueStatus::Pending);
        assert_eq!(state.cells[1].position, 1);
    }

    #[test]
    fn test_get_state_positions_are_sequential() {
        let mut queue = ExecutionQueue::new();
        queue.enqueue("cell-1".to_string());
        queue.enqueue("cell-2".to_string());
        queue.enqueue("cell-3".to_string());
        queue.dequeue(); // cell-1 executing

        let state = queue.get_state();

        for (i, cell) in state.cells.iter().enumerate() {
            assert_eq!(cell.position, i);
        }
    }

    #[test]
    fn test_cell_queue_status_serialization() {
        let pending = CellQueueStatus::Pending;
        let executing = CellQueueStatus::Executing;

        let pending_json = serde_json::to_string(&pending).unwrap();
        let executing_json = serde_json::to_string(&executing).unwrap();

        assert_eq!(pending_json, "\"pending\"");
        assert_eq!(executing_json, "\"executing\"");
    }

    #[test]
    fn test_queued_cell_serialization() {
        let cell = QueuedCell {
            cell_id: "test-cell".to_string(),
            status: CellQueueStatus::Pending,
            position: 0,
        };

        let json = serde_json::to_value(&cell).unwrap();

        assert_eq!(json["cell_id"], "test-cell");
        assert_eq!(json["status"], "pending");
        assert_eq!(json["position"], 0);
    }

    #[test]
    fn test_execution_queue_state_serialization() {
        let state = ExecutionQueueState {
            processing: true,
            cells: vec![QueuedCell {
                cell_id: "cell-1".to_string(),
                status: CellQueueStatus::Executing,
                position: 0,
            }],
            executing_cell_id: Some("cell-1".to_string()),
        };

        let json = serde_json::to_value(&state).unwrap();

        assert_eq!(json["processing"], true);
        assert_eq!(json["executing_cell_id"], "cell-1");
        assert_eq!(json["cells"].as_array().unwrap().len(), 1);
    }

    // ==================== Kernel Retry Tests ====================

    #[test]
    fn test_new_queue_has_zero_retry_count() {
        let queue = ExecutionQueue::new();
        assert_eq!(queue.kernel_retry_count, 0);
    }

    #[test]
    fn test_increment_kernel_retry_returns_true_under_limit() {
        let mut queue = ExecutionQueue::new();
        for _ in 0..(MAX_KERNEL_RETRIES - 1) {
            assert!(queue.increment_kernel_retry());
        }
    }

    #[test]
    fn test_increment_kernel_retry_returns_false_at_limit() {
        let mut queue = ExecutionQueue::new();
        for _ in 0..MAX_KERNEL_RETRIES {
            queue.increment_kernel_retry();
        }
        assert!(!queue.increment_kernel_retry());
    }

    #[test]
    fn test_reset_kernel_retry_clears_count() {
        let mut queue = ExecutionQueue::new();
        for _ in 0..10 {
            queue.increment_kernel_retry();
        }
        queue.reset_kernel_retry();
        assert_eq!(queue.kernel_retry_count, 0);
    }
}
