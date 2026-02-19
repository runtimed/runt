use anyhow::Result;
use clap::{Parser, Subcommand};
use futures::future::join_all;
use jupyter_protocol::{JupyterMessage, JupyterMessageContent, KernelInfoRequest};
use serde::Serialize;
use std::time::Duration;
use tabled::{settings::Style, Table, Tabled};
mod kernel_client;

use crate::kernel_client::KernelClient;
use runtimelib::{
    create_client_heartbeat_connection, create_client_shell_connection_with_identity,
    find_kernelspec, peer_identity_for_session, runtime_dir, ConnectionInfo,
};
use std::path::PathBuf;
use tokio::fs;
use uuid::Uuid;

#[derive(Serialize, Clone, Copy, Debug)]
#[serde(rename_all = "lowercase")]
enum KernelStatus {
    Alive,
    Unresponsive,
}

impl std::fmt::Display for KernelStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            KernelStatus::Alive => write!(f, "alive"),
            KernelStatus::Unresponsive => write!(f, "unresponsive"),
        }
    }
}

#[derive(Serialize)]
struct KernelInfo {
    name: String,
    connection_file: PathBuf,
    language: Option<String>,
    language_version: Option<String>,
    status: KernelStatus,
    #[serde(flatten)]
    connection_info: ConnectionInfo,
}

#[derive(Tabled)]
struct KernelTableRow {
    #[tabled(rename = "NAME")]
    name: String,
    #[tabled(rename = "LANGUAGE")]
    language: String,
    #[tabled(rename = "VERSION")]
    version: String,
    #[tabled(rename = "STATUS")]
    status: String,
    #[tabled(rename = "CONNECTION FILE")]
    connection_file: String,
}

impl From<&KernelInfo> for KernelTableRow {
    fn from(info: &KernelInfo) -> Self {
        KernelTableRow {
            name: info.name.clone(),
            language: info.language.clone().unwrap_or_else(|| "-".to_string()),
            version: info.language_version.clone().unwrap_or_else(|| "-".to_string()),
            status: info.status.to_string(),
            connection_file: shorten_path(&info.connection_file),
        }
    }
}

/// Shorten a path for display by replacing home directory with ~
fn shorten_path(path: &PathBuf) -> String {
    if let Some(home) = dirs::home_dir() {
        if let Ok(relative) = path.strip_prefix(&home) {
            return format!("~/{}", relative.display());
        }
    }
    path.display().to_string()
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
        /// Show verbose output including port numbers
        #[arg(short, long)]
        verbose: bool,
    },
    /// Start a kernel given a name
    Start {
        /// The name of the kernel to launch (e.g., python3, julia)
        name: String,
    },
    /// Stop a kernel given an ID
    Stop {
        /// The ID of the kernel to stop (required unless --all is used)
        id: Option<String>,
        /// Stop all running kernels
        #[arg(long)]
        all: bool,
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
    /// Debug message passing between sidecar and kernel
    Debug {
        /// The kernel to launch (e.g., python3, julia)
        kernel: Option<String>,
        /// Custom command to launch the kernel (use {connection_file} as placeholder)
        #[arg(long)]
        cmd: Option<String>,
        /// Code to execute after kernel starts
        #[arg(long)]
        exec: Option<String>,
        /// Path to dump all messages (defaults to temp file)
        #[arg(long)]
        dump: Option<PathBuf>,
        /// Keep running after execution for manual interaction (Ctrl+C to exit)
        #[arg(long, short)]
        wait: bool,
    },
    /// Interact with the pool daemon (prewarmed Python environments)
    Pool {
        #[command(subcommand)]
        command: PoolCommands,
    },
}

