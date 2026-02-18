//! Pool daemon server implementation.
//!
//! The daemon manages prewarmed environment pools and handles requests from
//! notebook windows via Unix domain socket.

use std::collections::VecDeque;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::Arc;
use std::time::Instant;

use log::{error, info, warn};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::{UnixListener, UnixStream};
use tokio::sync::Mutex;

use crate::protocol::{Request, Response};
use crate::{default_cache_dir, default_socket_path, EnvType, PoolStats, PooledEnv};

/// Configuration for the pool daemon.
#[derive(Debug, Clone)]
pub struct DaemonConfig {
    /// Socket path for IPC.
    pub socket_path: PathBuf,
    /// Cache directory for environments.
    pub cache_dir: PathBuf,
    /// Target number of UV environments to maintain.
    pub uv_pool_size: usize,
    /// Target number of Conda environments to maintain.
    pub conda_pool_size: usize,
    /// Maximum age (in seconds) before an environment is considered stale.
    pub max_age_secs: u64,
}

impl Default for DaemonConfig {
    fn default() -> Self {
        Self {
            socket_path: default_socket_path(),
            cache_dir: default_cache_dir(),
            uv_pool_size: 3,
            conda_pool_size: 3,
            max_age_secs: 172800, // 2 days
        }
    }
}

/// A prewarmed environment in the pool.
struct PoolEntry {
    env: PooledEnv,
    created_at: Instant,
}

/// Internal pool state.
struct Pool {
    /// Available environments ready for use.
    available: VecDeque<PoolEntry>,
    /// Number currently being created.
    warming: usize,
    /// Target pool size.
    target: usize,
    /// Maximum age in seconds.
    max_age_secs: u64,
}

impl Pool {
    fn new(target: usize, max_age_secs: u64) -> Self {
        Self {
            available: VecDeque::new(),
            warming: 0,
            target,
            max_age_secs,
        }
    }

    /// Prune stale environments.
    fn prune_stale(&mut self) {
        let max_age = std::time::Duration::from_secs(self.max_age_secs);
        let before = self.available.len();
        self.available.retain(|e| e.created_at.elapsed() < max_age);
        let removed = before - self.available.len();
        if removed > 0 {
            info!("[pool-daemon] Pruned {} stale environments", removed);
        }
    }

    /// Take an environment from the pool.
    fn take(&mut self) -> Option<PooledEnv> {
        self.prune_stale();

        // Try to get a valid environment, skipping any with missing paths
        while let Some(entry) = self.available.pop_front() {
            if entry.env.venv_path.exists() && entry.env.python_path.exists() {
                return Some(entry.env);
            }
            warn!(
                "[pool-daemon] Skipping env with missing path: {:?}",
                entry.env.venv_path
            );
        }

        None
    }

    /// Add an environment to the pool.
    fn add(&mut self, env: PooledEnv) {
        self.available.push_back(PoolEntry {
            env,
            created_at: Instant::now(),
        });
        self.warming = self.warming.saturating_sub(1);
    }

    /// Mark that warming failed.
    fn warming_failed(&mut self) {
        self.warming = self.warming.saturating_sub(1);
    }

    /// Calculate deficit (how many more we need).
    fn deficit(&self) -> usize {
        let current = self.available.len() + self.warming;
        self.target.saturating_sub(current)
    }

    /// Mark that we're starting to create N environments.
    fn mark_warming(&mut self, count: usize) {
        self.warming += count;
    }

    /// Get current stats.
    fn stats(&self) -> (usize, usize) {
        (self.available.len(), self.warming)
    }
}

/// The pool daemon state.
pub struct Daemon {
    config: DaemonConfig,
    uv_pool: Mutex<Pool>,
    conda_pool: Mutex<Pool>,
    shutdown: Mutex<bool>,
}

impl Daemon {
    /// Create a new daemon with the given configuration.
    pub fn new(config: DaemonConfig) -> Arc<Self> {
        Arc::new(Self {
            uv_pool: Mutex::new(Pool::new(config.uv_pool_size, config.max_age_secs)),
            conda_pool: Mutex::new(Pool::new(config.conda_pool_size, config.max_age_secs)),
            config,
            shutdown: Mutex::new(false),
        })
    }

