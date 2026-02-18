//! runtimed CLI entry point.
//!
//! This runs the runtime daemon as a standalone process that manages
//! prewarmed Python environments for notebook windows.

use std::path::PathBuf;

use clap::{Parser, Subcommand};
use log::info;
use runtimed::client::PoolClient;
use runtimed::daemon::{Daemon, DaemonConfig};
use runtimed::service::ServiceManager;
use runtimed::singleton::get_running_daemon_info;

#[derive(Parser, Debug)]
#[command(name = "runtimed")]
#[command(about = "Runtime daemon for managing Jupyter environments")]
struct Cli {
    #[command(subcommand)]
    command: Option<Commands>,

    /// Log level
    #[arg(long, global = true, default_value = "info")]
    log_level: String,
}

#[derive(Subcommand, Debug)]
enum Commands {
    /// Run the daemon (default if no command specified)
    Run {
        /// Socket path for IPC (default: ~/.cache/runt/runtimed.sock)
        #[arg(long)]
        socket: Option<PathBuf>,

        /// Cache directory for environments (default: ~/.cache/runt/envs)
        #[arg(long)]
        cache_dir: Option<PathBuf>,

        /// Number of UV environments to maintain
        #[arg(long, default_value = "3")]
        uv_pool_size: usize,

        /// Number of Conda environments to maintain
        #[arg(long, default_value = "3")]
        conda_pool_size: usize,
    },

    /// Install daemon as a system service
    Install {
        /// Path to the daemon binary to install (default: current binary)
        #[arg(long)]
        binary: Option<PathBuf>,
    },

    /// Uninstall daemon system service
    Uninstall,

    /// Check daemon status
    Status {
        /// Output in JSON format
        #[arg(long)]
        json: bool,
    },

    /// Start the installed service
    Start,

    /// Stop the installed service
    Stop,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let cli = Cli::parse();

    // Initialize logging
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or(&cli.log_level))
        .init();

    match cli.command {
        None | Some(Commands::Run { .. }) => {
            // Extract run args from command or use defaults
            let (socket, cache_dir, uv_pool_size, conda_pool_size) = match cli.command {
                Some(Commands::Run {
                    socket,
                    cache_dir,
                    uv_pool_size,
                    conda_pool_size,
                }) => (socket, cache_dir, uv_pool_size, conda_pool_size),
                _ => (None, None, 3, 3),
            };

            run_daemon(socket, cache_dir, uv_pool_size, conda_pool_size).await
        }
        Some(Commands::Install { binary }) => install_service(binary),
        Some(Commands::Uninstall) => uninstall_service(),
        Some(Commands::Status { json }) => status(json).await,
        Some(Commands::Start) => start_service(),
        Some(Commands::Stop) => stop_service(),
    }
}

async fn run_daemon(
    socket: Option<PathBuf>,
    cache_dir: Option<PathBuf>,
    uv_pool_size: usize,
    conda_pool_size: usize,
) -> anyhow::Result<()> {
    info!("runtimed starting...");

    let config = DaemonConfig {
        socket_path: socket.unwrap_or_else(runtimed::default_socket_path),
        cache_dir: cache_dir.unwrap_or_else(runtimed::default_cache_dir),
        uv_pool_size,
        conda_pool_size,
        ..Default::default()
    };

    info!("Configuration:");
    info!("  Socket: {:?}", config.socket_path);
    info!("  Cache dir: {:?}", config.cache_dir);
    info!("  UV pool size: {}", config.uv_pool_size);
    info!("  Conda pool size: {}", config.conda_pool_size);

    let daemon = match Daemon::new(config) {
        Ok(d) => d,
        Err(e) => {
            eprintln!("Error: {}", e);
            eprintln!(
                "Running daemon: pid={}, endpoint={}",
                e.info.pid, e.info.endpoint
            );
            std::process::exit(1);
        }
    };
    daemon.run().await
}

fn install_service(binary: Option<PathBuf>) -> anyhow::Result<()> {
    let source_binary = binary.unwrap_or_else(|| {
        std::env::current_exe().expect("Failed to get current executable path")
    });

    println!("Installing runtimed service...");
    println!("Source binary: {}", source_binary.display());

    let manager = ServiceManager::default();

    if manager.is_installed() {
        println!("Service already installed. Use 'uninstall' first to reinstall.");
        std::process::exit(1);
    }

    manager.install(&source_binary)?;

    println!();
    println!("Service installed successfully!");
    println!("The daemon will start automatically at login.");
    println!();
    println!("To start now: runtimed start");
    println!("To check status: runtimed status");
    println!("To uninstall: runtimed uninstall");

    Ok(())
}

fn uninstall_service() -> anyhow::Result<()> {
    println!("Uninstalling runtimed service...");

    let manager = ServiceManager::default();

    if !manager.is_installed() {
        println!("Service not installed.");
        return Ok(());
    }

    manager.uninstall()?;

    println!("Service uninstalled successfully.");

    Ok(())
}

async fn status(json: bool) -> anyhow::Result<()> {
    let manager = ServiceManager::default();
    let installed = manager.is_installed();

    // Check if daemon is running
    let daemon_info = get_running_daemon_info();
    let running = if daemon_info.is_some() {
        // Try to ping to confirm it's actually responding
        let client = PoolClient::default();
        client.ping().await.is_ok()
    } else {
        false
    };

    // Get pool stats if running
    let stats = if running {
        let client = PoolClient::default();
        client.status().await.ok()
    } else {
        None
    };

    if json {
        let output = serde_json::json!({
            "installed": installed,
            "running": running,
            "daemon_info": daemon_info,
            "pool_stats": stats,
        });
        println!("{}", serde_json::to_string_pretty(&output)?);
    } else {
        println!("runtimed Status");
        println!("===============");
        println!("Service installed: {}", if installed { "yes" } else { "no" });
        println!(
            "Daemon running:    {}",
            if running { "yes" } else { "no" }
        );

        if let Some(info) = daemon_info {
            println!();
            println!("Daemon Info:");
            println!("  PID:      {}", info.pid);
            println!("  Endpoint: {}", info.endpoint);
            println!("  Version:  {}", info.version);
            println!("  Started:  {}", info.started_at);
        }

        if let Some(stats) = stats {
            println!();
            println!("Pool Statistics:");
            println!("  UV:    {}/{} available", stats.uv_available, stats.uv_available + stats.uv_warming);
            println!("  Conda: {}/{} available", stats.conda_available, stats.conda_available + stats.conda_warming);
        }
    }

    Ok(())
}

fn start_service() -> anyhow::Result<()> {
    let manager = ServiceManager::default();

    if !manager.is_installed() {
        eprintln!("Service not installed. Run 'runtimed install' first.");
        std::process::exit(1);
    }

    println!("Starting runtimed service...");
    manager.start()?;
    println!("Service started.");

    Ok(())
}

fn stop_service() -> anyhow::Result<()> {
    let manager = ServiceManager::default();

    if !manager.is_installed() {
        eprintln!("Service not installed.");
        std::process::exit(1);
    }

    println!("Stopping runtimed service...");
    manager.stop()?;
    println!("Service stopped.");

    Ok(())
}