#[derive(Subcommand)]
enum PoolCommands {
    /// Check if the pool daemon is running
    Ping,
    /// Show pool daemon status and statistics
    Status {
        /// Output in JSON format
        #[arg(long)]
        json: bool,
    },
    /// Request an environment from the pool (for testing)
    Take {
        /// Environment type: uv or conda
        #[arg(default_value = "uv")]
        env_type: String,
    },
    /// Request daemon shutdown
    Shutdown,
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
        Some(Commands::Ps { json, verbose }) => list_kernels(json, verbose).await?,
        Some(Commands::Start { name }) => start_kernel(&name).await?,
        Some(Commands::Stop { id, all }) => stop_kernels(id.as_deref(), all).await?,
        Some(Commands::Interrupt { id }) => interrupt_kernel(&id).await?,
        Some(Commands::Exec { id, code }) => execute_code(&id, code.as_deref()).await?,
        Some(Commands::Console { kernel, cmd, verbose }) => console(kernel.as_deref(), cmd.as_deref(), verbose).await?,
        Some(Commands::Sidecar { .. }) => unreachable!(),
        Some(Commands::Clean { timeout, dry_run }) => clean_kernels(timeout, dry_run).await?,
        Some(Commands::Debug { kernel, cmd, exec, dump, wait }) => {
            debug_session(kernel.as_deref(), cmd.as_deref(), exec.as_deref(), dump, wait).await?
        }
        Some(Commands::Pool { command }) => pool_command(command).await?,
        None => println!("No command specified. Use --help for usage information."),
    }

    Ok(())
}

async fn list_kernels(json_output: bool, verbose: bool) -> Result<()> {
    let runtime_dir = runtime_dir();
    let mut entries = fs::read_dir(&runtime_dir).await?;
    let timeout = Duration::from_secs(2);

    // Collect all connection file paths first
    let mut connection_files: Vec<PathBuf> = Vec::new();
    while let Some(entry) = entries.next_entry().await? {
        let path = entry.path();
        if path.extension().and_then(|s| s.to_str()) != Some("json") {
            continue;
        }
        let file_name = path.file_name().and_then(|s| s.to_str()).unwrap_or("");
        if !file_name.starts_with("runt-kernel-") {
            continue;
        }
        connection_files.push(path);
    }

    // Query all kernels in parallel
    let kernel_futures = connection_files.into_iter().map(|path| {
        let timeout = timeout;
        async move { gather_kernel_info(path, timeout).await }
    });

    let mut kernels: Vec<KernelInfo> = join_all(kernel_futures)
        .await
        .into_iter()
        .flatten()
        .collect();

    // Sort kernels by name for consistent display
    kernels.sort_by(|a, b| a.name.cmp(&b.name));

    if json_output {
        println!("{}", serde_json::to_string_pretty(&kernels)?);
    } else if verbose {
        print_verbose_kernel_table(&kernels);
    } else {
        print_kernel_table(&kernels);
    }

    Ok(())
}

async fn gather_kernel_info(path: PathBuf, timeout: Duration) -> Option<KernelInfo> {
    let connection_info = read_connection_info(&path).await.ok()?;

    let full_name = path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("unknown");
    let name = full_name
        .strip_prefix("runt-kernel-")
        .unwrap_or(full_name)
        .to_string();

    let (language, language_version, status) =
        query_kernel_info(&connection_info, timeout).await;

    Some(KernelInfo {
        name,
        connection_file: path,
        language,
        language_version,
        status,
        connection_info,
    })
}

async fn query_kernel_info(
    connection_info: &ConnectionInfo,
    timeout: Duration,
) -> (Option<String>, Option<String>, KernelStatus) {
    // First check if kernel is alive via heartbeat (fast check)
    if !check_kernel_alive(connection_info, timeout).await {
        return (None, None, KernelStatus::Unresponsive);
    }

    // Kernel is alive, now get language info via shell
    let session_id = Uuid::new_v4().to_string();
    let identity = match peer_identity_for_session(&session_id) {
        Ok(id) => id,
        Err(_) => return (None, None, KernelStatus::Alive),
    };

    let shell = match create_client_shell_connection_with_identity(
        connection_info,
        &session_id,
        identity,
    )
    .await
    {
        Ok(s) => s,
        Err(_) => return (None, None, KernelStatus::Alive),
    };

    let (mut shell_writer, mut shell_reader) = shell.split();
    let request: JupyterMessage = KernelInfoRequest::default().into();

    if shell_writer.send(request).await.is_err() {
        return (None, None, KernelStatus::Alive);
    }

    match tokio::time::timeout(timeout, shell_reader.read()).await {
        Ok(Ok(msg)) => {
            if let JupyterMessageContent::KernelInfoReply(reply) = msg.content {
                (
                    Some(reply.language_info.name.clone()),
                    Some(reply.language_info.version.clone()),
                    KernelStatus::Alive,
                )
            } else {
                (None, None, KernelStatus::Alive)
            }
        }
        _ => (None, None, KernelStatus::Alive),
    }
}

