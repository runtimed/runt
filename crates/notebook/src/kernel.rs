use crate::conda_env::{CondaDependencies, CondaEnvironment, EnvProgressEvent, EnvProgressPhase};
use crate::execution_queue::QueueCommand;
use crate::tools;
use crate::uv_env::{NotebookDependencies, UvEnvironment};
use anyhow::Result;
use bytes::Bytes;
use jupyter_protocol::{
    media::Media, CompleteRequest, ConnectionInfo, ExecuteRequest, HistoryRequest,
    InterruptRequest, JupyterMessage, JupyterMessageContent, KernelInfoRequest, Payload,
    ShutdownRequest,
};
use log::{debug, error, info, warn};
use serde::Serialize;
use serde_json::Value;
use std::collections::HashMap;
use std::net::Ipv4Addr;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::{Arc, Mutex as StdMutex};
use tauri::{AppHandle, Emitter};
use tauri_jupyter::{serialize_buffers, RawJupyterMessage};
use tokio::sync::mpsc;
use uuid::Uuid;

/// Serializable Jupyter message for sending to the frontend via Tauri events.
#[derive(Serialize, Clone)]
pub struct TauriJupyterMessage {
    pub header: jupyter_protocol::Header,
    pub parent_header: Option<jupyter_protocol::Header>,
    pub metadata: Value,
    pub content: JupyterMessageContent,
    #[serde(serialize_with = "serialize_buffers")]
    pub buffers: Vec<Bytes>,
    pub channel: Option<jupyter_protocol::Channel>,
    /// The cell_id this message belongs to (resolved from parent_header.msg_id)
    pub cell_id: Option<String>,
}

/// Shared mapping from msg_id → cell_id, used by iopub listener to tag messages.
type CellIdMap = Arc<StdMutex<HashMap<String, String>>>;

/// Pending completion requests: msg_id → oneshot sender for routing complete_reply.
type PendingCompletions =
    Arc<StdMutex<HashMap<String, tokio::sync::oneshot::Sender<CompletionResult>>>>;

/// Pending history requests: msg_id → oneshot sender for routing history_reply.
type PendingHistory = Arc<StdMutex<HashMap<String, tokio::sync::oneshot::Sender<HistoryResult>>>>;

/// Get the working directory for kernel processes.
/// - If notebook_path is provided, uses its parent directory
/// - If running from CLI (cwd is not `/`), uses the current working directory
/// - Otherwise falls back to ~/notebooks (creating it if needed)
/// - If ~/notebooks creation fails, falls back to home directory, then temp directory
fn kernel_cwd(notebook_path: Option<&std::path::Path>) -> std::path::PathBuf {
    // If notebook has a path, use its parent directory (canonicalized to absolute path
    // so child processes get a valid working directory even when the notebook was opened
    // with a relative path, e.g. via Cmd-O file dialog)
    if let Some(parent) = notebook_path.and_then(|p| p.parent()) {
        return parent.canonicalize().unwrap_or_else(|_| parent.to_path_buf());
    }

    // Check if we're running from CLI (cwd is something other than `/`)
    // App bundles on macOS run with `/` as cwd, but CLI usage preserves shell cwd
    if let Ok(cwd) = std::env::current_dir() {
        if cwd != std::path::Path::new("/") {
            return cwd;
        }
    }

    // Fall back to ~/notebooks, creating it if needed
    if let Some(home) = dirs::home_dir() {
        let notebooks_dir = home.join("notebooks");
        match std::fs::create_dir(&notebooks_dir) {
            Ok(()) => return notebooks_dir,
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => return notebooks_dir,
            Err(_) => return home,
        }
    }

    std::env::temp_dir()
}

#[derive(Serialize, Clone)]
pub struct CompletionResult {
    pub matches: Vec<String>,
    pub cursor_start: usize,
    pub cursor_end: usize,
}

/// Result from a history request
#[derive(Serialize, Clone)]
pub struct HistoryResult {
    pub entries: Vec<HistoryEntryData>,
}

#[derive(Serialize, Clone)]
pub struct HistoryEntryData {
    pub session: usize,
    pub line: usize,
    pub source: String,
}

/// Event payload for page payloads (triggered by `?` or `??` in IPython).
#[derive(Serialize, Clone)]
pub struct PagePayloadEvent {
    pub cell_id: String,
    pub data: Media,
    pub start: usize,
}

pub struct NotebookKernel {
    connection_info: Option<ConnectionInfo>,
    connection_file: Option<PathBuf>,
    session_id: String,
    iopub_task: Option<tokio::task::JoinHandle<()>>,
    shell_reader_task: Option<tokio::task::JoinHandle<()>>,
    shell_writer: Option<runtimelib::DealerSendConnection>,
    _process: Option<tokio::process::Child>,
    /// Process group ID for killing the kernel and all its children (Unix only)
    #[cfg(unix)]
    process_group_id: Option<i32>,
    cell_id_map: CellIdMap,
    pending_completions: PendingCompletions,
    pending_history: PendingHistory,
    /// UV-managed environment (if using inline dependencies)
    uv_environment: Option<UvEnvironment>,
    /// Conda-managed environment (if using inline conda dependencies)
    conda_environment: Option<CondaEnvironment>,
    /// Optional sender to notify execution queue when a cell finishes
    queue_tx: Option<mpsc::Sender<QueueCommand>>,
    /// Dependencies the kernel was started with (for dirty state detection)
    synced_dependencies: Option<Vec<String>>,
}

/// Emit a uv environment progress event to the frontend.
fn emit_uv_progress(app: &AppHandle, phase: EnvProgressPhase) {
    let event = EnvProgressEvent {
        env_type: "uv".to_string(),
        phase,
    };
    if let Err(e) = app.emit("env:progress", &event) {
        error!("Failed to emit uv progress: {}", e);
    }
}

impl Default for NotebookKernel {
    fn default() -> Self {
        NotebookKernel {
            connection_info: None,
            connection_file: None,
            session_id: Uuid::new_v4().to_string(),
            iopub_task: None,
            shell_reader_task: None,
            shell_writer: None,
            _process: None,
            #[cfg(unix)]
            process_group_id: None,
            cell_id_map: Arc::new(StdMutex::new(HashMap::new())),
            pending_completions: Arc::new(StdMutex::new(HashMap::new())),
            pending_history: Arc::new(StdMutex::new(HashMap::new())),
            uv_environment: None,
            conda_environment: None,
            queue_tx: None,
            synced_dependencies: None,
        }
    }
}

impl Drop for NotebookKernel {
    fn drop(&mut self) {
        // Abort any running async tasks
        if let Some(task) = self.iopub_task.take() {
            task.abort();
        }
        if let Some(task) = self.shell_reader_task.take() {
            task.abort();
        }

        // Kill the entire process group (kernel + any subprocesses it spawned)
        #[cfg(unix)]
        if let Some(pgid) = self.process_group_id.take() {
            use nix::sys::signal::{killpg, Signal};
            use nix::unistd::Pid;
            // SIGKILL the entire process group to ensure cleanup
            if let Err(e) = killpg(Pid::from_raw(pgid), Signal::SIGKILL) {
                // ESRCH (no such process) is expected if process already exited
                if e != nix::errno::Errno::ESRCH {
                    log::warn!("Failed to kill process group {}: {}", pgid, e);
                }
            }
        }

        // Process handle cleanup (kill_on_drop as backup)
        self._process = None;

        // Sync cleanup of connection file
        if let Some(ref path) = self.connection_file {
            let _ = std::fs::remove_file(path);
        }

        log::info!("NotebookKernel dropped - resources cleaned up");
    }
}

impl NotebookKernel {
    /// Set the queue command sender for notifying execution completion
    pub fn set_queue_tx(&mut self, tx: mpsc::Sender<QueueCommand>) {
        self.queue_tx = Some(tx);
    }
}

