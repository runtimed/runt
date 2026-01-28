use anyhow::{anyhow, Result};
use clap::{Parser, Subcommand};
use jupyter_protocol::connection_info::Transport;
use runtimelib::{runtime_dir, ConnectionInfo};
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
}

#[tokio::main]
async fn main() -> Result<()> {
    let cli = Cli::parse();

    match &cli.command {
        Some(Commands::Ps) => list_kernels().await?,
        Some(Commands::Start { name }) => start_kernel(name).await?,
        None => println!("No command specified. Use --help for usage information."),
    }

    Ok(())
}

async fn list_kernels() -> Result<()> {
    let runtime_dir = runtime_dir().await;
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

    let runtime_dir = runtime_dir().await;
    fs::create_dir_all(&runtime_dir).await?;

    let kernel_id = Uuid::new_v4();
    let connection_file = runtime_dir.join(format!("kernel-{}.json", kernel_id));
    let content = serde_json::to_string(&connection_info)?;
    fs::write(&connection_file, &content).await?;

    let current_dir = std::env::current_dir()?;
    let mut child = kernelspec
        .command(&connection_file, None, None)?
        .current_dir(&current_dir)
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| anyhow!("Failed to spawn kernel process with argv {:?}: {}", argv, e))?;

    println!("Kernel started with ID: {}", kernel_id);
    println!("Connection file: {}", connection_file.display());

    let status = child.wait().await?;
    if !status.success() {
        return Err(anyhow!("Kernel process exited with status: {}", status));
    }

    Ok(())
}