async fn read_connection_info(path: &PathBuf) -> Result<ConnectionInfo> {
    let content = fs::read_to_string(path).await?;
    let info: ConnectionInfo = serde_json::from_str(&content)?;
    Ok(info)
}

fn print_kernel_table(kernels: &[KernelInfo]) {
    if kernels.is_empty() {
        println!("No running kernels found.");
        return;
    }

    let rows: Vec<KernelTableRow> = kernels.iter().map(KernelTableRow::from).collect();
    let table = Table::new(rows).with(Style::rounded()).to_string();
    println!("{}", table);
}

fn print_verbose_kernel_table(kernels: &[KernelInfo]) {
    if kernels.is_empty() {
        println!("No running kernels found.");
        return;
    }

    #[derive(Tabled)]
    struct VerboseRow {
        #[tabled(rename = "NAME")]
        name: String,
        #[tabled(rename = "LANGUAGE")]
        language: String,
        #[tabled(rename = "STATUS")]
        status: String,
        #[tabled(rename = "SHELL")]
        shell_port: u16,
        #[tabled(rename = "IOPUB")]
        iopub_port: u16,
        #[tabled(rename = "STDIN")]
        stdin_port: u16,
        #[tabled(rename = "CTRL")]
        control_port: u16,
        #[tabled(rename = "HB")]
        hb_port: u16,
        #[tabled(rename = "CONNECTION FILE")]
        connection_file: String,
    }

    let rows: Vec<VerboseRow> = kernels
        .iter()
        .map(|k| VerboseRow {
            name: k.name.clone(),
            language: format!(
                "{} {}",
                k.language.as_deref().unwrap_or("-"),
                k.language_version.as_deref().unwrap_or("")
            )
            .trim()
            .to_string(),
            status: k.status.to_string(),
            shell_port: k.connection_info.shell_port,
            iopub_port: k.connection_info.iopub_port,
            stdin_port: k.connection_info.stdin_port,
            control_port: k.connection_info.control_port,
            hb_port: k.connection_info.hb_port,
            connection_file: shorten_path(&k.connection_file),
        })
        .collect();

    let table = Table::new(rows).with(Style::rounded()).to_string();
    println!("{}", table);
}

async fn start_kernel(name: &str) -> Result<()> {
    let kernelspec = find_kernelspec(name).await?;
    let client = KernelClient::start_from_kernelspec(kernelspec).await?;
    println!("Kernel started with ID: {}", client.kernel_id());
    println!("Connection file: {}", client.connection_file().display());

    Ok(())
}

