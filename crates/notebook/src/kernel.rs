use anyhow::Result;
use base64::prelude::*;
use bytes::Bytes;
use jupyter_protocol::{
    CompleteRequest, ConnectionInfo, ExecuteRequest, InterruptRequest, JupyterMessage,
    JupyterMessageContent, KernelInfoRequest, ShutdownRequest,
};
use log::{debug, error, info};
use serde::{Deserialize, Serialize, Serializer};
use serde_json::Value;
use std::collections::HashMap;
use std::net::Ipv4Addr;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::{Arc, Mutex as StdMutex};
use tauri::{AppHandle, Emitter};
use uuid::Uuid;

/// Serializable Jupyter message for sending to the frontend via Tauri events.
#[derive(Serialize, Clone)]
pub struct TauriJupyterMessage {
    pub header: jupyter_protocol::Header,
    pub parent_header: Option<jupyter_protocol::Header>,
    pub metadata: Value,
    pub content: JupyterMessageContent,
    #[serde(serialize_with = "serialize_base64")]
    pub buffers: Vec<Bytes>,
    pub channel: Option<jupyter_protocol::Channel>,
    /// The cell_id this message belongs to (resolved from parent_header.msg_id)
    pub cell_id: Option<String>,
}

fn serialize_base64<S>(data: &[Bytes], serializer: S) -> Result<S::Ok, S::Error>
where
    S: Serializer,
{
    data.iter()
        .map(|bytes| BASE64_STANDARD.encode(bytes))
        .collect::<Vec<_>>()
        .serialize(serializer)
}

/// Deserialize base64-encoded buffer strings into Bytes.
fn deserialize_base64_opt<'de, D>(deserializer: D) -> std::result::Result<Vec<Bytes>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let encoded: Option<Vec<String>> = Option::deserialize(deserializer)?;
    match encoded {
        Some(vec) => vec
            .iter()
            .map(|s| {
                BASE64_STANDARD
                    .decode(s)
                    .map(Bytes::from)
                    .map_err(serde::de::Error::custom)
            })
            .collect(),
        None => Ok(Vec::new()),
    }
}

/// Helper for deserializing incoming messages from the frontend.
/// Content is deserialized as raw Value, then converted via msg_type.
#[derive(Deserialize)]
struct IncomingMessage {
    header: jupyter_protocol::Header,
    #[serde(default)]
    parent_header: Option<jupyter_protocol::Header>,
    #[serde(default)]
    metadata: Value,
    content: Value,
    #[serde(default, deserialize_with = "deserialize_base64_opt")]
    buffers: Vec<Bytes>,
    #[serde(default)]
    channel: Option<jupyter_protocol::Channel>,
}

impl TryFrom<IncomingMessage> for JupyterMessage {
    type Error = anyhow::Error;

    fn try_from(msg: IncomingMessage) -> Result<Self> {
        let content =
            JupyterMessageContent::from_type_and_content(&msg.header.msg_type, msg.content)?;
        Ok(JupyterMessage {
            zmq_identities: Vec::new(),
            header: msg.header,
            parent_header: msg.parent_header,
            metadata: msg.metadata,
            content,
            buffers: msg.buffers,
            channel: msg.channel,
        })
    }
}

/// Shared mapping from msg_id → cell_id, used by iopub listener to tag messages.
type CellIdMap = Arc<StdMutex<HashMap<String, String>>>;

/// Pending completion requests: msg_id → oneshot sender for routing complete_reply.
type PendingCompletions =
    Arc<StdMutex<HashMap<String, tokio::sync::oneshot::Sender<CompletionResult>>>>;

#[derive(Serialize, Clone)]
pub struct CompletionResult {
    pub matches: Vec<String>,
    pub cursor_start: usize,
    pub cursor_end: usize,
}

pub struct NotebookKernel {
    connection_info: Option<ConnectionInfo>,
    connection_file: Option<PathBuf>,
    session_id: String,
    iopub_task: Option<tokio::task::JoinHandle<()>>,
    shell_reader_task: Option<tokio::task::JoinHandle<()>>,
    shell_writer: Option<runtimelib::DealerSendConnection>,
    _process: Option<tokio::process::Child>,
    cell_id_map: CellIdMap,
    pending_completions: PendingCompletions,
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
            cell_id_map: Arc::new(StdMutex::new(HashMap::new())),
            pending_completions: Arc::new(StdMutex::new(HashMap::new())),
        }
    }
}

impl NotebookKernel {
    pub async fn start(
        &mut self,
        app: AppHandle,
        kernelspec_name: &str,
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

        let process = kernelspec
            .command(&connection_file_path, Some(Stdio::null()), Some(Stdio::null()))?
            .kill_on_drop(true)
            .spawn()?;

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

        self.connection_info = None;
        self.connection_file = None;
        self._process = None;

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

    /// Send a raw message (from the frontend) on the shell channel.
    /// Used for comm_msg, comm_open, comm_close (widget interactions).
    pub async fn send_shell_message(&mut self, raw: Value) -> Result<()> {
        let shell = self
            .shell_writer
            .as_mut()
            .ok_or_else(|| anyhow::anyhow!("No kernel running"))?;

        let incoming: IncomingMessage = serde_json::from_value(raw)?;
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
}