impl NotebookKernel {
    pub async fn start(
        &mut self,
        app: AppHandle,
        kernelspec_name: &str,
        notebook_path: Option<&std::path::Path>,
    ) -> Result<()> {
        // Shutdown existing kernel if any
        self.shutdown().await.ok();

        let kernelspec = runtimelib::find_kernelspec(kernelspec_name).await?;

        // Reserve ports
        let ip = std::net::IpAddr::V4(Ipv4Addr::new(127, 0, 0, 1));
        let ports = runtimelib::peek_ports(ip, 5).await?;

        let connection_info = ConnectionInfo {
            transport: jupyter_protocol::connection_info::Transport::TCP,
            ip: ip.to_string(),
            stdin_port: ports[0],
            control_port: ports[1],
            hb_port: ports[2],
            shell_port: ports[3],
            iopub_port: ports[4],
            signature_scheme: "hmac-sha256".to_string(),
            key: Uuid::new_v4().to_string(),
            kernel_name: Some(kernelspec_name.to_string()),
        };

        let runtime_dir = runtimelib::dirs::runtime_dir();
        tokio::fs::create_dir_all(&runtime_dir).await?;

        let kernel_id: String = petname::petname(2, "-").unwrap_or_else(|| Uuid::new_v4().to_string());
        let connection_file_path =
            runtime_dir.join(format!("runt-kernel-{}.json", kernel_id));

        tokio::fs::write(
            &connection_file_path,
            serde_json::to_string_pretty(&connection_info)?,
        )
        .await?;

        info!("Starting kernel {} at {:?}", kernelspec_name, connection_file_path);

        let mut cmd = kernelspec
            .command(&connection_file_path, Some(Stdio::null()), Some(Stdio::null()))?;
        cmd.current_dir(kernel_cwd(notebook_path));
        #[cfg(unix)]
        cmd.process_group(0); // Create new process group for kernel and children
        let process = cmd.kill_on_drop(true).spawn()?;

        // Store process group ID for cleanup (PGID equals PID when process_group(0) is used)
        #[cfg(unix)]
        {
            self.process_group_id = process.id().map(|pid| pid as i32);
        }

        // Small delay to let the kernel start
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;

        self.session_id = Uuid::new_v4().to_string();

        // Create iopub connection and spawn listener
        let mut iopub = runtimelib::create_client_iopub_connection(
            &connection_info,
            "",
            &self.session_id,
        )
        .await?;

        let app_handle = app.clone();
        let cell_id_map = self.cell_id_map.clone();
        let queue_tx = self.queue_tx.clone();
        let iopub_task = tokio::spawn(async move {
            loop {
                match iopub.read().await {
                    Ok(message) => {
                        debug!(
                            "iopub: type={} parent_msg_id={:?}",
                            message.header.msg_type,
                            message.parent_header.as_ref().map(|h| &h.msg_id)
                        );

                        // Look up cell_id from the msg_id → cell_id map
                        let cell_id = message
                            .parent_header
                            .as_ref()
                            .and_then(|h| cell_id_map.lock().ok()?.get(&h.msg_id).cloned());

                        // Check for status: idle to signal execution completion
                        if let JupyterMessageContent::Status(ref status) = message.content {
                            if status.execution_state == jupyter_protocol::ExecutionState::Idle {
                                if let Some(ref cid) = cell_id {
                                    if let Some(ref tx) = queue_tx {
                                        let _ = tx.try_send(QueueCommand::ExecutionDone {
                                            cell_id: cid.clone(),
                                        });
                                    }
                                }
                            }
                        }

                        let tauri_msg = TauriJupyterMessage {
                            header: message.header,
                            parent_header: message.parent_header,
                            metadata: message.metadata,
                            content: message.content,
                            buffers: message.buffers,
                            channel: message.channel,
                            cell_id,
                        };

                        if let Err(e) = app_handle.emit("kernel:iopub", &tauri_msg) {
                            error!("Failed to emit kernel:iopub: {}", e);
                            break;
                        }
                    }
                    Err(e) => {
                        error!("iopub read error: {}", e);
                        break;
                    }
                }
            }
        });

        // Create persistent shell connection
        let identity = runtimelib::peer_identity_for_session(&self.session_id)?;
        let mut shell =
            runtimelib::create_client_shell_connection_with_identity(&connection_info, &self.session_id, identity).await?;

        // Verify kernel is alive with kernel_info handshake
        let request: JupyterMessage = KernelInfoRequest::default().into();
        shell.send(request).await?;

        let reply = tokio::time::timeout(std::time::Duration::from_secs(30), shell.read()).await;
        match reply {
            Ok(Ok(msg)) => {
                info!("Kernel alive: got {} reply", msg.header.msg_type);
            }
            Ok(Err(e)) => {
                error!("Error reading kernel_info_reply: {}", e);
                return Err(anyhow::anyhow!("Kernel did not respond: {}", e));
            }
            Err(_) => {
                error!("Timeout waiting for kernel_info_reply");
                return Err(anyhow::anyhow!("Kernel did not respond within 30s"));
            }
        }

        // Split shell into persistent writer + reader
        let (shell_writer, mut shell_reader) = shell.split();

        let pending = self.pending_completions.clone();
        let pending_hist = self.pending_history.clone();
        let shell_app = app.clone();
        let shell_cell_id_map = self.cell_id_map.clone();
        let shell_reader_task = tokio::spawn(async move {
            loop {
                match shell_reader.read().await {
                    Ok(msg) => {
                        let parent_msg_id = msg
                            .parent_header
                            .as_ref()
                            .map(|h| h.msg_id.clone());

                        match msg.content {
                            JupyterMessageContent::CompleteReply(reply) => {
                                if let Some(ref msg_id) = parent_msg_id {
                                    if let Some(sender) =
                                        pending.lock().unwrap().remove(msg_id)
                                    {
                                        let _ = sender.send(CompletionResult {
                                            matches: reply.matches,
                                            cursor_start: reply.cursor_start,
                                            cursor_end: reply.cursor_end,
                                        });
                                    }
                                }
                            }
                            JupyterMessageContent::HistoryReply(reply) => {
                                if let Some(ref msg_id) = parent_msg_id {
                                    if let Some(sender) =
                                        pending_hist.lock().unwrap().remove(msg_id)
                                    {
                                        let entries = reply
                                            .history
                                            .into_iter()
                                            .map(|entry| match entry {
                                                jupyter_protocol::HistoryEntry::Input(
                                                    session,
                                                    line,
                                                    source,
                                                ) => HistoryEntryData {
                                                    session,
                                                    line,
                                                    source,
                                                },
                                                jupyter_protocol::HistoryEntry::InputOutput(
                                                    session,
                                                    line,
                                                    (source, _),
                                                ) => HistoryEntryData {
                                                    session,
                                                    line,
                                                    source,
                                                },
                                            })
                                            .collect();
                                        let _ = sender.send(HistoryResult { entries });
                                    }
                                }
                            }
                            JupyterMessageContent::ExecuteReply(ref reply) => {
                                // Handle page payloads from introspection (? and ??)
                                for payload in &reply.payload {
                                    if let Payload::Page { data, start } = payload {
                                        // Look up cell_id from msg_id
                                        let cell_id = parent_msg_id.as_ref().and_then(|msg_id| {
                                            shell_cell_id_map.lock().ok()?.get(msg_id).cloned()
                                        });

                                        if let Some(cell_id) = cell_id {
                                            let event = PagePayloadEvent {
                                                cell_id,
                                                data: data.clone(),
                                                start: *start,
                                            };
                                            if let Err(e) =
                                                shell_app.emit("kernel:page_payload", &event)
                                            {
                                                error!("Failed to emit page_payload: {}", e);
                                            }
                                        }
                                    }
                                }
                            }
                            _ => {
                                debug!("shell reply: type={}", msg.header.msg_type);
                            }
                        }
                    }
                    Err(e) => {
                        error!("shell read error: {}", e);
                        break;
                    }
                }
            }
        });

        self.connection_info = Some(connection_info);
        self.connection_file = Some(connection_file_path);
        self.iopub_task = Some(iopub_task);
        self.shell_reader_task = Some(shell_reader_task);
        self.shell_writer = Some(shell_writer);
        self._process = Some(process);

        info!("Kernel started: {}", kernel_id);
        Ok(())
    }

    /// Start a kernel with uv-managed dependencies.
    ///
    /// Creates an ephemeral virtual environment using uv with the specified
    /// dependencies, installs ipykernel, and launches the kernel from that environment.
    ///
    /// The `env_id` parameter enables per-notebook isolation for empty deps.
    pub async fn start_with_uv(
        &mut self,
        app: AppHandle,
        deps: &NotebookDependencies,
        env_id: Option<&str>,
        notebook_path: Option<&std::path::Path>,
    ) -> Result<()> {
        // Shutdown existing kernel if any
        self.shutdown().await.ok();

        info!("Preparing uv environment with deps: {:?}", deps.dependencies);

        // Prepare the uv environment
        let env = crate::uv_env::prepare_environment(deps, env_id).await?;

        // Reserve ports
        let ip = std::net::IpAddr::V4(Ipv4Addr::new(127, 0, 0, 1));
        let ports = runtimelib::peek_ports(ip, 5).await?;

        let connection_info = ConnectionInfo {
            transport: jupyter_protocol::connection_info::Transport::TCP,
            ip: ip.to_string(),
            stdin_port: ports[0],
            control_port: ports[1],
            hb_port: ports[2],
            shell_port: ports[3],
            iopub_port: ports[4],
            signature_scheme: "hmac-sha256".to_string(),
            key: Uuid::new_v4().to_string(),
            kernel_name: Some("python3".to_string()),
        };

        let runtime_dir = runtimelib::dirs::runtime_dir();
        tokio::fs::create_dir_all(&runtime_dir).await?;

        let kernel_id: String =
            petname::petname(2, "-").unwrap_or_else(|| Uuid::new_v4().to_string());
        let connection_file_path = runtime_dir.join(format!("runt-kernel-{}.json", kernel_id));

        tokio::fs::write(
            &connection_file_path,
            serde_json::to_string_pretty(&connection_info)?,
        )
        .await?;

        info!(
            "Starting uv-managed kernel at {:?} with python {:?}",
            connection_file_path, env.python_path
        );

        // Spawn kernel using python from the uv environment
        let mut cmd = tokio::process::Command::new(&env.python_path);
        cmd.args(["-m", "ipykernel_launcher", "-f"])
            .arg(&connection_file_path)
            .current_dir(kernel_cwd(notebook_path))
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        #[cfg(unix)]
        cmd.process_group(0); // Create new process group for kernel and children
        let process = cmd.kill_on_drop(true).spawn()?;

        // Store process group ID for cleanup
        #[cfg(unix)]
        {
            self.process_group_id = process.id().map(|pid| pid as i32);
        }

        // Small delay to let the kernel start
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;

        self.session_id = Uuid::new_v4().to_string();

        // Create iopub connection and spawn listener
        let mut iopub = runtimelib::create_client_iopub_connection(
            &connection_info,
            "",
            &self.session_id,
        )
        .await?;

        let app_handle = app.clone();
        let cell_id_map = self.cell_id_map.clone();
        let queue_tx = self.queue_tx.clone();
        let iopub_task = tokio::spawn(async move {
            loop {
                match iopub.read().await {
                    Ok(message) => {
                        debug!(
                            "iopub: type={} parent_msg_id={:?}",
                            message.header.msg_type,
                            message.parent_header.as_ref().map(|h| &h.msg_id)
                        );

                        // Look up cell_id from the msg_id → cell_id map
                        let cell_id = message
                            .parent_header
                            .as_ref()
                            .and_then(|h| cell_id_map.lock().ok()?.get(&h.msg_id).cloned());

                        // Check for status: idle to signal execution completion
                        if let JupyterMessageContent::Status(ref status) = message.content {
                            if status.execution_state == jupyter_protocol::ExecutionState::Idle {
                                if let Some(ref cid) = cell_id {
                                    if let Some(ref tx) = queue_tx {
                                        let _ = tx.try_send(QueueCommand::ExecutionDone {
                                            cell_id: cid.clone(),
                                        });
                                    }
                                }
                            }
                        }

                        let tauri_msg = TauriJupyterMessage {
                            header: message.header,
                            parent_header: message.parent_header,
                            metadata: message.metadata,
                            content: message.content,
                            buffers: message.buffers,
                            channel: message.channel,
                            cell_id,
                        };

                        if let Err(e) = app_handle.emit("kernel:iopub", &tauri_msg) {
                            error!("Failed to emit kernel:iopub: {}", e);
                            break;
                        }
                    }
                    Err(e) => {
                        error!("iopub read error: {}", e);
                        break;
                    }
                }
            }
        });

        // Create persistent shell connection
        let identity = runtimelib::peer_identity_for_session(&self.session_id)?;
        let mut shell = runtimelib::create_client_shell_connection_with_identity(
            &connection_info,
            &self.session_id,
            identity,
        )
        .await?;

        // Verify kernel is alive with kernel_info handshake
        let request: JupyterMessage = KernelInfoRequest::default().into();
        shell.send(request).await?;

        let reply = tokio::time::timeout(std::time::Duration::from_secs(30), shell.read()).await;
        match reply {
            Ok(Ok(msg)) => {
                info!("Kernel alive: got {} reply", msg.header.msg_type);
            }
            Ok(Err(e)) => {
                error!("Error reading kernel_info_reply: {}", e);
                return Err(anyhow::anyhow!("Kernel did not respond: {}", e));
            }
            Err(_) => {
                error!("Timeout waiting for kernel_info_reply");
                return Err(anyhow::anyhow!("Kernel did not respond within 30s"));
            }
        }

        // Split shell into persistent writer + reader
        let (shell_writer, mut shell_reader) = shell.split();

        let pending = self.pending_completions.clone();
        let pending_hist = self.pending_history.clone();
        let shell_app = app.clone();
        let shell_cell_id_map = self.cell_id_map.clone();
        let shell_reader_task = tokio::spawn(async move {
            loop {
                match shell_reader.read().await {
                    Ok(msg) => {
                        let parent_msg_id = msg.parent_header.as_ref().map(|h| h.msg_id.clone());

                        match msg.content {
                            JupyterMessageContent::CompleteReply(reply) => {
                                if let Some(ref msg_id) = parent_msg_id {
                                    if let Some(sender) = pending.lock().unwrap().remove(msg_id) {
                                        let _ = sender.send(CompletionResult {
                                            matches: reply.matches,
                                            cursor_start: reply.cursor_start,
                                            cursor_end: reply.cursor_end,
                                        });
                                    }
                                }
                            }
                            JupyterMessageContent::HistoryReply(reply) => {
                                if let Some(ref msg_id) = parent_msg_id {
                                    if let Some(sender) = pending_hist.lock().unwrap().remove(msg_id)
                                    {
                                        let entries = reply
                                            .history
                                            .into_iter()
                                            .map(|entry| match entry {
                                                jupyter_protocol::HistoryEntry::Input(
                                                    session,
                                                    line,
                                                    source,
                                                ) => HistoryEntryData {
                                                    session,
                                                    line,
                                                    source,
                                                },
                                                jupyter_protocol::HistoryEntry::InputOutput(
                                                    session,
                                                    line,
                                                    (source, _),
                                                ) => HistoryEntryData {
                                                    session,
                                                    line,
                                                    source,
                                                },
                                            })
                                            .collect();
                                        let _ = sender.send(HistoryResult { entries });
                                    }
                                }
                            }
                            JupyterMessageContent::ExecuteReply(ref reply) => {
                                // Handle page payloads from introspection (? and ??)
                                for payload in &reply.payload {
                                    if let Payload::Page { data, start } = payload {
                                        let cell_id = parent_msg_id.as_ref().and_then(|msg_id| {
                                            shell_cell_id_map.lock().ok()?.get(msg_id).cloned()
                                        });

                                        if let Some(cell_id) = cell_id {
                                            let event = PagePayloadEvent {
                                                cell_id,
                                                data: data.clone(),
                                                start: *start,
                                            };
                                            if let Err(e) =
                                                shell_app.emit("kernel:page_payload", &event)
                                            {
                                                error!("Failed to emit page_payload: {}", e);
                                            }
                                        }
                                    }
                                }
                            }
                            _ => {
                                debug!("shell reply: type={}", msg.header.msg_type);
                            }
                        }
                    }
                    Err(e) => {
                        error!("shell read error: {}", e);
                        break;
                    }
                }
            }
        });

        self.connection_info = Some(connection_info);
        self.connection_file = Some(connection_file_path);
        self.iopub_task = Some(iopub_task);
        self.shell_reader_task = Some(shell_reader_task);
        self.shell_writer = Some(shell_writer);
        self._process = Some(process);
        self.uv_environment = Some(env);
        self.synced_dependencies = Some(deps.dependencies.clone());

        info!("UV-managed kernel started: {}", kernel_id);
        Ok(())
    }