async fn stop_kernels(id: Option<&str>, all: bool) -> Result<()> {
    if all {
        // Stop all running kernels
        let runtime_dir = runtime_dir();
        let mut entries = fs::read_dir(&runtime_dir).await?;
        let mut stopped = 0;

        while let Some(entry) = entries.next_entry().await? {
            let path = entry.path();
            if path.extension().and_then(|s| s.to_str()) != Some("json") {
                continue;
            }
            let file_name = path.file_name().and_then(|s| s.to_str()).unwrap_or("");
            if !file_name.starts_with("runt-kernel-") {
                continue;
            }

            let kernel_id = file_name
                .strip_prefix("runt-kernel-")
                .and_then(|s| s.strip_suffix(".json"))
                .unwrap_or("unknown");

            match KernelClient::from_connection_file(&path).await {
                Ok(mut client) => {
                    if client.shutdown(false).await.is_ok() {
                        println!("Stopped {}", kernel_id);
                        stopped += 1;
                    } else {
                        eprintln!("Failed to stop {}", kernel_id);
                    }
                }
                Err(_) => {
                    eprintln!("Failed to connect to {}", kernel_id);
                }
            }
        }

        if stopped == 0 {
            println!("No running kernels found.");
        } else {
            println!("\nStopped {} kernel(s)", stopped);
        }
    } else if let Some(id) = id {
        let connection_file = runtime_dir().join(format!("runt-kernel-{}.json", id));
        let mut client = KernelClient::from_connection_file(&connection_file).await?;
        client.shutdown(false).await?;
        println!("Kernel with ID {} stopped", id);
    } else {
        anyhow::bail!("Either provide a kernel ID or use --all to stop all kernels");
    }
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
        ExecuteRequest, ExecutionState, InputReply, JupyterMessage, JupyterMessageContent,
        MediaType, ReplyStatus, Status, Stdio,
    };
    use std::io::{self, Write};

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

    let identity = runtimelib::peer_identity_for_session(session_id)?;
    let shell =
        runtimelib::create_client_shell_connection_with_identity(connection_info, session_id, identity.clone()).await?;
    let mut stdin_conn =
        runtimelib::create_client_stdin_connection_with_identity(connection_info, session_id, identity).await?;
    let (mut shell_writer, mut shell_reader) = shell.split();

    let mut iopub =
        runtimelib::create_client_iopub_connection(connection_info, "", session_id).await?;

    let kernel_name = connection_info
        .kernel_name
        .clone()
        .unwrap_or_else(|| "kernel".to_string());
    println!("{} console", kernel_name);
    println!("Use Ctrl+D to exit.\n");

    let mut execution_count: u32 = 0;

    loop {
        execution_count += 1;
        print!("In [{}]: ", execution_count);
        io::stdout().flush()?;

        // Read one line without holding a persistent StdinLock, so that
        // the kernel stdin handler can also read from terminal stdin.
        let mut line = String::new();
        if io::stdin().read_line(&mut line)? == 0 {
            break; // EOF
        }

        let code = line.trim();
        if code.is_empty() {
            execution_count -= 1;
            continue;
        }

        let mut execute_request = ExecuteRequest::new(code.to_string());
        execute_request.allow_stdin = true;
        let message: JupyterMessage = execute_request.into();
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
                result = stdin_conn.read() => {
                    let msg = result?;
                    if verbose {
                        eprintln!("[stdin] {}", msg.header.msg_type);
                    }
                    if let JupyterMessageContent::InputRequest(ref request) = msg.content {
                        let value = if request.password {
                            eprint!("{}", request.prompt);
                            let _ = io::stderr().flush();
                            rpassword::read_password().unwrap_or_default()
                        } else {
                            eprint!("{}", request.prompt);
                            let _ = io::stderr().flush();
                            let mut input = String::new();
                            io::stdin().read_line(&mut input)?;
                            input.trim_end_matches('\n').to_string()
                        };
                        let reply = InputReply {
                            value,
                            status: ReplyStatus::Ok,
                            error: None,
                        };
                        stdin_conn.send(reply.as_child_of(&msg)).await?;
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

// =============================================================================
// Pool daemon commands
// =============================================================================

async fn pool_command(command: PoolCommands) -> Result<()> {
    use runtimed::client::PoolClient;
    use runtimed::EnvType;

    let client = PoolClient::default();

    match command {
        PoolCommands::Ping => {
            match client.ping().await {
                Ok(()) => {
                    println!("pong");
                }
                Err(e) => {
                    eprintln!("Daemon not running: {}", e);
                    std::process::exit(1);
                }
            }
        }
        PoolCommands::Status { json } => {
            match client.status().await {
                Ok(stats) => {
                    if json {
                        println!("{}", serde_json::to_string_pretty(&stats)?);
                    } else {
                        println!("Pool Daemon Status");
                        println!("==================");
                        println!("UV environments:");
                        println!("  Available: {}", stats.uv_available);
                        println!("  Warming:   {}", stats.uv_warming);
                        println!("Conda environments:");
                        println!("  Available: {}", stats.conda_available);
                        println!("  Warming:   {}", stats.conda_warming);
                    }
                }
                Err(e) => {
                    eprintln!("Failed to get status: {}", e);
                    std::process::exit(1);
                }
            }
        }
        PoolCommands::Take { env_type } => {
            let env_type = match env_type.to_lowercase().as_str() {
                "uv" => EnvType::Uv,
                "conda" => EnvType::Conda,
                _ => {
                    eprintln!("Invalid env_type: {}. Use 'uv' or 'conda'.", env_type);
                    std::process::exit(1);
                }
            };

            match client.take(env_type).await {
                Ok(Some(env)) => {
                    println!("{}", serde_json::to_string_pretty(&env)?);
                }
                Ok(None) => {
                    eprintln!("Pool empty for {}", env_type);
                    std::process::exit(1);
                }
                Err(e) => {
                    eprintln!("Failed to take environment: {}", e);
                    std::process::exit(1);
                }
            }
        }
        PoolCommands::Shutdown => {
            match client.shutdown().await {
                Ok(()) => {
                    println!("Shutdown request sent");
                }
                Err(e) => {
                    eprintln!("Failed to shutdown: {}", e);
                    std::process::exit(1);
                }
            }
        }
    }

    Ok(())
}

async fn debug_session(
    kernel_name: Option<&str>,
    cmd: Option<&str>,
    exec: Option<&str>,
    dump: Option<PathBuf>,
    wait: bool,
) -> Result<()> {
    use jupyter_protocol::{
        ExecuteRequest, ExecutionState, JupyterMessage, JupyterMessageContent, MediaType, Status,
        Stdio,
    };
    use std::io::{self, Write};
    use std::process::{Child, Command, Stdio as ProcessStdio};

    // Determine dump file path
    let dump_path = dump.unwrap_or_else(|| {
        let temp_dir = std::env::temp_dir();
        temp_dir.join(format!("runt-debug-{}.jsonl", uuid::Uuid::new_v4()))
    });

    // Start kernel
    let mut client = match (kernel_name, cmd) {
        (_, Some(cmd)) => KernelClient::start_from_command(cmd).await?,
        (Some(name), None) => {
            let kernelspec = find_kernelspec(name).await?;
            KernelClient::start_from_kernelspec(kernelspec).await?
        }
        (None, None) => anyhow::bail!("Provide a kernel name or --cmd"),
    };

    let connection_file = client.connection_file().to_path_buf();
    let kernel_id = client.kernel_id().to_string();

    println!("Kernel started: {}", kernel_id);
    println!("Connection file: {}", connection_file.display());
    println!("Dump file: {}", dump_path.display());

    // Find sidecar binary (same directory as current executable)
    let current_exe = std::env::current_exe()?;
    let exe_dir = current_exe.parent().unwrap();
    let sidecar_path = exe_dir.join(if cfg!(windows) { "sidecar.exe" } else { "sidecar" });

    if !sidecar_path.exists() {
        anyhow::bail!(
            "Sidecar binary not found at {}. Build with: cargo build -p sidecar",
            sidecar_path.display()
        );
    }

    // Spawn sidecar as subprocess
    let mut sidecar_child: Child = Command::new(&sidecar_path)
        .arg(&connection_file)
        .arg("--dump")
        .arg(&dump_path)
        .stdout(ProcessStdio::null())
        .stderr(ProcessStdio::piped())
        .spawn()?;

    println!("Sidecar started (PID: {})", sidecar_child.id());

    // Give sidecar time to initialize
    tokio::time::sleep(Duration::from_secs(2)).await;

    // Execute code if provided
    if let Some(code) = exec {
        println!("\nExecuting: {}", &code[..code.len().min(80)]);

        let connection_info = client.connection_info();
        let session_id = client.session_id();
        let identity = runtimelib::peer_identity_for_session(session_id)?;
        let shell = runtimelib::create_client_shell_connection_with_identity(
            connection_info,
            session_id,
            identity,
        )
        .await?;
        let (mut shell_writer, mut shell_reader) = shell.split();

        let mut iopub =
            runtimelib::create_client_iopub_connection(connection_info, "", session_id).await?;

        let execute_request = ExecuteRequest::new(code.to_string());
        let message: JupyterMessage = execute_request.into();
        let message_id = message.header.msg_id.clone();
        shell_writer.send(message).await?;

        // Wait for idle status
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
                                    println!("Out: {}", text);
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
                        _ => {}
                    }
                }
                result = shell_reader.read() => {
                    let _ = result?; // Just drain shell replies
                }
            }
        }
        println!("\nExecution complete.");
    }

    // Wait for user interaction if requested
    if wait {
        println!("\nSidecar running. Interact with widgets, then press Ctrl+C to exit.");
        tokio::signal::ctrl_c().await?;
        println!("\nReceived Ctrl+C, shutting down...");
    }

    // Cleanup
    let _ = sidecar_child.kill();
    let _ = sidecar_child.wait();

    println!("\nShutting down kernel...");
    client.shutdown(false).await?;

    println!("\nDebug session complete.");
    println!("Dump file: {}", dump_path.display());
    println!("\nTo analyze:");
    println!("  cat {} | jq -c '{{ts: .ts, dir: .dir, ch: .ch, type: .msg.header.msg_type}}'", dump_path.display());

    Ok(())
}
