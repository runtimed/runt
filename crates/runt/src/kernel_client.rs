use std::path::{Path, PathBuf};

use jupyter_protocol::{
    ConnectionInfo, ExecuteReply, ExecuteRequest, InterruptRequest, JupyterMessage,
    JupyterMessageContent, ReplyStatus, ShutdownRequest,
};
use uuid::Uuid;

use runtimelib::{
    create_client_control_connection, create_client_iopub_connection, create_client_shell_connection,
    peek_ports, runtime_dir, KernelspecDir, Result, RuntimeError,
};

pub struct KernelClient {
    kernel_id: Uuid,
    session_id: String,
    connection_info: ConnectionInfo,
    connection_file: PathBuf,
}

impl KernelClient {
    pub async fn start_from_kernelspec(kernelspec: KernelspecDir) -> Result<Self> {
        let kernel_id = Uuid::new_v4();
        let session_id = Uuid::new_v4().to_string();
        let key = Uuid::new_v4().to_string();

        let ip = std::net::IpAddr::V4(std::net::Ipv4Addr::new(127, 0, 0, 1));
        let ports = peek_ports(ip, 5).await?;
        let connection_info = ConnectionInfo {
            transport: jupyter_protocol::connection_info::Transport::TCP,
            ip: ip.to_string(),
            stdin_port: ports[0],
            control_port: ports[1],
            hb_port: ports[2],
            shell_port: ports[3],
            iopub_port: ports[4],
            signature_scheme: "hmac-sha256".to_string(),
            key,
            kernel_name: Some(kernelspec.kernel_name.clone()),
        };

        let runtime_dir = runtime_dir();
        tokio::fs::create_dir_all(&runtime_dir).await?;

        let connection_file = runtime_dir.join(format!("runt-kernel-{}.json", kernel_id));

        let working_dir = std::env::current_dir()?;

        let mut command = kernelspec
            .clone()
            .command(&connection_file, None, None)?;
        command.current_dir(working_dir);

        command.spawn()?;

        let content = serde_json::to_string(&connection_info)?;
        tokio::fs::write(&connection_file, &content).await?;

        Ok(Self {
            kernel_id,
            session_id,
            connection_info,
            connection_file,
        })
    }

    pub async fn from_connection_file(path: impl AsRef<Path>) -> Result<Self> {
        let connection_file = path.as_ref().to_path_buf();
        let content = tokio::fs::read_to_string(&connection_file).await?;
        let connection_info: ConnectionInfo = serde_json::from_str(&content)?;

        let kernel_id = extract_kernel_id(&connection_file).ok_or_else(|| {
            RuntimeError::KernelIdMissing {
                path: connection_file.display().to_string(),
            }
        })?;
        let session_id = Uuid::new_v4().to_string();

        Ok(Self {
            kernel_id,
            session_id,
            connection_info,
            connection_file,
        })
    }

    pub fn kernel_id(&self) -> Uuid {
        self.kernel_id
    }

    pub fn connection_file(&self) -> &Path {
        &self.connection_file
    }

    pub async fn interrupt(&mut self) -> Result<()> {
        let mut control = create_client_control_connection(&self.connection_info, &self.session_id)
            .await?;
        let message: JupyterMessage = InterruptRequest::default().into();
        control.send(message).await?;
        Ok(())
    }

    pub async fn shutdown(&mut self, restart: bool) -> Result<()> {
        self.send_shutdown(restart).await?;
        tokio::fs::remove_file(&self.connection_file).await?;
        Ok(())
    }

    async fn send_shutdown(&self, restart: bool) -> Result<()> {
        let mut control = create_client_control_connection(&self.connection_info, &self.session_id)
            .await?;
        let message: JupyterMessage = ShutdownRequest { restart }.into();
        let message_id = message.header.msg_id.clone();
        control.send(message).await?;
        loop {
            let reply = control.read().await?;
            let is_parent = reply
                .parent_header
                .as_ref()
                .map(|parent| parent.msg_id.as_str())
                == Some(message_id.as_str());
            if !is_parent {
                continue;
            }
            match reply.content {
                JupyterMessageContent::ShutdownReply(reply) => {
                    if reply.status != ReplyStatus::Ok {
                        let mut details = format!("{:?}", reply.status);
                        if let Some(error) = reply.error {
                            details = format!("{}: {:?}", details, error);
                        }
                        return Err(RuntimeError::KernelShutdownFailed { details });
                    }
                    break;
                }
                _ => continue,
            }
        }
        Ok(())
    }

    pub async fn execute<F>(&self, code: &str, mut on_iopub: F) -> Result<ExecuteReply>
    where
        F: FnMut(JupyterMessageContent),
    {
        let mut shell =
            create_client_shell_connection(&self.connection_info, &self.session_id).await?;
        let mut iopub =
            create_client_iopub_connection(&self.connection_info, "", &self.session_id).await?;

        let message: JupyterMessage = ExecuteRequest::new(code.to_string()).into();
        let message_id = message.header.msg_id.clone();
        shell.send(message).await?;

        loop {
            tokio::select! {
                shell_msg = shell.read() => {
                    let msg = shell_msg?;
                    let is_parent = msg
                        .parent_header
                        .as_ref()
                        .map(|parent| parent.msg_id.as_str())
                        == Some(message_id.as_str());
                    if !is_parent {
                        continue;
                    }
                    if let JupyterMessageContent::ExecuteReply(reply) = msg.content {
                        return Ok(reply);
                    }
                }
                iopub_msg = iopub.read() => {
                    let msg = iopub_msg?;
                    let is_parent = msg
                        .parent_header
                        .as_ref()
                        .map(|parent| parent.msg_id.as_str())
                        == Some(message_id.as_str());
                    if !is_parent {
                        continue;
                    }
                    on_iopub(msg.content);
                }
            }
        }
    }
}

fn extract_kernel_id(path: &Path) -> Option<Uuid> {
    let file_stem = path.file_stem()?.to_string_lossy();
    let id_str = file_stem.strip_prefix("runt-kernel-")?;
    Uuid::parse_str(id_str).ok()
}