    /// Start a kernel using a prewarmed UV environment.
    ///
    /// This is similar to `start_with_uv` but skips environment preparation
    /// since the environment is already ready from the prewarming pool.
    pub async fn start_with_prewarmed_uv(
        &mut self,
        app: AppHandle,
        env: UvEnvironment,
        notebook_path: Option<&std::path::Path>,
    ) -> Result<()> {
        // Shutdown existing kernel if any
        self.shutdown().await.ok();

        info!(
            "Starting kernel with prewarmed uv environment at {:?}",
            env.venv_path
        );

        // Reserve ports
        let ip = std::net::IpAddr::V4(Ipv4Addr::new(127, 0, 0, 1));
        let ports = runtimelib::peek_ports(ip, 5).await?;

        let connection_info = ConnectionInfo {
            transport: jupyter_protocol::connection_info::Transport::TCP,
            ip: ip.to_string(),
            stdin_port: ports[0],
            control_port: ports[1],
            hb_port: ports[2],
            shell_port: ports[3],
            iopub_port: ports[4],
            signature_scheme: "hmac-sha256".to_string(),
            key: Uuid::new_v4().to_string(),
            kernel_name: Some("python3".to_string()),
        };

        let runtime_dir = runtimelib::dirs::runtime_dir();
        tokio::fs::create_dir_all(&runtime_dir).await?;

        let kernel_id: String =
            petname::petname(2, "-").unwrap_or_else(|| Uuid::new_v4().to_string());
        let connection_file_path = runtime_dir.join(format!("runt-kernel-{}.json", kernel_id));

        tokio::fs::write(
            &connection_file_path,
            serde_json::to_string_pretty(&connection_info)?,
        )
        .await?;

        info!(
            "Starting prewarmed kernel at {:?} with python {:?}",
            connection_file_path, env.python_path
        );

        // Spawn kernel using python from the prewarmed environment
        let mut cmd = tokio::process::Command::new(&env.python_path);
        cmd.args(["-m", "ipykernel_launcher", "-f"])
            .arg(&connection_file_path)
            .current_dir(kernel_cwd(notebook_path))
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        #[cfg(unix)]
        cmd.process_group(0); // Create new process group for kernel and children
        let process = cmd.kill_on_drop(true).spawn()?;

        // Store process group ID for cleanup
        #[cfg(unix)]
        {
            self.process_group_id = process.id().map(|pid| pid as i32);
        }

        // Small delay to let the kernel start
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;

        self.session_id = Uuid::new_v4().to_string();

        // Create iopub connection and spawn listener
        let mut iopub = runtimelib::create_client_iopub_connection(
            &connection_info,
            "",
            &self.session_id,
        )
        .await?;

        let app_handle = app.clone();
        let cell_id_map = self.cell_id_map.clone();
        let queue_tx = self.queue_tx.clone();
        let iopub_task = tokio::spawn(async move {
            loop {
                match iopub.read().await {
                    Ok(message) => {
                        debug!(
                            "iopub: type={} parent_msg_id={:?}",
                            message.header.msg_type,
                            message.parent_header.as_ref().map(|h| &h.msg_id)
                        );

                        // Look up cell_id from the msg_id → cell_id map
                        let cell_id = message
                            .parent_header
                            .as_ref()
                            .and_then(|h| cell_id_map.lock().ok()?.get(&h.msg_id).cloned());

                        // Check for status: idle to signal execution completion
                        if let JupyterMessageContent::Status(ref status) = message.content {
                            if status.execution_state == jupyter_protocol::ExecutionState::Idle {
                                if let Some(ref cid) = cell_id {
                                    if let Some(ref tx) = queue_tx {
                                        let _ = tx.try_send(QueueCommand::ExecutionDone {
                                            cell_id: cid.clone(),
                                        });
                                    }
                                }
                            }
                        }

                        let tauri_msg = TauriJupyterMessage {
                            header: message.header,
                            parent_header: message.parent_header,
                            metadata: message.metadata,
                            content: message.content,
                            buffers: message.buffers,
                            channel: message.channel,
                            cell_id,
                        };

                        if let Err(e) = app_handle.emit("kernel:iopub", &tauri_msg) {
                            error!("Failed to emit kernel:iopub: {}", e);
                            break;
                        }
                    }
                    Err(e) => {
                        error!("iopub read error: {}", e);
                        break;
                    }
                }
            }
        });

        // Create persistent shell connection
        let identity = runtimelib::peer_identity_for_session(&self.session_id)?;
        let mut shell = runtimelib::create_client_shell_connection_with_identity(
            &connection_info,
            &self.session_id,
            identity,
        )
        .await?;

        // Verify kernel is alive with kernel_info handshake
        let request: JupyterMessage = KernelInfoRequest::default().into();
        shell.send(request).await?;

        let reply = tokio::time::timeout(std::time::Duration::from_secs(30), shell.read()).await;
        match reply {
            Ok(Ok(msg)) => {
                info!("Prewarmed kernel alive: got {} reply", msg.header.msg_type);
            }
            Ok(Err(e)) => {
                error!("Error reading kernel_info_reply: {}", e);
                return Err(anyhow::anyhow!("Kernel did not respond: {}", e));
            }
            Err(_) => {
                error!("Timeout waiting for kernel_info_reply");
                return Err(anyhow::anyhow!("Kernel did not respond within 30s"));
            }
        }

        // Split shell into persistent writer + reader
        let (shell_writer, mut shell_reader) = shell.split();

        let pending = self.pending_completions.clone();
        let pending_hist = self.pending_history.clone();
        let shell_app = app.clone();
        let shell_cell_id_map = self.cell_id_map.clone();
        let shell_reader_task = tokio::spawn(async move {
            loop {
                match shell_reader.read().await {
                    Ok(msg) => {
                        let parent_msg_id = msg.parent_header.as_ref().map(|h| h.msg_id.clone());

                        match msg.content {
                            JupyterMessageContent::CompleteReply(reply) => {
                                if let Some(ref msg_id) = parent_msg_id {
                                    if let Some(sender) = pending.lock().unwrap().remove(msg_id) {
                                        let _ = sender.send(CompletionResult {
                                            matches: reply.matches,
                                            cursor_start: reply.cursor_start,
                                            cursor_end: reply.cursor_end,
                                        });
                                    }
                                }
                            }
                            JupyterMessageContent::HistoryReply(reply) => {
                                if let Some(ref msg_id) = parent_msg_id {
                                    if let Some(sender) = pending_hist.lock().unwrap().remove(msg_id)
                                    {
                                        let entries = reply
                                            .history
                                            .into_iter()
                                            .map(|entry| match entry {
                                                jupyter_protocol::HistoryEntry::Input(
                                                    session,
                                                    line,
                                                    source,
                                                ) => HistoryEntryData {
                                                    session,
                                                    line,
                                                    source,
                                                },
                                                jupyter_protocol::HistoryEntry::InputOutput(
                                                    session,
                                                    line,
                                                    (source, _),
                                                ) => HistoryEntryData {
                                                    session,
                                                    line,
                                                    source,
                                                },
                                            })
                                            .collect();
                                        let _ = sender.send(HistoryResult { entries });
                                    }
                                }
                            }
                            JupyterMessageContent::ExecuteReply(ref reply) => {
                                // Handle page payloads from introspection (? and ??)
                                for payload in &reply.payload {
                                    if let Payload::Page { data, start } = payload {
                                        let cell_id = parent_msg_id.as_ref().and_then(|msg_id| {
                                            shell_cell_id_map.lock().ok()?.get(msg_id).cloned()
                                        });

                                        if let Some(cell_id) = cell_id {
                                            let event = PagePayloadEvent {
                                                cell_id,
                                                data: data.clone(),
                                                start: *start,
                                            };
                                            if let Err(e) =
                                                shell_app.emit("kernel:page_payload", &event)
                                            {
                                                error!("Failed to emit page_payload: {}", e);
                                            }
                                        }
                                    }
                                }
                            }
                            _ => {
                                debug!("shell reply: type={}", msg.header.msg_type);
                            }
                        }
                    }
                    Err(e) => {
                        error!("shell read error: {}", e);
                        break;
                    }
                }
            }
        });

        self.connection_info = Some(connection_info);
        self.connection_file = Some(connection_file_path);
        self.iopub_task = Some(iopub_task);
        self.shell_reader_task = Some(shell_reader_task);
        self.shell_writer = Some(shell_writer);
        self._process = Some(process);
        self.uv_environment = Some(env);
        // Prewarmed envs start with empty deps (just ipykernel)
        self.synced_dependencies = Some(vec![]);

        info!("Prewarmed UV kernel started: {}", kernel_id);
        Ok(())
    }