    /// Run the daemon server.
    pub async fn run(self: Arc<Self>) -> anyhow::Result<()> {
        // Ensure socket directory exists
        if let Some(parent) = self.config.socket_path.parent() {
            tokio::fs::create_dir_all(parent).await?;
        }

        // Remove stale socket file
        if self.config.socket_path.exists() {
            tokio::fs::remove_file(&self.config.socket_path).await?;
        }

        // Bind to the socket
        let listener = UnixListener::bind(&self.config.socket_path)?;
        info!(
            "[pool-daemon] Listening on {:?}",
            self.config.socket_path
        );

        // Spawn the warming loops
        let uv_daemon = self.clone();
        tokio::spawn(async move {
            uv_daemon.uv_warming_loop().await;
        });

        let conda_daemon = self.clone();
        tokio::spawn(async move {
            conda_daemon.conda_warming_loop().await;
        });

        // Accept connections
        loop {
            if *self.shutdown.lock().await {
                info!("[pool-daemon] Shutting down");
                break;
            }

            match listener.accept().await {
                Ok((stream, _)) => {
                    let daemon = self.clone();
                    tokio::spawn(async move {
                        if let Err(e) = daemon.handle_connection(stream).await {
                            error!("[pool-daemon] Connection error: {}", e);
                        }
                    });
                }
                Err(e) => {
                    error!("[pool-daemon] Accept error: {}", e);
                }
            }
        }

        // Cleanup socket
        tokio::fs::remove_file(&self.config.socket_path).await.ok();

        Ok(())
    }

    /// Handle a single client connection.
    async fn handle_connection(self: Arc<Self>, stream: UnixStream) -> anyhow::Result<()> {
        let (reader, mut writer) = stream.into_split();
        let mut reader = BufReader::new(reader);
        let mut line = String::new();

        loop {
            line.clear();
            let bytes_read = reader.read_line(&mut line).await?;
            if bytes_read == 0 {
                // Connection closed
                break;
            }

            let request = match Request::from_line(&line) {
                Ok(req) => req,
                Err(e) => {
                    let response = Response::Error {
                        message: format!("Invalid request: {}", e),
                    };
                    writer.write_all(response.to_line()?.as_bytes()).await?;
                    continue;
                }
            };

            let response = self.clone().handle_request(request).await;
            writer.write_all(response.to_line()?.as_bytes()).await?;
        }

        Ok(())
    }

    /// Handle a single request.
    async fn handle_request(self: Arc<Self>, request: Request) -> Response {
        match request {
            Request::Take { env_type } => {
                let env = match env_type {
                    EnvType::Uv => self.uv_pool.lock().await.take(),
                    EnvType::Conda => self.conda_pool.lock().await.take(),
                };

                match env {
                    Some(env) => {
                        info!(
                            "[pool-daemon] Took {} env: {:?}",
                            env_type, env.venv_path
                        );
                        // Spawn replenishment
                        let daemon = self.clone();
                        match env_type {
                            EnvType::Uv => {
                                tokio::spawn(async move {
                                    daemon.create_uv_env().await;
                                });
                            }
                            EnvType::Conda => {
                                tokio::spawn(async move {
                                    daemon.create_conda_env().await;
                                });
                            }
                        }
                        Response::Env { env }
                    }
                    None => {
                        info!("[pool-daemon] Pool miss for {}", env_type);
                        Response::Empty
                    }
                }
            }

            Request::Return { env } => {
                // Return an environment to the pool (e.g., if notebook closed without using it)
                match env.env_type {
                    EnvType::Uv => {
                        let mut pool = self.uv_pool.lock().await;
                        if pool.available.len() < pool.target {
                            pool.available.push_back(PoolEntry {
                                env: env.clone(),
                                created_at: Instant::now(),
                            });
                            info!("[pool-daemon] Returned UV env: {:?}", env.venv_path);
                        } else {
                            // Pool is full, clean up
                            tokio::fs::remove_dir_all(&env.venv_path).await.ok();
                        }
                    }
                    EnvType::Conda => {
                        let mut pool = self.conda_pool.lock().await;
                        if pool.available.len() < pool.target {
                            pool.available.push_back(PoolEntry {
                                env: env.clone(),
                                created_at: Instant::now(),
                            });
                            info!("[pool-daemon] Returned Conda env: {:?}", env.venv_path);
                        } else {
                            tokio::fs::remove_dir_all(&env.venv_path).await.ok();
                        }
                    }
                }
                Response::Returned
            }

            Request::Status => {
                let (uv_available, uv_warming) = self.uv_pool.lock().await.stats();
                let (conda_available, conda_warming) = self.conda_pool.lock().await.stats();
                Response::Stats {
                    stats: PoolStats {
                        uv_available,
                        uv_warming,
                        conda_available,
                        conda_warming,
                    },
                }
            }

            Request::Ping => Response::Pong,

            Request::Shutdown => {
                *self.shutdown.lock().await = true;
                Response::ShuttingDown
            }
        }
    }

