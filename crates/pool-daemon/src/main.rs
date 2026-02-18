//! Pool daemon CLI entry point.
//!
//! This runs the pool daemon as a standalone process that manages
//! prewarmed Python environments for notebook windows.

use std::path::PathBuf;

use clap::Parser;
use log::info;
use pool_daemon::daemon::{Daemon, DaemonConfig};

#[derive(Parser, Debug)]
#[command(name = "pool-daemon")]
#[command(about = "Prewarmed Python environment pool daemon")]
struct Args {
    /// Socket path for IPC (default: ~/.cache/runt/pool-daemon.sock)
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

    /// Log level
    #[arg(long, default_value = "info")]
    log_level: String,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let args = Args::parse();

    // Initialize logging
    env_logger::Builder::from_env(
        env_logger::Env::default().default_filter_or(&args.log_level),
    )
    .init();

    info!("Pool daemon starting...");

    let config = DaemonConfig {
        socket_path: args.socket.unwrap_or_else(pool_daemon::default_socket_path),
        cache_dir: args.cache_dir.unwrap_or_else(pool_daemon::default_cache_dir),
        uv_pool_size: args.uv_pool_size,
        conda_pool_size: args.conda_pool_size,
        ..Default::default()
    };

    info!("Configuration:");
    info!("  Socket: {:?}", config.socket_path);
    info!("  Cache dir: {:?}", config.cache_dir);
    info!("  UV pool size: {}", config.uv_pool_size);
    info!("  Conda pool size: {}", config.conda_pool_size);

    let daemon = Daemon::new(config);
    daemon.run().await
}