    /// Start a kernel using `uv run` with a pyproject.toml.
    ///
    /// This delegates environment management to uv, which will:
    /// - Auto-detect and use the project's pyproject.toml
    /// - Create/update .venv in the project directory
    /// - Respect uv.lock if present
    /// - Add ipykernel transiently via --with
    pub async fn start_with_uv_run(
        &mut self,
        app: AppHandle,
        project_dir: &std::path::Path,
    ) -> Result<()> {
        // Shutdown existing kernel if any
        self.shutdown().await.ok();

        // Canonicalize project_dir so uv gets an absolute path
        let project_dir = project_dir.canonicalize().map_err(|e| {
            anyhow::anyhow!(
                "Failed to resolve project directory {:?}: {}",
                project_dir,
                e
            )
        })?;
        info!("Starting kernel with uv run in project {:?}", project_dir);

        // Reserve ports
        let ip = std::net::IpAddr::V4(Ipv4Addr::new(127, 0, 0, 1));
        let ports = runtimelib::peek_ports(ip, 5).await?;

        let connection_info = ConnectionInfo {
            transport: jupyter_protocol::connection_info::Transport::TCP,
            ip: ip.to_string(),
            stdin_port: ports[0],
            control_port: ports[1],
            hb_port: ports[2],
            shell_port: ports[3],
            iopub_port: ports[4],
            signature_scheme: "hmac-sha256".to_string(),
            key: Uuid::new_v4().to_string(),
            kernel_name: Some("python3".to_string()),
        };

        let runtime_dir = runtimelib::dirs::runtime_dir();
        tokio::fs::create_dir_all(&runtime_dir).await?;

        let kernel_id: String =
            petname::petname(2, "-").unwrap_or_else(|| Uuid::new_v4().to_string());
        let connection_file_path = runtime_dir.join(format!("runt-kernel-{}.json", kernel_id));

        tokio::fs::write(
            &connection_file_path,
            serde_json::to_string_pretty(&connection_info)?,
        )
        .await?;

        info!(
            "Starting uv run kernel at {:?} in project {:?}",
            connection_file_path, project_dir
        );

        // Use `uv run` to launch the kernel - this lets uv handle the environment
        // --with adds ipykernel and ipywidgets transiently without modifying pyproject.toml
        let uv_path = tools::get_uv_path().await?;
        let mut cmd = tokio::process::Command::new(&uv_path);
        cmd.args([
            "run",
            "--directory",
            &project_dir.to_string_lossy(),
            "--with",
            "ipykernel",
            "--with",
            "ipywidgets",
            "python",
            "-m",
            "ipykernel_launcher",
            "-f",
        ])
        .arg(&connection_file_path)
        .current_dir(&project_dir)
        .stdout(Stdio::null())
        .stderr(Stdio::piped());
        #[cfg(unix)]
        cmd.process_group(0); // Create new process group for kernel and children
        let mut process = cmd.kill_on_drop(true).spawn()?;

        // Store process group ID for cleanup
        #[cfg(unix)]
        {
            self.process_group_id = process.id().map(|pid| pid as i32);
        }

        // Emit starting progress
        emit_uv_progress(&app, EnvProgressPhase::Starting {
            env_hash: "pyproject".to_string(),
        });

        // Spawn a task to read stderr, emit progress events, and buffer lines for error reporting
        let stderr = process.stderr.take();
        let stderr_app = app.clone();
        let stderr_lines = std::sync::Arc::new(tokio::sync::Mutex::new(Vec::<String>::new()));
        let stderr_lines_writer = stderr_lines.clone();
        let _stderr_task = tokio::spawn(async move {
            if let Some(stderr) = stderr {
                use tokio::io::{AsyncBufReadExt, BufReader};
                let reader = BufReader::new(stderr);
                let mut lines = reader.lines();
                while let Ok(Some(line)) = lines.next_line().await {
                    debug!("uv stderr: {}", line);

                    // Buffer line for error reporting (keep last 20 lines)
                    {
                        let mut buf = stderr_lines_writer.lock().await;
                        buf.push(line.clone());
                        if buf.len() > 20 {
                            buf.remove(0);
                        }
                    }

                    let line_lower = line.to_lowercase();
                    if line_lower.contains("resolved") && line_lower.contains("package") {
                        emit_uv_progress(&stderr_app, EnvProgressPhase::Solving { spec_count: 0 });
                    } else if (line_lower.contains("installed") || line_lower.contains("installing"))
                        && line_lower.contains("package")
                    {
                        emit_uv_progress(&stderr_app, EnvProgressPhase::Installing { total: 0 });
                    } else if line_lower.contains("audited") && line_lower.contains("package") {
                        // uv found existing .venv, just auditing
                        emit_uv_progress(&stderr_app, EnvProgressPhase::Installing { total: 0 });
                    }
                }
            }
        });

        // Retry connecting to the kernel with increasing delays.
        // uv run may need to create .venv and install deps before the kernel binds ports.
        self.session_id = Uuid::new_v4().to_string();
        let delays_ms: &[u64] = &[2000, 3000, 5000, 10000, 15000, 15000, 15000, 15000];
        let mut connected = false;
        let mut last_error: Option<String> = None;

        let mut iopub_conn = None;
        let mut shell_conn = None;

        for (attempt, &delay) in delays_ms.iter().enumerate() {
            tokio::time::sleep(std::time::Duration::from_millis(delay)).await;

            // Check if uv run process already exited (error case)
            if let Ok(Some(status)) = process.try_wait() {
                // Give stderr reader a moment to drain remaining output
                tokio::time::sleep(std::time::Duration::from_millis(100)).await;
                let captured = stderr_lines.lock().await;
                let stderr_detail = if captured.is_empty() {
                    String::new()
                } else {
                    format!("\n{}", captured.join("\n"))
                };
                let msg = format!("uv run exited with {}{}", status, stderr_detail);
                emit_uv_progress(&app, EnvProgressPhase::Error {
                    message: msg.clone(),
                });
                return Err(anyhow::anyhow!(msg));
            }

            // Try iopub connection
            let iopub = match runtimelib::create_client_iopub_connection(
                &connection_info,
                "",
                &self.session_id,
            )
            .await
            {
                Ok(c) => c,
                Err(e) => {
                    info!("uv run: iopub attempt {} failed: {}", attempt + 1, e);
                    last_error = Some(format!("iopub: {}", e));
                    continue;
                }
            };

            // Try shell connection
            let identity = match runtimelib::peer_identity_for_session(&self.session_id) {
                Ok(id) => id,
                Err(e) => {
                    last_error = Some(format!("identity: {}", e));
                    continue;
                }
            };
            let mut shell = match runtimelib::create_client_shell_connection_with_identity(
                &connection_info,
                &self.session_id,
                identity,
            )
            .await
            {
                Ok(c) => c,
                Err(e) => {
                    info!("uv run: shell attempt {} failed: {}", attempt + 1, e);
                    last_error = Some(format!("shell: {}", e));
                    continue;
                }
            };

            // Try kernel_info handshake with a short timeout
            let request: JupyterMessage = KernelInfoRequest::default().into();
            if let Err(e) = shell.send(request).await {
                warn!("uv run: kernel_info send failed attempt {}: {}", attempt + 1, e);
                last_error = Some(format!("send: {}", e));
                continue;
            }

            match tokio::time::timeout(std::time::Duration::from_secs(10), shell.read()).await {
                Ok(Ok(msg)) => {
                    info!(
                        "uv run: kernel alive on attempt {} — got {} reply",
                        attempt + 1,
                        msg.header.msg_type
                    );
                    iopub_conn = Some(iopub);
                    shell_conn = Some(shell);
                    connected = true;
                    break;
                }
                Ok(Err(e)) => {
                    info!("uv run: kernel_info_reply error attempt {}: {}", attempt + 1, e);
                    last_error = Some(format!("reply: {}", e));
                }
                Err(_) => {
                    info!("uv run: kernel_info_reply timeout attempt {}", attempt + 1);
                    last_error = Some("timeout".to_string());
                }
            }
        }

        if !connected {
            let captured = stderr_lines.lock().await;
            let stderr_hint = if captured.is_empty() {
                String::new()
            } else {
                let last_lines: Vec<&str> = captured.iter().rev().take(5)
                    .map(|s| s.as_str()).collect::<Vec<_>>().into_iter().rev().collect();
                format!("\nLast stderr: {}", last_lines.join("\n"))
            };
            let msg = format!(
                "Kernel did not respond after {} attempts (last: {}){}",
                delays_ms.len(),
                last_error.unwrap_or_else(|| "unknown".to_string()),
                stderr_hint
            );
            emit_uv_progress(&app, EnvProgressPhase::Error { message: msg.clone() });
            return Err(anyhow::anyhow!(msg));
        }

        // Unwrap the successful connections
        let mut iopub = iopub_conn.expect("iopub must be set when connected=true");
        let shell = shell_conn.expect("shell must be set when connected=true");

        emit_uv_progress(&app, EnvProgressPhase::Ready {
            env_path: project_dir.to_string_lossy().to_string(),
            python_path: "python".to_string(),
        });

        // Spawn iopub listener
        let app_handle = app.clone();
        let cell_id_map = self.cell_id_map.clone();
        let queue_tx = self.queue_tx.clone();
        let iopub_task = tokio::spawn(async move {
            loop {
                match iopub.read().await {
                    Ok(message) => {
                        debug!(
                            "iopub: type={} parent_msg_id={:?}",
                            message.header.msg_type,
                            message.parent_header.as_ref().map(|h| &h.msg_id)
                        );

                        // Look up cell_id from the msg_id → cell_id map
                        let cell_id = message
                            .parent_header
                            .as_ref()
                            .and_then(|h| cell_id_map.lock().ok()?.get(&h.msg_id).cloned());

                        // Check for status: idle to signal execution completion
                        if let JupyterMessageContent::Status(ref status) = message.content {
                            if status.execution_state == jupyter_protocol::ExecutionState::Idle {
                                if let Some(ref cid) = cell_id {
                                    if let Some(ref tx) = queue_tx {
                                        let _ = tx.try_send(QueueCommand::ExecutionDone {
                                            cell_id: cid.clone(),
                                        });
                                    }
                                }
                            }
                        }

                        let tauri_msg = TauriJupyterMessage {
                            header: message.header,
                            parent_header: message.parent_header,
                            metadata: message.metadata,
                            content: message.content,
                            buffers: message.buffers,
                            channel: message.channel,
                            cell_id,
                        };

                        if let Err(e) = app_handle.emit("kernel:iopub", &tauri_msg) {
                            error!("Failed to emit kernel:iopub: {}", e);
                            break;
                        }
                    }
                    Err(e) => {
                        error!("iopub read error: {}", e);
                        break;
                    }
                }
            }
        });

        // Split shell into persistent writer + reader
        let (shell_writer, mut shell_reader) = shell.split();

        let pending = self.pending_completions.clone();
        let pending_hist = self.pending_history.clone();
        let shell_app = app.clone();
        let shell_cell_id_map = self.cell_id_map.clone();
        let shell_reader_task = tokio::spawn(async move {
            loop {
                match shell_reader.read().await {
                    Ok(msg) => {
                        let parent_msg_id = msg.parent_header.as_ref().map(|h| h.msg_id.clone());

                        match msg.content {
                            JupyterMessageContent::CompleteReply(reply) => {
                                if let Some(ref msg_id) = parent_msg_id {
                                    if let Some(sender) = pending.lock().unwrap().remove(msg_id) {
                                        let _ = sender.send(CompletionResult {
                                            matches: reply.matches,
                                            cursor_start: reply.cursor_start,
                                            cursor_end: reply.cursor_end,
                                        });
                                    }
                                }
                            }
                            JupyterMessageContent::HistoryReply(reply) => {
                                if let Some(ref msg_id) = parent_msg_id {
                                    if let Some(sender) = pending_hist.lock().unwrap().remove(msg_id)
                                    {
                                        let entries = reply
                                            .history
                                            .into_iter()
                                            .map(|entry| match entry {
                                                jupyter_protocol::HistoryEntry::Input(
                                                    session,
                                                    line,
                                                    source,
                                                ) => HistoryEntryData {
                                                    session,
                                                    line,
                                                    source,
                                                },
                                                jupyter_protocol::HistoryEntry::InputOutput(
                                                    session,
                                                    line,
                                                    (source, _),
                                                ) => HistoryEntryData {
                                                    session,
                                                    line,
                                                    source,
                                                },
                                            })
                                            .collect();
                                        let _ = sender.send(HistoryResult { entries });
                                    }
                                }
                            }
                            JupyterMessageContent::ExecuteReply(ref reply) => {
                                // Handle page payloads from introspection (? and ??)
                                for payload in &reply.payload {
                                    if let Payload::Page { data, start } = payload {
                                        let cell_id = parent_msg_id.as_ref().and_then(|msg_id| {
                                            shell_cell_id_map.lock().ok()?.get(msg_id).cloned()
                                        });

                                        if let Some(cell_id) = cell_id {
                                            let event = PagePayloadEvent {
                                                cell_id,
                                                data: data.clone(),
                                                start: *start,
                                            };
                                            if let Err(e) =
                                                shell_app.emit("kernel:page_payload", &event)
                                            {
                                                error!("Failed to emit page_payload: {}", e);
                                            }
                                        }
                                    }
                                }
                            }
                            _ => {
                                debug!("shell reply: type={}", msg.header.msg_type);
                            }
                        }
                    }
                    Err(e) => {
                        error!("shell read error: {}", e);
                        break;
                    }
                }
            }
        });

        self.connection_info = Some(connection_info);
        self.connection_file = Some(connection_file_path);
        self.iopub_task = Some(iopub_task);
        self.shell_reader_task = Some(shell_reader_task);
        self.shell_writer = Some(shell_writer);
        self._process = Some(process);
        // Note: uv_environment is None - uv manages the .venv in the project

        info!("Kernel started with uv run: {}", kernel_id);
        Ok(())
    }

