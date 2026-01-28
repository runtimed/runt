use anyhow::{anyhow, Result};
use clap::{Parser, Subcommand};
use jupyter_protocol::connection_info::Transport;
use runtimelib::{
    create_client_control_connection, runtime_dir, ConnectionInfo, InterruptReply,
    InterruptRequest, JupyterMessage, JupyterMessageContent, ReplyStatus, ShutdownReply,
    ShutdownRequest,
};
use std::net::{IpAddr, Ipv4Addr};
use std::path::PathBuf;
use tokio::fs;
use uuid::Uuid;

#[derive(Parser)]
#[command(author, version, about, long_about = None)]
struct Cli {
    #[command(subcommand)]
    command: Option<Commands>,
}

#[derive(Subcommand)]
enum Commands {
    /// List currently running kernels
    Ps,
    /// Start a kernel given a name
    Start {
        /// The name of the kernel to launch (e.g., python3, julia)
        #[arg(short, long)]
        name: String,
    },
    /// Stop a kernel given an ID
    Stop {
        /// The ID of the kernel to stop
        #[arg(short, long)]
        id: String,
    },
    /// Interrupt a kernel given an ID
    Interrupt {
        /// The ID of the kernel to interrupt
        #[arg(short, long)]
        id: String,
    },
}

#[tokio::main]
async fn main() -> Result<()> {
    let cli = Cli::parse();

    match &cli.command {
        Some(Commands::Ps) => list_kernels().await?,
        Some(Commands::Start { name }) => start_kernel(name).await?,
        Some(Commands::Stop { id }) => stop_kernel(id).await?,
        Some(Commands::Interrupt { id }) => interrupt_kernel(id).await?,
        None => println!("No command specified. Use --help for usage information."),
    }

    Ok(())
}

async fn list_kernels() -> Result<()> {
    let runtime_dir = runtime_dir();
    let mut entries = fs::read_dir(runtime_dir).await?;

    println!(
        "{:<12} {:<10} {:<6} {:<6} {:<6} {:<6} {:<6} {:<6} {:<38} {:<10}",
        "KERNEL_NAME",
        "IP",
        "TRANS",
        "SHELL",
        "IOPUB",
        "STDIN",
        "CONTROL",
        "HB",
        "KEY",
        "SIG_SCHEME"
    );

    while let Some(entry) = entries.next_entry().await? {
        let path = entry.path();
        if path.extension().and_then(|s| s.to_str()) == Some("json") {
            if let Ok(info) = read_connection_info(&path).await {
                print_kernel_info(&path, &info);
            }
        }
    }

    Ok(())
}

async fn read_connection_info(path: &PathBuf) -> Result<ConnectionInfo> {
    let content = fs::read_to_string(path).await?;
    let info: ConnectionInfo = serde_json::from_str(&content)?;
    Ok(info)
}

fn print_kernel_info(path: &PathBuf, info: &ConnectionInfo) {
    let kernel_name = path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("unknown");
    println!(
        "{:<12} {:<10} {:<6} {:<6} {:<6} {:<6} {:<6} {:<6} {:<38} {:<10}",
        kernel_name,
        info.ip,
        info.transport,
        info.shell_port,
        info.iopub_port,
        info.stdin_port,
        info.control_port,
        info.hb_port,
        info.key,
        info.signature_scheme
    );
}

async fn start_kernel(name: &str) -> Result<()> {
    let kernelspec = runtimelib::find_kernelspec(name).await?;
    let argv = kernelspec.kernelspec.argv.clone();

    let ip = IpAddr::V4(Ipv4Addr::new(127, 0, 0, 1));
    let ports = runtimelib::peek_ports(ip, 5).await?;

    let connection_info = ConnectionInfo {
        transport: Transport::TCP,
        ip: ip.to_string(),
        stdin_port: ports[0],
        control_port: ports[1],
        hb_port: ports[2],
        shell_port: ports[3],
        iopub_port: ports[4],
        signature_scheme: "hmac-sha256".to_string(),
        key: Uuid::new_v4().to_string(),
        kernel_name: Some(name.to_string()),
    };

    let runtime_dir = runtime_dir();
    fs::create_dir_all(&runtime_dir).await?;

    let kernel_id = Uuid::new_v4();
    let connection_file = runtime_dir.join(format!("runt-kernel-{}.json", kernel_id));
    let content = serde_json::to_string(&connection_info)?;
    fs::write(&connection_file, &content).await?;

    let current_dir = std::env::current_dir()?;
    kernelspec
        .command(&connection_file, None, None)?
        .current_dir(&current_dir)
        .spawn()
        .map_err(|e| anyhow!("Failed to spawn kernel process with argv {:?}: {}", argv, e))?;

    println!("Kernel started with ID: {}", kernel_id);
    println!("Connection file: {}", connection_file.display());

    Ok(())
}

async fn stop_kernel(id: &str) -> Result<()> {
    let runtime_dir = runtime_dir();
    let connection_file = runtime_dir.join(format!("runt-kernel-{}.json", id));

    if !connection_file.exists() {
        return Err(anyhow!("Kernel with ID {} not found", id));
    }

    let content = fs::read_to_string(&connection_file).await?;
    let connection_info: ConnectionInfo = serde_json::from_str(&content)?;

    let session_id = Uuid::new_v4().to_string();
    let mut control_connection =
        create_client_control_connection(&connection_info, &session_id).await?;

    let shutdown_request = ShutdownRequest { restart: false };
    let message: JupyterMessage = shutdown_request.into();

    control_connection.send(message).await?;

    let reply = control_connection.read().await?;

    match reply.content {
        JupyterMessageContent::ShutdownReply(ShutdownReply { status, .. }) => {
            if status == ReplyStatus::Ok {
                fs::remove_file(&connection_file).await?;
                println!("Kernel with ID {} stopped", id);
            } else {
                return Err(anyhow!("Kernel shutdown failed with status: {:?}", status));
            }
        }
        _ => {
            return Err(anyhow!(
                "Unexpected reply type: {:?}",
                reply.content.message_type()
            ));
        }
    }

    Ok(())
}

async fn interrupt_kernel(id: &str) -> Result<()> {
    let runtime_dir = runtime_dir();
    let connection_file = runtime_dir.join(format!("runt-kernel-{}.json", id));

    if !connection_file.exists() {
        return Err(anyhow!("Kernel with ID {} not found", id));
    }

    let content = fs::read_to_string(&connection_file).await?;
    let connection_info: ConnectionInfo = serde_json::from_str(&content)?;

    let session_id = Uuid::new_v4().to_string();
    let mut control_connection =
        create_client_control_connection(&connection_info, &session_id).await?;

    let interrupt_request = InterruptRequest {};
    let message: JupyterMessage = interrupt_request.into();

    control_connection.send(message).await?;

    let reply = control_connection.read().await?;

    match reply.content {
        JupyterMessageContent::InterruptReply(InterruptReply { status, .. }) => {
            if status == ReplyStatus::Ok {
                println!("Kernel with ID {} interrupted", id);
            } else {
                return Err(anyhow!("Kernel interrupt failed with status: {:?}", status));
            }
        }
        _ => {
            return Err(anyhow!(
                "Unexpected reply type: {:?}",
                reply.content.message_type()
            ));
        }
    }

    Ok(())
}
