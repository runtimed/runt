//! Pool daemon server implementation.
//!
//! The daemon manages prewarmed environment pools and handles requests from
//! notebook windows via IPC (Unix domain sockets on Unix, named pipes on Windows).

use std::collections::VecDeque;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::Arc;
use std::time::Instant;

use log::{error, info, warn};
use notify_debouncer_mini::DebounceEventResult;
use tokio::io::{AsyncBufReadExt, AsyncRead, AsyncWrite, AsyncWriteExt, BufReader};
use tokio::sync::{Mutex, Notify};

#[cfg(unix)]
use tokio::net::UnixListener;

#[cfg(windows)]
use tokio::net::windows::named_pipe::ServerOptions;

use tokio::sync::RwLock;

use crate::protocol::{Request, Response};
use crate::settings_doc::SettingsDoc;
use crate::singleton::{DaemonInfo, DaemonLock};
use crate::{default_cache_dir, default_socket_path, EnvType, PoolStats, PooledEnv};

/// Configuration for the pool daemon.
#[derive(Debug, Clone)]
pub struct DaemonConfig {
    /// Socket path for pool IPC.
    pub socket_path: PathBuf,
    /// Socket path for the Automerge settings sync service.
    pub sync_socket_path: PathBuf,
    /// Cache directory for environments.
    pub cache_dir: PathBuf,
    /// Target number of UV environments to maintain.
    pub uv_pool_size: usize,
    /// Target number of Conda environments to maintain.
    pub conda_pool_size: usize,
    /// Maximum age (in seconds) before an environment is considered stale.
    pub max_age_secs: u64,
    /// Optional custom directory for lock files (used in tests).
    pub lock_dir: Option<PathBuf>,
}