    /// Start a kernel with conda-managed dependencies.
    ///
    /// Creates an ephemeral conda environment using rattler with the specified
    /// dependencies, installs ipykernel, and launches the kernel from that environment.
    pub async fn start_with_conda(
        &mut self,
        app: AppHandle,
        deps: &CondaDependencies,
        notebook_path: Option<&std::path::Path>,
    ) -> Result<()> {
        // Shutdown existing kernel if any
        self.shutdown().await.ok();

        info!("Preparing conda environment with deps: {:?}", deps.dependencies);

        // Prepare the conda environment with progress events
        let env = crate::conda_env::prepare_environment(deps, Some(&app)).await?;

        // Reserve ports
        let ip = std::net::IpAddr::V4(Ipv4Addr::new(127, 0, 0, 1));
        let ports = runtimelib::peek_ports(ip, 5).await?;

        let connection_info = ConnectionInfo {
            transport: jupyter_protocol::connection_info::Transport::TCP,
            ip: ip.to_string(),
            stdin_port: ports[0],
            control_port: ports[1],
            hb_port: ports[2],
            shell_port: ports[3],
            iopub_port: ports[4],
            signature_scheme: "hmac-sha256".to_string(),
            key: Uuid::new_v4().to_string(),
            kernel_name: Some("python3".to_string()),
        };

        let runtime_dir = runtimelib::dirs::runtime_dir();
        tokio::fs::create_dir_all(&runtime_dir).await?;

        let kernel_id: String =
            petname::petname(2, "-").unwrap_or_else(|| Uuid::new_v4().to_string());
        let connection_file_path = runtime_dir.join(format!("runt-kernel-{}.json", kernel_id));

        tokio::fs::write(
            &connection_file_path,
            serde_json::to_string_pretty(&connection_info)?,
        )
        .await?;

        info!(
            "Starting conda-managed kernel at {:?} with python {:?}",
            connection_file_path, env.python_path
        );

        // Spawn kernel using python from the conda environment
        let mut cmd = tokio::process::Command::new(&env.python_path);
        cmd.args(["-m", "ipykernel_launcher", "-f"])
            .arg(&connection_file_path)
            .current_dir(kernel_cwd(notebook_path))
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        #[cfg(unix)]
        cmd.process_group(0); // Create new process group for kernel and children
        let process = cmd.kill_on_drop(true).spawn()?;

        // Store process group ID for cleanup
        #[cfg(unix)]
        {
            self.process_group_id = process.id().map(|pid| pid as i32);
        }

        // Small delay to let the kernel start
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;

        self.session_id = Uuid::new_v4().to_string();

        // Create iopub connection and spawn listener
        let mut iopub = runtimelib::create_client_iopub_connection(
            &connection_info,
            "",
            &self.session_id,
        )
        .await?;

        let app_handle = app.clone();
        let cell_id_map = self.cell_id_map.clone();
        let queue_tx = self.queue_tx.clone();
        let iopub_task = tokio::spawn(async move {
            loop {
                match iopub.read().await {
                    Ok(message) => {
                        debug!(
                            "iopub: type={} parent_msg_id={:?}",
                            message.header.msg_type,
                            message.parent_header.as_ref().map(|h| &h.msg_id)
                        );

                        // Look up cell_id from the msg_id → cell_id map
                        let cell_id = message
                            .parent_header
                            .as_ref()
                            .and_then(|h| cell_id_map.lock().ok()?.get(&h.msg_id).cloned());

                        // Check for status: idle to signal execution completion
                        if let JupyterMessageContent::Status(ref status) = message.content {
                            if status.execution_state == jupyter_protocol::ExecutionState::Idle {
                                if let Some(ref cid) = cell_id {
                                    if let Some(ref tx) = queue_tx {
                                        let _ = tx.try_send(QueueCommand::ExecutionDone {
                                            cell_id: cid.clone(),
                                        });
                                    }
                                }
                            }
                        }

                        let tauri_msg = TauriJupyterMessage {
                            header: message.header,
                            parent_header: message.parent_header,
                            metadata: message.metadata,
                            content: message.content,
                            buffers: message.buffers,
                            channel: message.channel,
                            cell_id,
                        };

                        if let Err(e) = app_handle.emit("kernel:iopub", &tauri_msg) {
                            error!("Failed to emit kernel:iopub: {}", e);
                            break;
                        }
                    }
                    Err(e) => {
                        error!("iopub read error: {}", e);
                        break;
                    }
                }
            }
        });

        // Create persistent shell connection
        let identity = runtimelib::peer_identity_for_session(&self.session_id)?;
        let mut shell = runtimelib::create_client_shell_connection_with_identity(
            &connection_info,
            &self.session_id,
            identity,
        )
        .await?;

        // Verify kernel is alive with kernel_info handshake
        let request: JupyterMessage = KernelInfoRequest::default().into();
        shell.send(request).await?;

        let reply = tokio::time::timeout(std::time::Duration::from_secs(30), shell.read()).await;
        match reply {
            Ok(Ok(msg)) => {
                info!("Kernel alive: got {} reply", msg.header.msg_type);
            }
            Ok(Err(e)) => {
                error!("Error reading kernel_info_reply: {}", e);
                return Err(anyhow::anyhow!("Kernel did not respond: {}", e));
            }
            Err(_) => {
                error!("Timeout waiting for kernel_info_reply");
                return Err(anyhow::anyhow!("Kernel did not respond within 30s"));
            }
        }

        // Split shell into persistent writer + reader
        let (shell_writer, mut shell_reader) = shell.split();

        let pending = self.pending_completions.clone();
        let pending_hist = self.pending_history.clone();
        let shell_app = app.clone();
        let shell_cell_id_map = self.cell_id_map.clone();
        let shell_reader_task = tokio::spawn(async move {
            loop {
                match shell_reader.read().await {
                    Ok(msg) => {
                        let parent_msg_id = msg.parent_header.as_ref().map(|h| h.msg_id.clone());

                        match msg.content {
                            JupyterMessageContent::CompleteReply(reply) => {
                                if let Some(ref msg_id) = parent_msg_id {
                                    if let Some(sender) = pending.lock().unwrap().remove(msg_id) {
                                        let _ = sender.send(CompletionResult {
                                            matches: reply.matches,
                                            cursor_start: reply.cursor_start,
                                            cursor_end: reply.cursor_end,
                                        });
                                    }
                                }
                            }
                            JupyterMessageContent::HistoryReply(reply) => {
                                if let Some(ref msg_id) = parent_msg_id {
                                    if let Some(sender) = pending_hist.lock().unwrap().remove(msg_id)
                                    {
                                        let entries = reply
                                            .history
                                            .into_iter()
                                            .map(|entry| match entry {
                                                jupyter_protocol::HistoryEntry::Input(
                                                    session,
                                                    line,
                                                    source,
                                                ) => HistoryEntryData {
                                                    session,
                                                    line,
                                                    source,
                                                },
                                                jupyter_protocol::HistoryEntry::InputOutput(
                                                    session,
                                                    line,
                                                    (source, _),
                                                ) => HistoryEntryData {
                                                    session,
                                                    line,
                                                    source,
                                                },
                                            })
                                            .collect();
                                        let _ = sender.send(HistoryResult { entries });
                                    }
                                }
                            }
                            JupyterMessageContent::ExecuteReply(ref reply) => {
                                // Handle page payloads from introspection (? and ??)
                                for payload in &reply.payload {
                                    if let Payload::Page { data, start } = payload {
                                        let cell_id = parent_msg_id.as_ref().and_then(|msg_id| {
                                            shell_cell_id_map.lock().ok()?.get(msg_id).cloned()
                                        });

                                        if let Some(cell_id) = cell_id {
                                            let event = PagePayloadEvent {
                                                cell_id,
                                                data: data.clone(),
                                                start: *start,
                                            };
                                            if let Err(e) =
                                                shell_app.emit("kernel:page_payload", &event)
                                            {
                                                error!("Failed to emit page_payload: {}", e);
                                            }
                                        }
                                    }
                                }
                            }
                            _ => {
                                debug!("shell reply: type={}", msg.header.msg_type);
                            }
                        }
                    }
                    Err(e) => {
                        error!("shell read error: {}", e);
                        break;
                    }
                }
            }
        });

        self.connection_info = Some(connection_info);
        self.connection_file = Some(connection_file_path);
        self.iopub_task = Some(iopub_task);
        self.shell_reader_task = Some(shell_reader_task);
        self.shell_writer = Some(shell_writer);
        self._process = Some(process);
        self.conda_environment = Some(env);

        info!("Conda-managed kernel started: {}", kernel_id);
        Ok(())
    }

