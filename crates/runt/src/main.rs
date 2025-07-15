use anyhow::Result;
use clap::{Parser, Subcommand};
use runtimelib::{runtime_dir, ConnectionInfo};
use std::path::PathBuf;
use tokio::fs;

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
}

#[tokio::main]
async fn main() -> Result<()> {
    let cli = Cli::parse();

    match &cli.command {
        Some(Commands::Ps) => list_kernels().await?,
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
