use anyhow::Result;
use clap::{Parser, Subcommand};
use serde::Serialize;
use std::time::Duration;
mod kernel_client;

use crate::kernel_client::KernelClient;
use runtimelib::{
    create_client_heartbeat_connection, find_kernelspec, runtime_dir, ConnectionInfo,
};
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
    /// Launch the sidecar viewer for a kernel
    Sidecar {
        /// Path to a kernel connection file
        file: PathBuf,
        /// Suppress output
        #[arg(short, long)]
        quiet: bool,
        /// Dump all messages to a JSON file
        #[arg(long)]
        dump: Option<PathBuf>,
    },
    /// Launch a kernel and open an interactive console
    Console {
        /// The kernel to launch (e.g., python3, julia)
        kernel: Option<String>,
        /// Custom command to launch the kernel (use {connection_file} as placeholder)
        #[arg(long)]
        cmd: Option<String>,
        /// Print all Jupyter messages for debugging
        #[arg(short, long)]
        verbose: bool,
    },
    /// Remove stale kernel connection files for kernels that are no longer running
    Clean {
        /// Timeout in seconds for heartbeat check (default: 2)
        #[arg(long, default_value = "2")]
        timeout: u64,
        /// Perform a dry run without actually removing files
        #[arg(long)]
        dry_run: bool,
    },
}

fn main() -> Result<()> {
    let cli = Cli::parse();

    match cli.command {
        Some(Commands::Sidecar { file, quiet, dump }) => {
            // Sidecar runs a tao event loop on the main thread (no tokio needed)
            sidecar::launch(&file, quiet, dump.as_deref())
        }
        other => {
            // All other subcommands use tokio
            let rt = tokio::runtime::Runtime::new()?;
            rt.block_on(async_main(other))
        }
    }
}