    /// Start a kernel using a prewarmed conda environment.
    ///
    /// This is similar to `start_with_conda` but skips environment preparation
    /// since the environment is already ready from the prewarming pool.
    pub async fn start_with_prewarmed_conda(
        &mut self,
        app: AppHandle,
        env: CondaEnvironment,
        notebook_path: Option<&std::path::Path>,
    ) -> Result<()> {
        // Shutdown existing kernel if any
        self.shutdown().await.ok();

        info!(
            "Starting kernel with prewarmed conda environment at {:?}",
            env.env_path
        );

        // Reserve ports
        let ip = std::net::IpAddr::V4(Ipv4Addr::new(127, 0, 0, 1));
        let ports = runtimelib::peek_ports(ip, 5).await?;

        let connection_info = ConnectionInfo {
            transport: jupyter_protocol::connection_info::Transport::TCP,
            ip: ip.to_string(),
            stdin_port: ports[0],
            control_port: ports[1],
            hb_port: ports[2],
            shell_port: ports[3],
            iopub_port: ports[4],
            signature_scheme: "hmac-sha256".to_string(),
            key: Uuid::new_v4().to_string(),
            kernel_name: Some("python3".to_string()),
        };

        let runtime_dir = runtimelib::dirs::runtime_dir();
        tokio::fs::create_dir_all(&runtime_dir).await?;

        let kernel_id: String =
            petname::petname(2, "-").unwrap_or_else(|| Uuid::new_v4().to_string());
        let connection_file_path = runtime_dir.join(format!("runt-kernel-{}.json", kernel_id));

        tokio::fs::write(
            &connection_file_path,
            serde_json::to_string_pretty(&connection_info)?,
        )
        .await?;

        let kernel_start_time = std::time::Instant::now();
        info!(
            "Starting prewarmed conda kernel at {:?} with python {:?}",
            connection_file_path, env.python_path
        );

        // Spawn kernel using python from the prewarmed environment
        let mut cmd = tokio::process::Command::new(&env.python_path);
        cmd.args(["-m", "ipykernel_launcher", "-f"])
            .arg(&connection_file_path)
            .current_dir(kernel_cwd(notebook_path))
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        #[cfg(unix)]
        cmd.process_group(0); // Create new process group for kernel and children
        let process = cmd.kill_on_drop(true).spawn()?;
        info!("[kernel-timing] Process spawned in {}ms", kernel_start_time.elapsed().as_millis());

        // Store process group ID for cleanup
        #[cfg(unix)]
        {
            self.process_group_id = process.id().map(|pid| pid as i32);
        }

        // Small delay to let the kernel start
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
        info!("[kernel-timing] Post-spawn delay complete at {}ms", kernel_start_time.elapsed().as_millis());

        self.session_id = Uuid::new_v4().to_string();

        // Create iopub connection and spawn listener
        let mut iopub = runtimelib::create_client_iopub_connection(
            &connection_info,
            "",
            &self.session_id,
        )
        .await?;

        let app_handle = app.clone();
        let cell_id_map = self.cell_id_map.clone();
        let queue_tx = self.queue_tx.clone();
        let iopub_task = tokio::spawn(async move {
            loop {
                match iopub.read().await {
                    Ok(message) => {
                        debug!(
                            "iopub: type={} parent_msg_id={:?}",
                            message.header.msg_type,
                            message.parent_header.as_ref().map(|h| &h.msg_id)
                        );

                        // Look up cell_id from the msg_id → cell_id map
                        let cell_id = message
                            .parent_header
                            .as_ref()
                            .and_then(|h| cell_id_map.lock().ok()?.get(&h.msg_id).cloned());

                        // Check for status: idle to signal execution completion
                        if let JupyterMessageContent::Status(ref status) = message.content {
                            if status.execution_state == jupyter_protocol::ExecutionState::Idle {
                                if let Some(ref cid) = cell_id {
                                    if let Some(ref tx) = queue_tx {
                                        let _ = tx.try_send(QueueCommand::ExecutionDone {
                                            cell_id: cid.clone(),
                                        });
                                    }
                                }
                            }
                        }

                        let tauri_msg = TauriJupyterMessage {
                            header: message.header,
                            parent_header: message.parent_header,
                            metadata: message.metadata,
                            content: message.content,
                            buffers: message.buffers,
                            channel: message.channel,
                            cell_id,
                        };

                        if let Err(e) = app_handle.emit("kernel:iopub", &tauri_msg) {
                            error!("Failed to emit kernel:iopub: {}", e);
                            break;
                        }
                    }
                    Err(e) => {
                        error!("iopub read error: {}", e);
                        break;
                    }
                }
            }
        });

        // Create persistent shell connection
        let identity = runtimelib::peer_identity_for_session(&self.session_id)?;
        let mut shell = runtimelib::create_client_shell_connection_with_identity(
            &connection_info,
            &self.session_id,
            identity,
        )
        .await?;
        info!("[kernel-timing] Shell connection established at {}ms", kernel_start_time.elapsed().as_millis());

        // Verify kernel is alive with kernel_info handshake
        let request: JupyterMessage = KernelInfoRequest::default().into();
        shell.send(request).await?;
        info!("[kernel-timing] kernel_info_request sent at {}ms, waiting for reply...", kernel_start_time.elapsed().as_millis());

        let reply = tokio::time::timeout(std::time::Duration::from_secs(30), shell.read()).await;
        match reply {
            Ok(Ok(msg)) => {
                info!("[kernel-timing] kernel_info_reply received at {}ms", kernel_start_time.elapsed().as_millis());
                info!("Prewarmed conda kernel alive: got {} reply", msg.header.msg_type);
            }
            Ok(Err(e)) => {
                error!("Error reading kernel_info_reply: {}", e);
                return Err(anyhow::anyhow!("Kernel did not respond: {}", e));
            }
            Err(_) => {
                error!("Timeout waiting for kernel_info_reply");
                return Err(anyhow::anyhow!("Kernel did not respond within 30s"));
            }
        }

        // Split shell into persistent writer + reader
        let (shell_writer, mut shell_reader) = shell.split();

        let pending = self.pending_completions.clone();
        let pending_hist = self.pending_history.clone();
        let shell_app = app.clone();
        let shell_cell_id_map = self.cell_id_map.clone();
        let shell_reader_task = tokio::spawn(async move {
            loop {
                match shell_reader.read().await {
                    Ok(msg) => {
                        let parent_msg_id = msg.parent_header.as_ref().map(|h| h.msg_id.clone());

                        match msg.content {
                            JupyterMessageContent::CompleteReply(reply) => {
                                if let Some(ref msg_id) = parent_msg_id {
                                    if let Some(sender) = pending.lock().unwrap().remove(msg_id) {
                                        let _ = sender.send(CompletionResult {
                                            matches: reply.matches,
                                            cursor_start: reply.cursor_start,
                                            cursor_end: reply.cursor_end,
                                        });
                                    }
                                }
                            }
                            JupyterMessageContent::HistoryReply(reply) => {
                                if let Some(ref msg_id) = parent_msg_id {
                                    if let Some(sender) = pending_hist.lock().unwrap().remove(msg_id)
                                    {
                                        let entries = reply
                                            .history
                                            .into_iter()
                                            .map(|entry| match entry {
                                                jupyter_protocol::HistoryEntry::Input(
                                                    session,
                                                    line,
                                                    source,
                                                ) => HistoryEntryData {
                                                    session,
                                                    line,
                                                    source,
                                                },
                                                jupyter_protocol::HistoryEntry::InputOutput(
                                                    session,
                                                    line,
                                                    (source, _),
                                                ) => HistoryEntryData {
                                                    session,
                                                    line,
                                                    source,
                                                },
                                            })
                                            .collect();
                                        let _ = sender.send(HistoryResult { entries });
                                    }
                                }
                            }
                            JupyterMessageContent::ExecuteReply(ref reply) => {
                                // Handle page payloads from introspection (? and ??)
                                for payload in &reply.payload {
                                    if let Payload::Page { data, start } = payload {
                                        let cell_id = parent_msg_id.as_ref().and_then(|msg_id| {
                                            shell_cell_id_map.lock().ok()?.get(msg_id).cloned()
                                        });

                                        if let Some(cell_id) = cell_id {
                                            let event = PagePayloadEvent {
                                                cell_id,
                                                data: data.clone(),
                                                start: *start,
                                            };
                                            if let Err(e) =
                                                shell_app.emit("kernel:page_payload", &event)
                                            {
                                                error!("Failed to emit page_payload: {}", e);
                                            }
                                        }
                                    }
                                }
                            }
                            _ => {
                                debug!("shell reply: type={}", msg.header.msg_type);
                            }
                        }
                    }
                    Err(e) => {
                        error!("shell read error: {}", e);
                        break;
                    }
                }
            }
        });

        self.connection_info = Some(connection_info);
        self.connection_file = Some(connection_file_path);
        self.iopub_task = Some(iopub_task);
        self.shell_reader_task = Some(shell_reader_task);
        self.shell_writer = Some(shell_writer);
        self._process = Some(process);
        self.conda_environment = Some(env);

        info!("Prewarmed conda kernel started: {}", kernel_id);
        Ok(())
    }

