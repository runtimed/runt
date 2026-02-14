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

/// The execution queue - owns the pending/executing state
pub struct ExecutionQueue {
    /// Pending cell IDs (FIFO)
    pending: VecDeque<String>,
    /// Currently executing cell ID
    executing: Option<String>,
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
        }
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
        // Kernel not running - we need to wait for it
        info!("[queue] Kernel not running, scheduling retry...");
        // Put the cell back at the front
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
        return;
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