    /// UV warming loop - maintains the UV pool.
    async fn uv_warming_loop(&self) {
        // Check if uv is available
        if !self.check_uv_available().await {
            warn!("[pool-daemon] uv not available, UV warming disabled");
            return;
        }

        info!("[pool-daemon] Starting UV warming loop");

        loop {
            if *self.shutdown.lock().await {
                break;
            }

            let deficit = {
                let mut pool = self.uv_pool.lock().await;
                let d = pool.deficit();
                if d > 0 {
                    pool.mark_warming(d);
                }
                d
            };

            if deficit > 0 {
                info!("[pool-daemon] Creating {} UV environments", deficit);
                for _ in 0..deficit {
                    self.create_uv_env().await;
                }
            }

            // Log status
            let (available, warming) = self.uv_pool.lock().await.stats();
            info!(
                "[pool-daemon] UV pool: {}/{} available, {} warming",
                available,
                self.config.uv_pool_size,
                warming
            );

            tokio::time::sleep(std::time::Duration::from_secs(30)).await;
        }
    }

    /// Conda warming loop - maintains the Conda pool.
    async fn conda_warming_loop(&self) {
        info!("[pool-daemon] Conda warming loop not implemented yet");
        // TODO: Implement conda environment creation
    }

    /// Check if uv is available on PATH.
    async fn check_uv_available(&self) -> bool {
        tokio::process::Command::new("uv")
            .arg("--version")
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .await
            .map(|s| s.success())
            .unwrap_or(false)
    }

    /// Create a single UV environment and add it to the pool.
    async fn create_uv_env(&self) {
        let temp_id = format!("prewarm-{}", uuid::Uuid::new_v4());
        let venv_path = self.config.cache_dir.join(&temp_id);

        #[cfg(target_os = "windows")]
        let python_path = venv_path.join("Scripts").join("python.exe");
        #[cfg(not(target_os = "windows"))]
        let python_path = venv_path.join("bin").join("python");

        info!("[pool-daemon] Creating UV environment at {:?}", venv_path);

        // Ensure cache directory exists
        if let Err(e) = tokio::fs::create_dir_all(&self.config.cache_dir).await {
            error!("[pool-daemon] Failed to create cache dir: {}", e);
            self.uv_pool.lock().await.warming_failed();
            return;
        }

        // Create venv
        let venv_status = tokio::process::Command::new("uv")
            .arg("venv")
            .arg(&venv_path)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .status()
            .await;

        if !matches!(venv_status, Ok(s) if s.success()) {
            error!("[pool-daemon] Failed to create venv");
            self.uv_pool.lock().await.warming_failed();
            return;
        }

        // Install ipykernel
        let install_status = tokio::process::Command::new("uv")
            .args([
                "pip",
                "install",
                "--python",
                &python_path.to_string_lossy(),
                "ipykernel",
                "ipywidgets",
            ])
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .status()
            .await;

        if !matches!(install_status, Ok(s) if s.success()) {
            error!("[pool-daemon] Failed to install ipykernel");
            tokio::fs::remove_dir_all(&venv_path).await.ok();
            self.uv_pool.lock().await.warming_failed();
            return;
        }

        // Warm up the environment
        let warmup_script = r#"
import ipykernel
import IPython
import ipywidgets
from ipykernel.kernelbase import Kernel
from ipykernel.ipkernel import IPythonKernel
print("warmup complete")
"#;

        let warmup_result = tokio::process::Command::new(&python_path)
            .args(["-c", warmup_script])
            .output()
            .await;

        if let Ok(output) = warmup_result {
            if output.status.success() {
                // Create marker file
                tokio::fs::write(venv_path.join(".warmed"), "").await.ok();
            }
        }

        info!("[pool-daemon] UV environment ready at {:?}", venv_path);

        // Add to pool
        self.uv_pool.lock().await.add(PooledEnv {
            env_type: EnvType::Uv,
            venv_path,
            python_path,
        });
    }

    /// Create a single Conda environment and add it to the pool.
    async fn create_conda_env(&self) {
        // TODO: Implement conda environment creation
        self.conda_pool.lock().await.warming_failed();
    }
}