    /// Start a Deno kernel.
    ///
    /// Uses the system `deno jupyter` command to launch a Deno/TypeScript kernel.
    /// Optionally accepts permissions and a workspace directory (for deno.json detection).
    /// When `flexible_npm_imports` is true, sets DENO_NO_PACKAGE_JSON=1 to allow npm:
    /// specifiers to auto-install packages regardless of package.json presence.
    pub async fn start_with_deno(
        &mut self,
        app: AppHandle,
        permissions: &[String],
        workspace_dir: Option<&std::path::Path>,
        flexible_npm_imports: bool,
        notebook_path: Option<&std::path::Path>,
    ) -> Result<()> {
        // Shutdown existing kernel if any
        self.shutdown().await.ok();

        info!(
            "Starting Deno kernel with permissions: {:?}, flexible_npm_imports: {}",
            permissions, flexible_npm_imports
        );

        // Reserve ports
        let ip = std::net::IpAddr::V4(Ipv4Addr::new(127, 0, 0, 1));
        let ports = runtimelib::peek_ports(ip, 5).await?;

        let connection_info = ConnectionInfo {
            transport: jupyter_protocol::connection_info::Transport::TCP,
            ip: ip.to_string(),
            stdin_port: ports[0],
            control_port: ports[1],
            hb_port: ports[2],
            shell_port: ports[3],
            iopub_port: ports[4],
            signature_scheme: "hmac-sha256".to_string(),
            key: Uuid::new_v4().to_string(),
            kernel_name: Some("deno".to_string()),
        };

        let runtime_dir = runtimelib::dirs::runtime_dir();
        tokio::fs::create_dir_all(&runtime_dir).await?;

        let kernel_id: String =
            petname::petname(2, "-").unwrap_or_else(|| Uuid::new_v4().to_string());
        let connection_file_path = runtime_dir.join(format!("runt-kernel-{}.json", kernel_id));

        tokio::fs::write(
            &connection_file_path,
            serde_json::to_string_pretty(&connection_info)?,
        )
        .await?;

        info!(
            "Starting Deno kernel at {:?}",
            connection_file_path
        );

        // Get deno path (from PATH or bootstrapped via rattler)
        let deno_path = tools::get_deno_path()
            .await
            .map_err(|e| anyhow::anyhow!("Failed to get deno path: {}", e))?;

        // Build the deno command
        let mut cmd = tokio::process::Command::new(&deno_path);
        cmd.arg("jupyter")
            .arg("--kernel")
            .arg("--conn")
            .arg(&connection_file_path);

        // Add any permissions
        for perm in permissions {
            cmd.arg(perm);
        }

        // When flexible_npm_imports is enabled, tell Deno to ignore package.json
        // This allows npm: specifiers to auto-install packages on the fly
        if flexible_npm_imports {
            cmd.env("DENO_NO_PACKAGE_JSON", "1");
        }

        // Set working directory: prefer workspace_dir for deno.json discovery,
        // otherwise use notebook directory or home directory
        if let Some(dir) = workspace_dir {
            cmd.current_dir(dir);
        } else {
            cmd.current_dir(kernel_cwd(notebook_path));
        }

        #[cfg(unix)]
        cmd.process_group(0); // Create new process group for kernel and children

        let process = cmd
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .kill_on_drop(true)
            .spawn()?;

        // Store process group ID for cleanup
        #[cfg(unix)]
        {
            self.process_group_id = process.id().map(|pid| pid as i32);
        }

        // Give Deno time to start
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;

        self.session_id = Uuid::new_v4().to_string();

        // Create iopub connection and spawn listener
        let mut iopub = runtimelib::create_client_iopub_connection(
            &connection_info,
            "",
            &self.session_id,
        )
        .await?;

        let app_handle = app.clone();
        let cell_id_map = self.cell_id_map.clone();
        let queue_tx = self.queue_tx.clone();
        let iopub_task = tokio::spawn(async move {
            loop {
                match iopub.read().await {
                    Ok(message) => {
                        debug!(
                            "iopub: type={} parent_msg_id={:?}",
                            message.header.msg_type,
                            message.parent_header.as_ref().map(|h| &h.msg_id)
                        );

                        // Look up cell_id from the msg_id → cell_id map
                        let cell_id = message
                            .parent_header
                            .as_ref()
                            .and_then(|h| cell_id_map.lock().ok()?.get(&h.msg_id).cloned());

                        // Check for status: idle to signal execution completion
                        if let JupyterMessageContent::Status(ref status) = message.content {
                            if status.execution_state == jupyter_protocol::ExecutionState::Idle {
                                if let Some(ref cid) = cell_id {
                                    if let Some(ref tx) = queue_tx {
                                        let _ = tx.try_send(QueueCommand::ExecutionDone {
                                            cell_id: cid.clone(),
                                        });
                                    }
                                }
                            }
                        }

                        let tauri_msg = TauriJupyterMessage {
                            header: message.header,
                            parent_header: message.parent_header,
                            metadata: message.metadata,
                            content: message.content,
                            buffers: message.buffers,
                            channel: message.channel,
                            cell_id,
                        };

                        if let Err(e) = app_handle.emit("kernel:iopub", &tauri_msg) {
                            error!("Failed to emit kernel:iopub: {}", e);
                            break;
                        }
                    }
                    Err(e) => {
                        error!("iopub read error: {}", e);
                        break;
                    }
                }
            }
        });

        // Create persistent shell connection
        let identity = runtimelib::peer_identity_for_session(&self.session_id)?;
        let mut shell = runtimelib::create_client_shell_connection_with_identity(
            &connection_info,
            &self.session_id,
            identity,
        )
        .await?;

        // Verify kernel is alive with kernel_info handshake
        let request: JupyterMessage = KernelInfoRequest::default().into();
        shell.send(request).await?;

        let reply = tokio::time::timeout(std::time::Duration::from_secs(30), shell.read()).await;
        match reply {
            Ok(Ok(msg)) => {
                info!("Deno kernel alive: got {} reply", msg.header.msg_type);
            }
            Ok(Err(e)) => {
                error!("Error reading kernel_info_reply: {}", e);
                return Err(anyhow::anyhow!("Deno kernel did not respond: {}", e));
            }
            Err(_) => {
                error!("Timeout waiting for kernel_info_reply");
                return Err(anyhow::anyhow!("Deno kernel did not respond within 30s"));
            }
        }

        // Split shell into persistent writer + reader
        let (shell_writer, mut shell_reader) = shell.split();

        let pending = self.pending_completions.clone();
        let pending_hist = self.pending_history.clone();
        let shell_app = app.clone();
        let shell_cell_id_map = self.cell_id_map.clone();
        let shell_reader_task = tokio::spawn(async move {
            loop {
                match shell_reader.read().await {
                    Ok(msg) => {
                        let parent_msg_id = msg.parent_header.as_ref().map(|h| h.msg_id.clone());

                        match msg.content {
                            JupyterMessageContent::CompleteReply(reply) => {
                                if let Some(ref msg_id) = parent_msg_id {
                                    if let Some(sender) = pending.lock().unwrap().remove(msg_id) {
                                        let _ = sender.send(CompletionResult {
                                            matches: reply.matches,
                                            cursor_start: reply.cursor_start,
                                            cursor_end: reply.cursor_end,
                                        });
                                    }
                                }
                            }
                            JupyterMessageContent::HistoryReply(reply) => {
                                if let Some(ref msg_id) = parent_msg_id {
                                    if let Some(sender) =
                                        pending_hist.lock().unwrap().remove(msg_id)
                                    {
                                        let entries = reply
                                            .history
                                            .into_iter()
                                            .map(|entry| match entry {
                                                jupyter_protocol::HistoryEntry::Input(
                                                    session,
                                                    line,
                                                    source,
                                                ) => HistoryEntryData {
                                                    session,
                                                    line,
                                                    source,
                                                },
                                                jupyter_protocol::HistoryEntry::InputOutput(
                                                    session,
                                                    line,
                                                    (source, _),
                                                ) => HistoryEntryData {
                                                    session,
                                                    line,
                                                    source,
                                                },
                                            })
                                            .collect();
                                        let _ = sender.send(HistoryResult { entries });
                                    }
                                }
                            }
                            JupyterMessageContent::ExecuteReply(ref reply) => {
                                // Handle page payloads (for inspect/help features)
                                if !reply.payload.is_empty() {
                                    if let Some(ref msg_id) = parent_msg_id {
                                        if let Some(cell_id) =
                                            shell_cell_id_map.lock().ok().and_then(|map| {
                                                map.get(msg_id).cloned()
                                            })
                                        {
                                            for p in &reply.payload {
                                                if let Payload::Page { data, start } = p {
                                                    let event = PagePayloadEvent {
                                                        cell_id: cell_id.clone(),
                                                        data: data.clone(),
                                                        start: *start,
                                                    };
                                                    if let Err(e) =
                                                        shell_app.emit("kernel:page_payload", &event)
                                                    {
                                                        error!("Failed to emit page_payload: {}", e);
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                            _ => {
                                debug!("shell reply: type={}", msg.header.msg_type);
                            }
                        }
                    }
                    Err(e) => {
                        error!("shell read error: {}", e);
                        break;
                    }
                }
            }
        });

        self.connection_info = Some(connection_info);
        self.connection_file = Some(connection_file_path);
        self.iopub_task = Some(iopub_task);
        self.shell_reader_task = Some(shell_reader_task);
        self.shell_writer = Some(shell_writer);
        self._process = Some(process);
        // Note: No uv_environment or conda_environment for Deno

        info!("Deno kernel started: {}", kernel_id);
        Ok(())
    }

    /// Execute code and return the msg_id. Registers the cell_id mapping
    /// before sending so the iopub listener can tag responses.
    pub async fn execute(&mut self, code: &str, cell_id: &str) -> Result<String> {
        let shell = self
            .shell_writer
            .as_mut()
            .ok_or_else(|| anyhow::anyhow!("No kernel running"))?;

        let request = ExecuteRequest::new(code.to_string());
        let message: JupyterMessage = request.into();
        let msg_id = message.header.msg_id.clone();

        // Register msg_id → cell_id BEFORE sending so iopub listener can resolve it
        self.cell_id_map
            .lock()
            .unwrap()
            .insert(msg_id.clone(), cell_id.to_string());

        shell.send(message).await?;
        info!("Sent execute_request: msg_id={} cell_id={}", msg_id, cell_id);

        Ok(msg_id)
    }

    pub async fn interrupt(&self) -> Result<()> {
        let connection_info = self
            .connection_info
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("No kernel running"))?;

        let mut control =
            runtimelib::create_client_control_connection(connection_info, &self.session_id).await?;

        let request: JupyterMessage = InterruptRequest {}.into();
        control.send(request).await?;
        info!("Sent interrupt_request");

        Ok(())
    }

    pub async fn shutdown(&mut self) -> Result<()> {
        if let Some(task) = self.iopub_task.take() {
            task.abort();
        }
        if let Some(task) = self.shell_reader_task.take() {
            task.abort();
        }
        self.shell_writer = None;
        self.pending_completions.lock().unwrap().clear();
        self.pending_history.lock().unwrap().clear();

        if let Some(connection_info) = &self.connection_info {
            let mut control =
                runtimelib::create_client_control_connection(connection_info, &self.session_id)
                    .await?;
            let request: JupyterMessage = ShutdownRequest { restart: false }.into();
            control.send(request).await.ok();
        }

        if let Some(ref path) = self.connection_file {
            tokio::fs::remove_file(path).await.ok();
        }

        // Clean up uv environment (currently just releases the reference)
        if let Some(ref env) = self.uv_environment {
            crate::uv_env::cleanup_environment(env).await.ok();
        }

        // Clean up conda environment (currently just releases the reference)
        if let Some(ref env) = self.conda_environment {
            crate::conda_env::cleanup_environment(env).await.ok();
        }

        // Send SIGTERM to the process group for graceful shutdown of kernel and children
        #[cfg(unix)]
        if let Some(pgid) = self.process_group_id.take() {
            use nix::sys::signal::{killpg, Signal};
            use nix::unistd::Pid;
            // SIGTERM for graceful shutdown
            if let Err(e) = killpg(Pid::from_raw(pgid), Signal::SIGTERM) {
                if e != nix::errno::Errno::ESRCH {
                    log::warn!("Failed to SIGTERM process group {}: {}", pgid, e);
                }
            }
        }

        self.connection_info = None;
        self.connection_file = None;
        self._process = None;
        self.uv_environment = None;
        self.conda_environment = None;

        Ok(())
    }

    /// Request code completions from the kernel.
    pub async fn complete(&mut self, code: &str, cursor_pos: usize) -> Result<CompletionResult> {
        let shell = self
            .shell_writer
            .as_mut()
            .ok_or_else(|| anyhow::anyhow!("No kernel running"))?;

        let request: JupyterMessage = CompleteRequest {
            code: code.to_string(),
            cursor_pos,
        }
        .into();
        let msg_id = request.header.msg_id.clone();

        // Register oneshot so the shell reader task can route the reply back
        let (tx, rx) = tokio::sync::oneshot::channel();
        self.pending_completions
            .lock()
            .unwrap()
            .insert(msg_id, tx);

        shell.send(request).await?;

        match tokio::time::timeout(std::time::Duration::from_secs(5), rx).await {
            Ok(Ok(result)) => Ok(result),
            Ok(Err(_)) => Err(anyhow::anyhow!("Shell reader dropped")),
            Err(_) => Err(anyhow::anyhow!("Timeout waiting for complete_reply")),
        }
    }

    /// Request history from the kernel.
    pub async fn history(&mut self, pattern: Option<&str>, n: i32) -> Result<HistoryResult> {
        let shell = self
            .shell_writer
            .as_mut()
            .ok_or_else(|| anyhow::anyhow!("No kernel running"))?;

        let request: JupyterMessage = if let Some(pat) = pattern {
            HistoryRequest::Search {
                pattern: format!("*{}*", pat),
                unique: true,
                output: false,
                raw: true,
                n,
            }
        } else {
            HistoryRequest::Tail {
                n,
                output: false,
                raw: true,
            }
        }
        .into();

        let msg_id = request.header.msg_id.clone();

        let (tx, rx) = tokio::sync::oneshot::channel();
        self.pending_history.lock().unwrap().insert(msg_id, tx);

        shell.send(request).await?;

        match tokio::time::timeout(std::time::Duration::from_secs(5), rx).await {
            Ok(Ok(result)) => Ok(result),
            Ok(Err(_)) => Err(anyhow::anyhow!("Shell reader dropped")),
            Err(_) => Err(anyhow::anyhow!("Timeout waiting for history_reply")),
        }
    }

    /// Send a raw message (from the frontend) on the shell channel.
    /// Used for comm_msg, comm_open, comm_close (widget interactions).
    pub async fn send_shell_message(&mut self, raw: Value) -> Result<()> {
        let shell = self
            .shell_writer
            .as_mut()
            .ok_or_else(|| anyhow::anyhow!("No kernel running"))?;

        let incoming: RawJupyterMessage = serde_json::from_value(raw)?;
        let message: JupyterMessage = incoming.try_into()?;

        info!(
            "send_shell_message: type={} msg_id={}",
            message.header.msg_type, message.header.msg_id
        );

        shell.send(message).await?;

        Ok(())
    }

    pub fn is_running(&self) -> bool {
        self.connection_info.is_some()
    }

    /// Check if this kernel is running with a uv-managed environment.
    pub fn has_uv_environment(&self) -> bool {
        self.uv_environment.is_some()
    }

    /// Get a reference to the uv environment, if this kernel was started with uv.
    pub fn uv_environment(&self) -> Option<&UvEnvironment> {
        self.uv_environment.as_ref()
    }

    /// Get the dependencies this kernel was started with (for dirty state detection).
    pub fn synced_dependencies(&self) -> Option<&Vec<String>> {
        self.synced_dependencies.as_ref()
    }

    /// Update the synced dependencies after a sync operation.
    pub fn set_synced_dependencies(&mut self, deps: Vec<String>) {
        self.synced_dependencies = Some(deps);
    }

    /// Check if this kernel is running with a conda-managed environment.
    pub fn has_conda_environment(&self) -> bool {
        self.conda_environment.is_some()
    }

    /// Get a reference to the conda environment, if this kernel was started with conda.
    pub fn conda_environment(&self) -> Option<&CondaEnvironment> {
        self.conda_environment.as_ref()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    // ==================== CompletionResult Tests ====================

    #[test]
    fn test_completion_result_serializes_correctly() {
        let result = CompletionResult {
            matches: vec!["print".to_string(), "println".to_string()],
            cursor_start: 0,
            cursor_end: 5,
        };

        let json = serde_json::to_value(&result).unwrap();
        assert_eq!(json["matches"], json!(["print", "println"]));
        assert_eq!(json["cursor_start"], 0);
        assert_eq!(json["cursor_end"], 5);
    }

    #[test]
    fn test_completion_result_empty_matches() {
        let result = CompletionResult {
            matches: vec![],
            cursor_start: 10,
            cursor_end: 10,
        };

        let json = serde_json::to_value(&result).unwrap();
        assert_eq!(json["matches"], json!([]));
        assert_eq!(json["cursor_start"], 10);
        assert_eq!(json["cursor_end"], 10);
    }

    #[test]
    fn test_completion_result_clone() {
        let result = CompletionResult {
            matches: vec!["foo".to_string()],
            cursor_start: 0,
            cursor_end: 3,
        };

        let cloned = result.clone();
        assert_eq!(cloned.matches, result.matches);
        assert_eq!(cloned.cursor_start, result.cursor_start);
        assert_eq!(cloned.cursor_end, result.cursor_end);
    }

    // ==================== HistoryEntryData Tests ====================

    #[test]
    fn test_history_entry_data_serializes_correctly() {
        let entry = HistoryEntryData {
            session: 1,
            line: 5,
            source: "print('hello')".to_string(),
        };

        let json = serde_json::to_value(&entry).unwrap();
        assert_eq!(json["session"], 1);
        assert_eq!(json["line"], 5);
        assert_eq!(json["source"], "print('hello')");
    }

    #[test]
    fn test_history_entry_data_with_multiline_source() {
        let entry = HistoryEntryData {
            session: 2,
            line: 10,
            source: "def foo():\n    return 42".to_string(),
        };

        let json = serde_json::to_value(&entry).unwrap();
        assert_eq!(json["source"], "def foo():\n    return 42");
    }

    #[test]
    fn test_history_entry_data_clone() {
        let entry = HistoryEntryData {
            session: 1,
            line: 1,
            source: "x = 1".to_string(),
        };

        let cloned = entry.clone();
        assert_eq!(cloned.session, entry.session);
        assert_eq!(cloned.line, entry.line);
        assert_eq!(cloned.source, entry.source);
    }

    // ==================== HistoryResult Tests ====================

    #[test]
    fn test_history_result_serializes_correctly() {
        let result = HistoryResult {
            entries: vec![
                HistoryEntryData {
                    session: 1,
                    line: 1,
                    source: "x = 1".to_string(),
                },
                HistoryEntryData {
                    session: 1,
                    line: 2,
                    source: "y = 2".to_string(),
                },
            ],
        };

        let json = serde_json::to_value(&result).unwrap();
        let entries = json["entries"].as_array().unwrap();
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0]["source"], "x = 1");
        assert_eq!(entries[1]["source"], "y = 2");
    }

    #[test]
    fn test_history_result_empty() {
        let result = HistoryResult { entries: vec![] };

        let json = serde_json::to_value(&result).unwrap();
        assert_eq!(json["entries"], json!([]));
    }

    #[test]
    fn test_history_result_clone() {
        let result = HistoryResult {
            entries: vec![HistoryEntryData {
                session: 1,
                line: 1,
                source: "test".to_string(),
            }],
        };

        let cloned = result.clone();
        assert_eq!(cloned.entries.len(), 1);
        assert_eq!(cloned.entries[0].source, "test");
    }

    // ==================== PagePayloadEvent Tests ====================

    #[test]
    fn test_page_payload_event_serializes_correctly() {
        let event = PagePayloadEvent {
            cell_id: "cell-123".to_string(),
            data: Media::default(),
            start: 0,
        };

        let json = serde_json::to_value(&event).unwrap();
        assert_eq!(json["cell_id"], "cell-123");
        assert_eq!(json["start"], 0);
        // Media serializes to an object
        assert!(json["data"].is_object());
    }

    #[test]
    fn test_page_payload_event_with_nonzero_start() {
        let event = PagePayloadEvent {
            cell_id: "cell-456".to_string(),
            data: Media::default(),
            start: 100,
        };

        let json = serde_json::to_value(&event).unwrap();
        assert_eq!(json["start"], 100);
    }

    #[test]
    fn test_page_payload_event_clone() {
        let event = PagePayloadEvent {
            cell_id: "cell-789".to_string(),
            data: Media::default(),
            start: 50,
        };

        let cloned = event.clone();
        assert_eq!(cloned.cell_id, event.cell_id);
        assert_eq!(cloned.start, event.start);
    }

    // ==================== NotebookKernel Default Tests ====================

    #[test]
    fn test_notebook_kernel_default_has_no_connection() {
        let kernel = NotebookKernel::default();
        assert!(kernel.connection_info.is_none());
        assert!(kernel.connection_file.is_none());
    }

    #[test]
    fn test_notebook_kernel_default_is_not_running() {
        let kernel = NotebookKernel::default();
        assert!(!kernel.is_running());
    }

    #[test]
    fn test_notebook_kernel_default_has_no_uv_environment() {
        let kernel = NotebookKernel::default();
        assert!(!kernel.has_uv_environment());
        assert!(kernel.uv_environment().is_none());
    }

    #[test]
    fn test_notebook_kernel_default_has_no_conda_environment() {
        let kernel = NotebookKernel::default();
        assert!(!kernel.has_conda_environment());
        assert!(kernel.conda_environment().is_none());
    }

    #[test]
    fn test_notebook_kernel_default_has_empty_cell_id_map() {
        let kernel = NotebookKernel::default();
        let map = kernel.cell_id_map.lock().unwrap();
        assert!(map.is_empty());
    }

    #[test]
    fn test_notebook_kernel_default_has_empty_pending_completions() {
        let kernel = NotebookKernel::default();
        let completions = kernel.pending_completions.lock().unwrap();
        assert!(completions.is_empty());
    }

    #[test]
    fn test_notebook_kernel_default_has_empty_pending_history() {
        let kernel = NotebookKernel::default();
        let history = kernel.pending_history.lock().unwrap();
        assert!(history.is_empty());
    }

    #[test]
    fn test_notebook_kernel_default_session_id_is_uuid_format() {
        let kernel = NotebookKernel::default();
        // UUID v4 format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
        assert!(uuid::Uuid::parse_str(&kernel.session_id).is_ok());
    }

    #[test]
    fn test_notebook_kernel_default_has_no_queue_tx() {
        let kernel = NotebookKernel::default();
        assert!(kernel.queue_tx.is_none());
    }

    // ==================== set_queue_tx Tests ====================

    #[test]
    fn test_set_queue_tx_sets_sender() {
        let mut kernel = NotebookKernel::default();
        let (tx, _rx) = mpsc::channel(1);

        assert!(kernel.queue_tx.is_none());
        kernel.set_queue_tx(tx);
        assert!(kernel.queue_tx.is_some());
    }

    // ==================== is_running State Tests ====================

    #[test]
    fn test_is_running_false_when_no_connection_info() {
        let kernel = NotebookKernel::default();
        assert!(!kernel.is_running());
    }

    // ==================== Cell ID Map Tests ====================

    #[test]
    fn test_cell_id_map_can_insert_and_retrieve() {
        let kernel = NotebookKernel::default();
        {
            let mut map = kernel.cell_id_map.lock().unwrap();
            map.insert("msg-123".to_string(), "cell-456".to_string());
        }
        {
            let map = kernel.cell_id_map.lock().unwrap();
            assert_eq!(map.get("msg-123"), Some(&"cell-456".to_string()));
        }
    }

    #[test]
    fn test_cell_id_map_returns_none_for_missing_key() {
        let kernel = NotebookKernel::default();
        let map = kernel.cell_id_map.lock().unwrap();
        assert!(map.get("nonexistent").is_none());
    }

    // ==================== Multiple Kernels Independence ====================

    #[test]
    fn test_multiple_kernels_have_different_session_ids() {
        let kernel1 = NotebookKernel::default();
        let kernel2 = NotebookKernel::default();
        assert_ne!(kernel1.session_id, kernel2.session_id);
    }

    #[test]
    fn test_multiple_kernels_have_independent_cell_id_maps() {
        let kernel1 = NotebookKernel::default();
        let kernel2 = NotebookKernel::default();

        {
            let mut map1 = kernel1.cell_id_map.lock().unwrap();
            map1.insert("msg-1".to_string(), "cell-1".to_string());
        }

        // kernel2's map should still be empty
        let map2 = kernel2.cell_id_map.lock().unwrap();
        assert!(map2.is_empty());
    }
}
