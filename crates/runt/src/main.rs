use anyhow::Result;
use clap::{Parser, Subcommand};
use serde::Serialize;
mod kernel_client;

use crate::kernel_client::KernelClient;
use runtimelib::{find_kernelspec, runtime_dir, ConnectionInfo};
use std::path::PathBuf;
use tokio::fs;

#[derive(Serialize)]
struct KernelInfo {
    name: String,
    #[serde(flatten)]
    connection_info: ConnectionInfo,
}

#[derive(Parser)]
#[command(author, version, about, long_about = None)]
struct Cli {
    #[command(subcommand)]
    command: Option<Commands>,
}

#[derive(Subcommand)]
enum Commands {
    /// List currently running kernels
    Ps {
        /// Output in JSON format
        #[arg(long)]
        json: bool,
    },
    /// Start a kernel given a name
    Start {
        /// The name of the kernel to launch (e.g., python3, julia)
        name: String,
    },
    /// Stop a kernel given an ID
    Stop {
        /// The ID of the kernel to stop
        id: String,
    },
    /// Interrupt a kernel given an ID
    Interrupt {
        /// The ID of the kernel to interrupt
        id: String,
    },
    /// Execute code in a kernel given an ID
    Exec {
        /// The ID of the kernel to execute code in
        id: String,
        /// The code to execute (reads from stdin if not provided)
        code: Option<String>,
    },
}

#[tokio::main]
async fn main() -> Result<()> {
    let cli = Cli::parse();

    match &cli.command {
        Some(Commands::Ps { json }) => list_kernels(*json).await?,
        Some(Commands::Start { name }) => start_kernel(name).await?,
        Some(Commands::Stop { id }) => stop_kernel(id).await?,
        Some(Commands::Interrupt { id }) => interrupt_kernel(id).await?,
        Some(Commands::Exec { id, code }) => execute_code(id, code.as_deref()).await?,
        None => println!("No command specified. Use --help for usage information."),
    }

    Ok(())
}

async fn list_kernels(json_output: bool) -> Result<()> {
    let runtime_dir = runtime_dir();
    let mut entries = fs::read_dir(runtime_dir).await?;

    let mut kernels: Vec<KernelInfo> = Vec::new();

    while let Some(entry) = entries.next_entry().await? {
        let path = entry.path();
        if path.extension().and_then(|s| s.to_str()) == Some("json") {
            if let Ok(info) = read_connection_info(&path).await {
                let full_name = path
                    .file_stem()
                    .and_then(|s| s.to_str())
                    .unwrap_or("unknown");
                let name = full_name
                    .strip_prefix("runt-kernel-")
                    .unwrap_or(full_name)
                    .to_string();
                kernels.push(KernelInfo {
                    name,
                    connection_info: info,
                });
            }
        }
    }

    if json_output {
        println!("{}", serde_json::to_string_pretty(&kernels)?);
    } else {
        print_kernel_info_table(&kernels);
    }

    Ok(())
}

async fn read_connection_info(path: &PathBuf) -> Result<ConnectionInfo> {
    let content = fs::read_to_string(path).await?;
    let info: ConnectionInfo = serde_json::from_str(&content)?;
    Ok(info)
}

fn print_kernel_info_table(kernels: &[KernelInfo]) {
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
    for kernel in kernels {
        let info = &kernel.connection_info;
        println!(
            "{:<12} {:<10} {:<6} {:<6} {:<6} {:<6} {:<6} {:<6} {:<38} {:<10}",
            kernel.name,
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
}

async fn start_kernel(name: &str) -> Result<()> {
    let kernelspec = find_kernelspec(name).await?;
    let client = KernelClient::start_from_kernelspec(kernelspec).await?;
    println!("Kernel started with ID: {}", client.kernel_id());
    println!("Connection file: {}", client.connection_file().display());

    Ok(())
}

async fn stop_kernel(id: &str) -> Result<()> {
    let connection_file = runtime_dir().join(format!("runt-kernel-{}.json", id));
    let mut client = KernelClient::from_connection_file(&connection_file).await?;
    client.shutdown(false).await?;
    println!("Kernel with ID {} stopped", id);
    Ok(())
}

async fn interrupt_kernel(id: &str) -> Result<()> {
    let connection_file = runtime_dir().join(format!("runt-kernel-{}.json", id));
    let mut client = KernelClient::from_connection_file(&connection_file).await?;
    client.interrupt().await?;
    println!("Interrupt sent to kernel {}", id);
    Ok(())
}

async fn execute_code(id: &str, code: Option<&str>) -> Result<()> {
    use jupyter_protocol::{JupyterMessageContent, MediaType, ReplyStatus, Stdio};
    use std::io::{self, Read, Write};

    let code = match code {
        Some(c) => c.to_string(),
        None => {
            let mut buffer = String::new();
            io::stdin().read_to_string(&mut buffer)?;
            buffer
        }
    };

    let connection_file = runtime_dir().join(format!("runt-kernel-{}.json", id));
    let client = KernelClient::from_connection_file(&connection_file).await?;

    let reply = client
        .execute(&code, |content| match content {
            JupyterMessageContent::StreamContent(stream) => match stream.name {
                Stdio::Stdout => {
                    print!("{}", stream.text);
                    let _ = io::stdout().flush();
                }
                Stdio::Stderr => {
                    eprint!("{}", stream.text);
                    let _ = io::stderr().flush();
                }
            },
            JupyterMessageContent::ExecuteResult(result) => {
                for media_type in &result.data.content {
                    if let MediaType::Plain(text) = media_type {
                        println!("{}", text);
                        break;
                    }
                }
            }
            JupyterMessageContent::ErrorOutput(error) => {
                eprintln!("{}: {}", error.ename, error.evalue);
                for line in &error.traceback {
                    eprintln!("{}", line);
                }
            }
            _ => {}
        })
        .await?;

    if reply.status != ReplyStatus::Ok {
        std::process::exit(1);
    }

    Ok(())
}