async fn async_main(command: Option<Commands>) -> Result<()> {
    match command {
        Some(Commands::Ps { json }) => list_kernels(json).await?,
        Some(Commands::Start { name }) => start_kernel(&name).await?,
        Some(Commands::Stop { id }) => stop_kernel(&id).await?,
        Some(Commands::Interrupt { id }) => interrupt_kernel(&id).await?,
        Some(Commands::Exec { id, code }) => execute_code(&id, code.as_deref()).await?,
        Some(Commands::Console { kernel, cmd, verbose }) => console(kernel.as_deref(), cmd.as_deref(), verbose).await?,
        Some(Commands::Sidecar { .. }) => unreachable!(),
        Some(Commands::Clean { timeout, dry_run }) => clean_kernels(timeout, dry_run).await?,
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

async fn clean_kernels(timeout_secs: u64, dry_run: bool) -> Result<()> {
    let runtime_dir = runtime_dir();
    let mut entries = fs::read_dir(&runtime_dir).await?;

    let timeout = Duration::from_secs(timeout_secs);
    let mut cleaned = 0;
    let mut alive = 0;
    let mut errors = 0;

    while let Some(entry) = entries.next_entry().await? {
        let path = entry.path();

        // Only process kernel-*.json and runt-kernel-*.json files
        let file_name = path.file_name().and_then(|s| s.to_str()).unwrap_or("");
        let is_kernel_file =
            file_name.starts_with("kernel-") || file_name.starts_with("runt-kernel-");
        if !is_kernel_file || path.extension().and_then(|s| s.to_str()) != Some("json") {
            continue;
        }

        let connection_info = match read_connection_info(&path).await {
            Ok(info) => info,
            Err(_) => {
                errors += 1;
                continue;
            }
        };

        let is_alive = check_kernel_alive(&connection_info, timeout).await;

        if is_alive {
            alive += 1;
        } else {
            if dry_run {
                println!("Would remove: {}", path.display());
            } else if let Err(e) = fs::remove_file(&path).await {
                eprintln!("Failed to remove {}: {}", path.display(), e);
                errors += 1;
            } else {
                println!("Removed: {}", path.display());
            }
            cleaned += 1;
        }
    }

    println!();
    if dry_run {
        println!(
            "Dry run complete: {} stale, {} alive, {} errors",
            cleaned, alive, errors
        );
    } else {
        println!(
            "Cleaned {} stale connection files ({} alive, {} errors)",
            cleaned, alive, errors
        );
    }

    Ok(())
}

async fn check_kernel_alive(connection_info: &ConnectionInfo, timeout: Duration) -> bool {
    let heartbeat_result = tokio::time::timeout(timeout, async {
        let mut hb = create_client_heartbeat_connection(connection_info).await?;
        hb.single_heartbeat().await
    })
    .await;

    matches!(heartbeat_result, Ok(Ok(())))
}

async fn console(kernel_name: Option<&str>, cmd: Option<&str>, verbose: bool) -> Result<()> {
    use jupyter_protocol::{
        ExecuteRequest, ExecutionState, JupyterMessage, JupyterMessageContent, MediaType, Status,
        Stdio,
    };
    use std::io::{self, BufRead, Write};

    let mut client = match (kernel_name, cmd) {
        (_, Some(cmd)) => KernelClient::start_from_command(cmd).await?,
        (Some(name), None) => {
            let kernelspec = find_kernelspec(name).await?;
            KernelClient::start_from_kernelspec(kernelspec).await?
        }
        (None, None) => anyhow::bail!("Provide a kernel name or --cmd"),
    };

    // Give the kernel a moment to bind its sockets
    tokio::time::sleep(Duration::from_millis(500)).await;

    let connection_info = client.connection_info();
    let session_id = client.session_id();

    let shell = runtimelib::create_client_shell_connection(connection_info, session_id).await?;
    let (mut shell_writer, mut shell_reader) = shell.split();

    let mut iopub =
        runtimelib::create_client_iopub_connection(connection_info, "", session_id).await?;

    let kernel_name = connection_info
        .kernel_name
        .clone()
        .unwrap_or_else(|| "kernel".to_string());
    println!("{} console", kernel_name);
    println!("Use Ctrl+D to exit.\n");

    let stdin = io::stdin();
    let mut lines = stdin.lock().lines();
    let mut execution_count: u32 = 0;

    loop {
        execution_count += 1;
        print!("In [{}]: ", execution_count);
        io::stdout().flush()?;

        let line = match lines.next() {
            Some(Ok(line)) => line,
            _ => break, // EOF or error
        };

        let code = line.trim();
        if code.is_empty() {
            execution_count -= 1;
            continue;
        }

        let message: JupyterMessage = ExecuteRequest::new(code.to_string()).into();
        let message_id = message.header.msg_id.clone();
        shell_writer.send(message).await?;

        // Wait for idle status on iopub (signals all output is done).
        // Some kernels send ExecuteReply before streaming output, so we
        // can't use the reply alone as the completion signal.
        let mut got_idle = false;
        while !got_idle {
            tokio::select! {
                result = iopub.read() => {
                    let msg = result?;
                    let is_ours = msg
                        .parent_header
                        .as_ref()
                        .map(|h| h.msg_id.as_str())
                        == Some(message_id.as_str());
                    if verbose {
                        eprintln!("[iopub] {} (ours={})", msg.header.msg_type, is_ours);
                    }
                    if !is_ours {
                        continue;
                    }
                    match &msg.content {
                        JupyterMessageContent::StreamContent(stream) => {
                            match stream.name {
                                Stdio::Stdout => print!("{}", stream.text),
                                Stdio::Stderr => eprint!("{}", stream.text),
                            }
                            let _ = io::stdout().flush();
                        }
                        JupyterMessageContent::ExecuteResult(result) => {
                            for media in &result.data.content {
                                if let MediaType::Plain(text) = media {
                                    println!("Out[{}]: {}", execution_count, text);
                                    break;
                                }
                            }
                        }
                        JupyterMessageContent::DisplayData(data) => {
                            for media in &data.data.content {
                                if let MediaType::Plain(text) = media {
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
                        JupyterMessageContent::Status(Status { execution_state }) => {
                            if *execution_state == ExecutionState::Idle {
                                got_idle = true;
                            }
                        }
                        JupyterMessageContent::UpdateDisplayData(data) => {
                            for media in &data.data.content {
                                if let MediaType::Plain(text) = media {
                                    println!("{}", text);
                                    break;
                                }
                            }
                        }
                        _ => {}
                    }
                }
                result = shell_reader.read() => {
                    let msg = result?;
                    if verbose {
                        let is_ours = msg
                            .parent_header
                            .as_ref()
                            .map(|h| h.msg_id.as_str())
                            == Some(message_id.as_str());
                        eprintln!("[shell] {} (ours={})", msg.header.msg_type, is_ours);
                    }
                }
            }
        }
        // Blank line between output and the next prompt
        println!();
    }

    println!("\nShutting down kernel...");
    client.shutdown(false).await?;
    println!("Done.");

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