impl Default for DaemonConfig {
    fn default() -> Self {
        Self {
            socket_path: default_socket_path(),
            sync_socket_path: crate::default_sync_socket_path(),
            cache_dir: default_cache_dir(),
            uv_pool_size: 3,
            conda_pool_size: 3,
            max_age_secs: 172800, // 2 days
            lock_dir: None,
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
            info!("[runtimed] Pruned {} stale environments", removed);
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
                "[runtimed] Skipping env with missing path: {:?}",
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
    shutdown: Arc<Mutex<bool>>,
    /// Notifier to wake up accept loops on shutdown.
    shutdown_notify: Arc<Notify>,
    /// Singleton lock - kept alive while daemon is running.
    _lock: DaemonLock,
    /// Shared Automerge settings document.
    settings: Arc<RwLock<SettingsDoc>>,
    /// Broadcast channel to notify sync connections of settings changes.
    settings_changed: tokio::sync::broadcast::Sender<()>,
}

/// Error returned when another daemon is already running.
#[derive(Debug, thiserror::Error)]
#[error("Another daemon is already running: {info:?}")]
pub struct DaemonAlreadyRunning {
    pub info: DaemonInfo,
}

impl Daemon {
    /// Create a new daemon with the given configuration.
    ///
    /// Returns an error if another daemon is already running.
    pub fn new(config: DaemonConfig) -> Result<Arc<Self>, DaemonAlreadyRunning> {
        // Try to acquire the singleton lock
        let lock = DaemonLock::try_acquire(config.lock_dir.as_ref())
            .map_err(|info| DaemonAlreadyRunning { info })?;

        // Load or create the settings document
        let automerge_path = crate::default_settings_doc_path();
        let json_path = crate::settings_json_path();
        let settings = SettingsDoc::load_or_create(&automerge_path, Some(&json_path));

        let (settings_changed, _) = tokio::sync::broadcast::channel(16);

        Ok(Arc::new(Self {
            uv_pool: Mutex::new(Pool::new(config.uv_pool_size, config.max_age_secs)),
            conda_pool: Mutex::new(Pool::new(config.conda_pool_size, config.max_age_secs)),
            config,
            shutdown: Arc::new(Mutex::new(false)),
            shutdown_notify: Arc::new(Notify::new()),
            _lock: lock,
            settings: Arc::new(RwLock::new(settings)),
            settings_changed,
        }))
    }

    /// Run the daemon server.
    pub async fn run(self: Arc<Self>) -> anyhow::Result<()> {
        // Platform-specific setup
        #[cfg(unix)]
        {
            // Ensure socket directory exists
            if let Some(parent) = self.config.socket_path.parent() {
                tokio::fs::create_dir_all(parent).await?;
            }

            // Remove stale socket file
            if self.config.socket_path.exists() {
                tokio::fs::remove_file(&self.config.socket_path).await?;
            }
        }

        // Write daemon info so clients can discover us
        if let Err(e) = self
            ._lock
            .write_info(&self.config.socket_path.to_string_lossy())
        {
            error!("[runtimed] Failed to write daemon info: {}", e);
        }

        // Find and reuse existing environments from previous runs
        self.find_existing_environments().await;

        // Spawn the warming loops
        let uv_daemon = self.clone();
        tokio::spawn(async move {
            uv_daemon.uv_warming_loop().await;
        });

        let conda_daemon = self.clone();
        tokio::spawn(async move {
            conda_daemon.conda_warming_loop().await;
        });

        // Spawn the settings.json file watcher
        let watcher_daemon = self.clone();
        tokio::spawn(async move {
            watcher_daemon.watch_settings_json().await;
        });

        // Spawn the settings sync server
        let sync_socket_path = self.config.sync_socket_path.clone();
        let sync_settings = self.settings.clone();
        let sync_changed = self.settings_changed.clone();
        let sync_shutdown = self.shutdown.clone();
        let sync_shutdown_notify = self.shutdown_notify.clone();
        tokio::spawn(async move {
            if let Err(e) = crate::sync_server::run_sync_server(
                sync_socket_path,
                sync_settings,
                sync_changed,
                sync_shutdown,
                sync_shutdown_notify,
            )
            .await
            {
                error!("[runtimed] Sync server error: {}", e);
            }
        });

        // Platform-specific accept loop
        #[cfg(unix)]
        {
            self.run_unix_server().await?;
        }

        #[cfg(windows)]
        {
            self.run_windows_server().await?;
        }

        // Cleanup socket (Unix only - named pipes don't need cleanup)
        #[cfg(unix)]
        tokio::fs::remove_file(&self.config.socket_path).await.ok();

        Ok(())
    }

    /// Unix-specific server loop using Unix domain sockets.
    #[cfg(unix)]
    async fn run_unix_server(self: &Arc<Self>) -> anyhow::Result<()> {
        let listener = UnixListener::bind(&self.config.socket_path)?;
        info!("[runtimed] Listening on {:?}", self.config.socket_path);

        loop {
            tokio::select! {
                accept_result = listener.accept() => {
                    match accept_result {
                        Ok((stream, _)) => {
                            let daemon = self.clone();
                            tokio::spawn(async move {
                                if let Err(e) = daemon.handle_connection(stream).await {
                                    error!("[runtimed] Connection error: {}", e);
                                }
                            });
                        }
                        Err(e) => {
                            error!("[runtimed] Accept error: {}", e);
                        }
                    }
                }
                _ = self.shutdown_notify.notified() => {
                    info!("[runtimed] Shutting down");
                    break;
                }
            }
        }

        Ok(())
    }

    /// Windows-specific server loop using named pipes.
    #[cfg(windows)]
    async fn run_windows_server(self: &Arc<Self>) -> anyhow::Result<()> {
        let pipe_name = self.config.socket_path.to_string_lossy().to_string();
        info!("[runtimed] Listening on {}", pipe_name);

        // Create the first pipe server instance
        let mut server = ServerOptions::new()
            .first_pipe_instance(true)
            .create(&pipe_name)?;

        loop {
            tokio::select! {
                // Wait for a client to connect
                connect_result = server.connect() => {
                    if let Err(e) = connect_result {
                        error!("[runtimed] Pipe connect error: {}", e);
                        continue;
                    }

                    // The current server instance is now connected - swap it out
                    let connected = server;

                    // Create a new server instance BEFORE spawning the handler
                    // This allows new clients to connect while we handle the current one
                    server = match ServerOptions::new().create(&pipe_name) {
                        Ok(s) => s,
                        Err(e) => {
                            error!("[runtimed] Failed to create new pipe server: {}", e);
                            // Try to recover by creating a new first instance
                            match ServerOptions::new().first_pipe_instance(true).create(&pipe_name) {
                                Ok(s) => s,
                                Err(e) => {
                                    error!("[runtimed] Fatal: cannot create pipe server: {}", e);
                                    break;
                                }
                            }
                        }
                    };

                    // Handle the connection
                    let daemon = self.clone();
                    tokio::spawn(async move {
                        if let Err(e) = daemon.handle_connection(connected).await {
                            error!("[runtimed] Connection error: {}", e);
                        }
                    });
                }
                _ = self.shutdown_notify.notified() => {
                    info!("[runtimed] Shutting down");
                    break;
                }
            }
        }

        Ok(())
    }

    /// Watch `settings.json` for external changes and apply them to the Automerge doc.
    ///
    /// Uses the `notify` crate with a 500ms debouncer. When changes are detected,
    /// reads the file, parses it, and selectively applies any differences to the
    /// Automerge settings document. Self-writes (from `persist_settings`) are
    /// automatically skipped because the file contents match the doc state.
    async fn watch_settings_json(self: Arc<Self>) {
        let json_path = crate::settings_json_path();

        // Determine which path to watch: the file itself if it exists,
        // or the parent directory if it doesn't exist yet.
        let watch_path = if json_path.exists() {
            json_path.clone()
        } else if let Some(parent) = json_path.parent() {
            // Watch parent directory; we'll filter for our file in the handler
            if !parent.exists() {
                if let Err(e) = std::fs::create_dir_all(parent) {
                    error!("[settings-watch] Failed to create config dir: {}", e);
                    return;
                }
            }
            parent.to_path_buf()
        } else {
            error!("[settings-watch] Cannot determine watch path for {:?}", json_path);
            return;
        };

        // Create a tokio mpsc channel to bridge from the notify callback thread
        let (tx, mut rx) = tokio::sync::mpsc::channel::<DebounceEventResult>(16);

        // Create debouncer with 500ms window
        let debouncer_result = notify_debouncer_mini::new_debouncer(
            std::time::Duration::from_millis(500),
            move |res: DebounceEventResult| {
                let _ = tx.blocking_send(res);
            },
        );

        let mut debouncer = match debouncer_result {
            Ok(d) => d,
            Err(e) => {
                error!("[settings-watch] Failed to create file watcher: {}", e);
                return;
            }
        };

        if let Err(e) = debouncer
            .watcher()
            .watch(&watch_path, notify::RecursiveMode::NonRecursive)
        {
            error!("[settings-watch] Failed to watch {:?}: {}", watch_path, e);
            return;
        }

        info!("[settings-watch] Watching {:?} for external changes", watch_path);

        loop {
            tokio::select! {
                Some(result) = rx.recv() => {
                    match result {
                        Ok(events) => {
                            // Check if any event is for our settings file
                            let relevant = events.iter().any(|e| e.path == json_path);
                            if !relevant {
                                continue;
                            }

                            // Read and parse the file
                            let contents = match tokio::fs::read_to_string(&json_path).await {
                                Ok(c) => c,
                                Err(e) => {
                                    // File may have been deleted or is being written
                                    warn!("[settings-watch] Cannot read settings.json: {}", e);
                                    continue;
                                }
                            };

                            let json: serde_json::Value = match serde_json::from_str(&contents) {
                                Ok(j) => j,
                                Err(e) => {
                                    // Partial write or invalid JSON — try again next event
                                    warn!("[settings-watch] Cannot parse settings.json: {}", e);
                                    continue;
                                }
                            };

                            // Apply changes to the Automerge doc
                            let changed = {
                                let mut doc = self.settings.write().await;
                                let changed = doc.apply_json_changes(&json);
                                if changed {
                                    // Persist the updated Automerge binary + JSON mirror
                                    let automerge_path = crate::default_settings_doc_path();
                                    if let Err(e) = doc.save_to_file(&automerge_path) {
                                        warn!("[settings-watch] Failed to save Automerge doc: {}", e);
                                    }
                                    let mirror_path = crate::settings_json_path();
                                    if let Err(e) = doc.save_json_mirror(&mirror_path) {
                                        warn!("[settings-watch] Failed to write JSON mirror: {}", e);
                                    }
                                }
                                changed
                            };

                            if changed {
                                info!("[settings-watch] Applied external settings.json changes");
                                let _ = self.settings_changed.send(());
                            }
                        }
                        Err(errs) => {
                            warn!("[settings-watch] Watch error: {:?}", errs);
                        }
                    }
                }
                _ = self.shutdown_notify.notified() => {
                    if *self.shutdown.lock().await {
                        info!("[settings-watch] Shutting down");
                        break;
                    }
                }
            }
        }
    }

    /// Find and reuse existing runtimed environments from previous runs.
    async fn find_existing_environments(&self) {
        let cache_dir = &self.config.cache_dir;

        if !cache_dir.exists() {
            return;
        }

        let mut entries = match tokio::fs::read_dir(cache_dir).await {
            Ok(e) => e,
            Err(_) => return,
        };

        let mut uv_found = 0;
        let mut conda_found = 0;

        while let Ok(Some(entry)) = entries.next_entry().await {
            let name = entry.file_name().to_string_lossy().to_string();
            let env_path = entry.path();

            // Check for runtimed-uv-* directories
            if name.starts_with("runtimed-uv-") {
                #[cfg(target_os = "windows")]
                let python_path = env_path.join("Scripts").join("python.exe");
                #[cfg(not(target_os = "windows"))]
                let python_path = env_path.join("bin").join("python");

                if python_path.exists() {
                    let mut pool = self.uv_pool.lock().await;
                    if pool.available.len() < pool.target {
                        pool.available.push_back(PoolEntry {
                            env: PooledEnv {
                                env_type: EnvType::Uv,
                                venv_path: env_path.clone(),
                                python_path,
                            },
                            created_at: Instant::now(),
                        });
                        uv_found += 1;
                    }
                } else {
                    // Invalid env, clean up
                    tokio::fs::remove_dir_all(&env_path).await.ok();
                }
            }
            // Check for runtimed-conda-* directories
            else if name.starts_with("runtimed-conda-") {
                #[cfg(target_os = "windows")]
                let python_path = env_path.join("python.exe");
                #[cfg(not(target_os = "windows"))]
                let python_path = env_path.join("bin").join("python");

                if python_path.exists() {
                    let mut pool = self.conda_pool.lock().await;
                    if pool.available.len() < pool.target {
                        pool.available.push_back(PoolEntry {
                            env: PooledEnv {
                                env_type: EnvType::Conda,
                                venv_path: env_path.clone(),
                                python_path,
                            },
                            created_at: Instant::now(),
                        });
                        conda_found += 1;
                    }
                } else {
                    // Invalid env, clean up
                    tokio::fs::remove_dir_all(&env_path).await.ok();
                }
            }
        }

        if uv_found > 0 || conda_found > 0 {
            info!(
                "[runtimed] Found {} existing UV and {} existing Conda environments",
                uv_found, conda_found
            );
        }
    }

    /// Handle a single client connection.
    ///
    /// This method is generic over any stream that implements `AsyncRead + AsyncWrite`,
    /// allowing it to work with both Unix sockets and Windows named pipes.
    async fn handle_connection<S>(self: Arc<Self>, stream: S) -> anyhow::Result<()>
    where
        S: AsyncRead + AsyncWrite + Unpin,
    {
        let (reader, mut writer) = tokio::io::split(stream);
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
                        info!("[runtimed] Took {} env: {:?}", env_type, env.venv_path);
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
                                    daemon.replenish_conda_env().await;
                                });
                            }
                        }
                        Response::Env { env }
                    }
                    None => {
                        info!("[runtimed] Pool miss for {}", env_type);
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
                            info!("[runtimed] Returned UV env: {:?}", env.venv_path);
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
                            info!("[runtimed] Returned Conda env: {:?}", env.venv_path);
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
                self.shutdown_notify.notify_one();
                Response::ShuttingDown
            }

            Request::FlushPool => {
                info!("[runtimed] Flushing all pooled environments");

                // Drain UV pool and delete env directories
                {
                    let mut pool = self.uv_pool.lock().await;
                    let entries: Vec<_> = pool.available.drain(..).collect();
                    for entry in entries {
                        info!("[runtimed] Removing UV env: {:?}", entry.env.venv_path);
                        tokio::fs::remove_dir_all(&entry.env.venv_path).await.ok();
                    }
                }

                // Drain Conda pool and delete env directories
                {
                    let mut pool = self.conda_pool.lock().await;
                    let entries: Vec<_> = pool.available.drain(..).collect();
                    for entry in entries {
                        info!("[runtimed] Removing Conda env: {:?}", entry.env.venv_path);
                        tokio::fs::remove_dir_all(&entry.env.venv_path).await.ok();
                    }
                }

                // Warming loops will detect the deficit and rebuild on their next iteration
                Response::Flushed
            }
        }
    }

    /// UV warming loop - maintains the UV pool.
    async fn uv_warming_loop(&self) {
        // Check if uv is available
        if !self.check_uv_available().await {
            warn!("[runtimed] uv not available, UV warming disabled");
            return;
        }

        info!("[runtimed] Starting UV warming loop");

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
                info!("[runtimed] Creating {} UV environments", deficit);
                for _ in 0..deficit {
                    self.create_uv_env().await;
                }
            }

            // Log status
            let (available, warming) = self.uv_pool.lock().await.stats();
            info!(
                "[runtimed] UV pool: {}/{} available, {} warming",
                available, self.config.uv_pool_size, warming
            );

            tokio::time::sleep(std::time::Duration::from_secs(30)).await;
        }
    }

    /// Conda warming loop - maintains the Conda pool using rattler.
    async fn conda_warming_loop(&self) {
        // Check if we should even try (pool size > 0)
        if self.config.conda_pool_size == 0 {
            info!("[runtimed] Conda pool size is 0, skipping warming");
            return;
        }

        info!(
            "[runtimed] Starting conda warming loop (target: {})",
            self.config.conda_pool_size
        );

        loop {
            // Check shutdown
            if *self.shutdown.lock().await {
                break;
            }

            // Check deficit
            let deficit = self.conda_pool.lock().await.deficit();

            if deficit > 0 {
                info!(
                    "[runtimed] Conda pool deficit: {}, creating {} envs",
                    deficit, deficit
                );

                // Mark as warming
                self.conda_pool.lock().await.mark_warming(deficit);

                // Create environments one at a time (rattler is already efficient)
                for _ in 0..deficit {
                    if *self.shutdown.lock().await {
                        break;
                    }
                    self.create_conda_env().await;
                }
            }

            // Wait before checking again
            tokio::time::sleep(std::time::Duration::from_secs(30)).await;
        }
    }

    /// Create a single Conda environment using rattler and add it to the pool.
    async fn create_conda_env(&self) {
        use rattler::{default_cache_dir, install::Installer, package_cache::PackageCache};
        use rattler_conda_types::{
            Channel, ChannelConfig, GenericVirtualPackage, MatchSpec, ParseMatchSpecOptions,
            Platform,
        };
        use rattler_repodata_gateway::Gateway;
        use rattler_solve::{resolvo, SolverImpl, SolverTask};

        let temp_id = format!("runtimed-conda-{}", uuid::Uuid::new_v4());
        let env_path = self.config.cache_dir.join(&temp_id);

        #[cfg(target_os = "windows")]
        let python_path = env_path.join("python.exe");
        #[cfg(not(target_os = "windows"))]
        let python_path = env_path.join("bin").join("python");

        info!("[runtimed] Creating Conda environment at {:?}", env_path);

        // Ensure cache directory exists
        if let Err(e) = tokio::fs::create_dir_all(&self.config.cache_dir).await {
            error!("[runtimed] Failed to create cache dir: {}", e);
            self.conda_pool.lock().await.warming_failed();
            return;
        }

        // Setup channel configuration
        let channel_config = ChannelConfig::default_with_root_dir(self.config.cache_dir.clone());

        // Parse channels
        let channels = match Channel::from_str("conda-forge", &channel_config) {
            Ok(ch) => vec![ch],
            Err(e) => {
                error!("[runtimed] Failed to parse conda-forge channel: {}", e);
                self.conda_pool.lock().await.warming_failed();
                return;
            }
        };

        // Read default conda packages from synced settings
        let extra_conda_packages: Vec<String> = {
            let settings = self.settings.read().await;
            let synced = settings.get_all();
            synced.conda.default_packages
        };

        if !extra_conda_packages.is_empty() {
            info!(
                "[runtimed] Including default conda packages: {:?}",
                extra_conda_packages
            );
        }

        // Build specs: python + ipykernel + ipywidgets + default packages
        let match_spec_options = ParseMatchSpecOptions::strict();
        let specs: Vec<MatchSpec> = match (|| -> anyhow::Result<Vec<MatchSpec>> {
            let mut specs = vec![
                MatchSpec::from_str("python>=3.9", match_spec_options)?,
                MatchSpec::from_str("ipykernel", match_spec_options)?,
                MatchSpec::from_str("ipywidgets", match_spec_options)?,
            ];
            for pkg in &extra_conda_packages {
                specs.push(MatchSpec::from_str(pkg, match_spec_options)?);
            }
            Ok(specs)
        })() {
            Ok(s) => s,
            Err(e) => {
                error!("[runtimed] Failed to parse match specs: {}", e);
                self.conda_pool.lock().await.warming_failed();
                return;
            }
        };

        // Find rattler cache directory
        let rattler_cache_dir = match default_cache_dir() {
            Ok(dir) => dir,
            Err(e) => {
                error!(
                    "[runtimed] Could not determine rattler cache directory: {}",
                    e
                );
                self.conda_pool.lock().await.warming_failed();
                return;
            }
        };

        if let Err(e) = rattler_cache::ensure_cache_dir(&rattler_cache_dir) {
            error!("[runtimed] Could not create rattler cache directory: {}", e);
            self.conda_pool.lock().await.warming_failed();
            return;
        }

        // Create HTTP client
        let download_client = match reqwest::Client::builder().build() {
            Ok(c) => reqwest_middleware::ClientBuilder::new(c).build(),
            Err(e) => {
                error!("[runtimed] Failed to create HTTP client: {}", e);
                self.conda_pool.lock().await.warming_failed();
                return;
            }
        };

        // Create gateway for fetching repodata
        let gateway = Gateway::builder()
            .with_cache_dir(rattler_cache_dir.join(rattler_cache::REPODATA_CACHE_DIR))
            .with_package_cache(PackageCache::new(
                rattler_cache_dir.join(rattler_cache::PACKAGE_CACHE_DIR),
            ))
            .with_client(download_client.clone())
            .finish();

        // Query repodata
        let install_platform = Platform::current();
        let platforms = vec![install_platform, Platform::NoArch];

        info!("[runtimed] Fetching conda repodata from conda-forge...");
        let repo_data = match gateway
            .query(channels.clone(), platforms.clone(), specs.clone())
            .recursive(true)
            .await
        {
            Ok(data) => data,
            Err(e) => {
                error!("[runtimed] Failed to fetch repodata: {}", e);
                self.conda_pool.lock().await.warming_failed();
                return;
            }
        };

        info!("[runtimed] Repodata fetched, solving dependencies...");

        // Detect virtual packages
        let virtual_packages = match rattler_virtual_packages::VirtualPackage::detect(
            &rattler_virtual_packages::VirtualPackageOverrides::default(),
        ) {
            Ok(vps) => vps
                .iter()
                .map(|vpkg| GenericVirtualPackage::from(vpkg.clone()))
                .collect::<Vec<_>>(),
            Err(e) => {
                error!("[runtimed] Failed to detect virtual packages: {}", e);
                self.conda_pool.lock().await.warming_failed();
                return;
            }
        };

        // Solve dependencies
        let solver_task = SolverTask {
            virtual_packages,
            specs,
            ..SolverTask::from_iter(&repo_data)
        };

        let required_packages = match resolvo::Solver.solve(solver_task) {
            Ok(result) => result.records,
            Err(e) => {
                error!("[runtimed] Failed to solve dependencies: {}", e);
                self.conda_pool.lock().await.warming_failed();
                return;
            }
        };

        info!(
            "[runtimed] Solved: {} packages to install",
            required_packages.len()
        );

        // Install packages
        let install_result = Installer::new()
            .with_download_client(download_client)
            .with_target_platform(install_platform)
            .install(&env_path, required_packages)
            .await;

        if let Err(e) = install_result {
            error!("[runtimed] Failed to install packages: {}", e);
            tokio::fs::remove_dir_all(&env_path).await.ok();
            self.conda_pool.lock().await.warming_failed();
            return;
        }

        // Verify python exists
        if !python_path.exists() {
            error!(
                "[runtimed] Python not found at {:?} after install",
                python_path
            );
            tokio::fs::remove_dir_all(&env_path).await.ok();
            self.conda_pool.lock().await.warming_failed();
            return;
        }

        // Run warmup script
        self.warmup_conda_env(&python_path, &env_path).await;

        // Add to pool
        let env = PooledEnv {
            env_type: EnvType::Conda,
            venv_path: env_path.clone(),
            python_path,
        };

        self.conda_pool.lock().await.add(env);
        info!(
            "[runtimed] Conda environment ready: {:?} (pool: {}/{})",
            env_path,
            self.conda_pool.lock().await.stats().0,
            self.config.conda_pool_size
        );
    }

    /// Warm up a conda environment by running Python to trigger .pyc compilation.
    async fn warmup_conda_env(&self, python_path: &PathBuf, env_path: &PathBuf) {
        let warmup_script = r#"
import ipykernel
import IPython
import ipywidgets
import traitlets
import zmq
from ipykernel.kernelbase import Kernel
from ipykernel.ipkernel import IPythonKernel
from ipykernel.comm import CommManager
print("warmup complete")
"#;

        let warmup_result = tokio::time::timeout(
            std::time::Duration::from_secs(30),
            tokio::process::Command::new(python_path)
                .args(["-c", warmup_script])
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .output(),
        )
        .await;

        match warmup_result {
            Ok(Ok(output)) if output.status.success() => {
                // Create marker file
                tokio::fs::write(env_path.join(".warmed"), "").await.ok();
                info!("[runtimed] Conda warmup complete for {:?}", env_path);
            }
            Ok(Ok(output)) => {
                let stderr = String::from_utf8_lossy(&output.stderr);
                warn!(
                    "[runtimed] Conda warmup failed for {:?}: {}",
                    env_path,
                    stderr.lines().take(3).collect::<Vec<_>>().join(" | ")
                );
            }
            Ok(Err(e)) => {
                warn!("[runtimed] Failed to run conda warmup: {}", e);
            }
            Err(_) => {
                warn!("[runtimed] Conda warmup timed out");
            }
        }
    }

    /// Replenish a single Conda environment.
    async fn replenish_conda_env(&self) {
        self.conda_pool.lock().await.mark_warming(1);
        self.create_conda_env().await;
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
        let temp_id = format!("runtimed-uv-{}", uuid::Uuid::new_v4());
        let venv_path = self.config.cache_dir.join(&temp_id);

        #[cfg(target_os = "windows")]
        let python_path = venv_path.join("Scripts").join("python.exe");
        #[cfg(not(target_os = "windows"))]
        let python_path = venv_path.join("bin").join("python");

        info!("[runtimed] Creating UV environment at {:?}", venv_path);

        // Ensure cache directory exists
        if let Err(e) = tokio::fs::create_dir_all(&self.config.cache_dir).await {
            error!("[runtimed] Failed to create cache dir: {}", e);
            self.uv_pool.lock().await.warming_failed();
            return;
        }

        // Create venv (60 second timeout)
        let venv_result = tokio::time::timeout(
            std::time::Duration::from_secs(60),
            tokio::process::Command::new("uv")
                .arg("venv")
                .arg(&venv_path)
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .status(),
        )
        .await;

        match venv_result {
            Ok(Ok(status)) if status.success() => {}
            Ok(Ok(_)) => {
                error!("[runtimed] Failed to create venv");
                self.uv_pool.lock().await.warming_failed();
                return;
            }
            Ok(Err(e)) => {
                error!("[runtimed] Failed to create venv: {}", e);
                self.uv_pool.lock().await.warming_failed();
                return;
            }
            Err(_) => {
                error!("[runtimed] Timeout creating venv");
                tokio::fs::remove_dir_all(&venv_path).await.ok();
                self.uv_pool.lock().await.warming_failed();
                return;
            }
        }

        // Build install args: ipykernel + ipywidgets + default packages from settings
        let mut install_packages = vec!["ipykernel".to_string(), "ipywidgets".to_string()];

        // Read default uv packages from synced settings
        {
            let settings = self.settings.read().await;
            let synced = settings.get_all();
            let extra = synced.uv.default_packages;
            if !extra.is_empty() {
                info!("[runtimed] Including default uv packages: {:?}", extra);
                install_packages.extend(extra);
            }
        }

        // Install packages (120 second timeout)
        let mut install_args = vec![
            "pip".to_string(),
            "install".to_string(),
            "--python".to_string(),
            python_path.to_string_lossy().to_string(),
        ];
        install_args.extend(install_packages);

        let install_result = tokio::time::timeout(
            std::time::Duration::from_secs(120),
            tokio::process::Command::new("uv")
                .args(&install_args)
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .status(),
        )
        .await;

        match install_result {
            Ok(Ok(status)) if status.success() => {}
            Ok(Ok(_)) | Ok(Err(_)) => {
                error!("[runtimed] Failed to install ipykernel");
                tokio::fs::remove_dir_all(&venv_path).await.ok();
                self.uv_pool.lock().await.warming_failed();
                return;
            }
            Err(_) => {
                error!("[runtimed] Timeout installing packages");
                tokio::fs::remove_dir_all(&venv_path).await.ok();
                self.uv_pool.lock().await.warming_failed();
                return;
            }
        }

        // Warm up the environment (30 second timeout)
        let warmup_script = r#"
import ipykernel
import IPython
import ipywidgets
from ipykernel.kernelbase import Kernel
from ipykernel.ipkernel import IPythonKernel
print("warmup complete")
"#;

        let warmup_result = tokio::time::timeout(
            std::time::Duration::from_secs(30),
            tokio::process::Command::new(&python_path)
                .args(["-c", warmup_script])
                .output(),
        )
        .await;

        match warmup_result {
            Ok(Ok(output)) if output.status.success() => {
                // Create marker file
                tokio::fs::write(venv_path.join(".warmed"), "").await.ok();
            }
            Ok(_) => {
                warn!("[runtimed] Warmup script failed, continuing anyway");
            }
            Err(_) => {
                warn!("[runtimed] Warmup script timed out, continuing anyway");
            }
        }

        info!("[runtimed] UV environment ready at {:?}", venv_path);

        // Add to pool
        self.uv_pool.lock().await.add(PooledEnv {
            env_type: EnvType::Uv,
            venv_path,
            python_path,
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use tempfile::TempDir;

    fn create_test_env(temp_dir: &TempDir, name: &str) -> PooledEnv {
        let venv_path = temp_dir.path().join(name);
        std::fs::create_dir_all(&venv_path).unwrap();

        #[cfg(windows)]
        let python_path = venv_path.join("Scripts").join("python.exe");
        #[cfg(not(windows))]
        let python_path = venv_path.join("bin").join("python");

        // Create the python file so it "exists"
        if let Some(parent) = python_path.parent() {
            std::fs::create_dir_all(parent).unwrap();
        }
        std::fs::write(&python_path, "").unwrap();

        PooledEnv {
            env_type: EnvType::Uv,
            venv_path,
            python_path,
        }
    }

    #[test]
    fn test_pool_new() {
        let pool = Pool::new(3, 3600);
        assert_eq!(pool.target, 3);
        assert_eq!(pool.max_age_secs, 3600);
        assert_eq!(pool.available.len(), 0);
        assert_eq!(pool.warming, 0);
    }

    #[test]
    fn test_pool_add_and_take() {
        let temp_dir = TempDir::new().unwrap();
        let mut pool = Pool::new(3, 3600);

        let env = create_test_env(&temp_dir, "test-env");
        pool.add(env.clone());

        assert_eq!(pool.available.len(), 1);

        let taken = pool.take();
        assert!(taken.is_some());
        assert_eq!(taken.unwrap().venv_path, env.venv_path);
        assert_eq!(pool.available.len(), 0);
    }

    #[test]
    fn test_pool_take_empty() {
        let mut pool = Pool::new(3, 3600);
        let taken = pool.take();
        assert!(taken.is_none());
    }

    #[test]
    fn test_pool_take_skips_missing_paths() {
        let temp_dir = TempDir::new().unwrap();
        let mut pool = Pool::new(3, 3600);

        // Add an env with a path that doesn't exist
        let missing_env = PooledEnv {
            env_type: EnvType::Uv,
            venv_path: PathBuf::from("/nonexistent/path"),
            python_path: PathBuf::from("/nonexistent/path/bin/python"),
        };
        pool.available.push_back(PoolEntry {
            env: missing_env,
            created_at: Instant::now(),
        });

        // Add a valid env
        let valid_env = create_test_env(&temp_dir, "valid-env");
        pool.add(valid_env.clone());

        // Take should skip the missing one and return the valid one
        let taken = pool.take();
        assert!(taken.is_some());
        assert_eq!(taken.unwrap().venv_path, valid_env.venv_path);
    }

    #[test]
    fn test_pool_deficit() {
        let temp_dir = TempDir::new().unwrap();
        let mut pool = Pool::new(3, 3600);

        // Initially, deficit is 3 (need 3, have 0)
        assert_eq!(pool.deficit(), 3);

        // Add one env directly, deficit is 2
        let env1 = create_test_env(&temp_dir, "env1");
        pool.add(env1);
        // Note: add() decrements warming, but it was 0 so stays 0
        assert_eq!(pool.available.len(), 1);
        assert_eq!(pool.warming, 0);
        assert_eq!(pool.deficit(), 2);

        // Mark that we're warming 1 more, deficit is 1
        pool.mark_warming(1);
        assert_eq!(pool.warming, 1);
        assert_eq!(pool.deficit(), 1); // 1 available + 1 warming = 2, need 1 more

        // Add another (simulating warming completion), deficit is 1
        // add() decrements warming: 1 -> 0
        let env2 = create_test_env(&temp_dir, "env2");
        pool.add(env2);
        assert_eq!(pool.available.len(), 2);
        assert_eq!(pool.warming, 0);
        assert_eq!(pool.deficit(), 1); // 2 available, need 1 more

        // Mark warming for the last one
        pool.mark_warming(1);
        assert_eq!(pool.deficit(), 0); // 2 available + 1 warming = 3 = target

        // Add the last one
        let env3 = create_test_env(&temp_dir, "env3");
        pool.add(env3);
        assert_eq!(pool.available.len(), 3);
        assert_eq!(pool.warming, 0);
        assert_eq!(pool.deficit(), 0); // 3 available = target

        // Taking one should increase deficit
        pool.take();
        assert_eq!(pool.available.len(), 2);
        assert_eq!(pool.deficit(), 1);
    }

    #[test]
    fn test_pool_warming_failed() {
        let mut pool = Pool::new(3, 3600);

        pool.mark_warming(2);
        assert_eq!(pool.warming, 2);

        pool.warming_failed();
        assert_eq!(pool.warming, 1);

        pool.warming_failed();
        assert_eq!(pool.warming, 0);

        // Should not go negative
        pool.warming_failed();
        assert_eq!(pool.warming, 0);
    }

    #[test]
    fn test_pool_stats() {
        let temp_dir = TempDir::new().unwrap();
        let mut pool = Pool::new(3, 3600);

        let (available, warming) = pool.stats();
        assert_eq!(available, 0);
        assert_eq!(warming, 0);

        let env = create_test_env(&temp_dir, "env1");
        pool.add(env);
        pool.mark_warming(2);

        let (available, warming) = pool.stats();
        assert_eq!(available, 1);
        assert_eq!(warming, 2);
    }

    #[test]
    fn test_daemon_config_default() {
        let config = DaemonConfig::default();
        assert_eq!(config.uv_pool_size, 3);
        assert_eq!(config.conda_pool_size, 3);
        assert!(config
            .socket_path
            .to_string_lossy()
            .contains("runtimed.sock"));
    }

    #[test]
    fn test_env_type_display() {
        assert_eq!(format!("{}", EnvType::Uv), "uv");
        assert_eq!(format!("{}", EnvType::Conda), "conda");
    }
}
