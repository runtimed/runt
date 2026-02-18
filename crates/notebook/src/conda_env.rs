//! Conda-based environment management for notebook dependencies.
//!
//! This module handles creating ephemeral conda environments using `rattler`
//! for notebooks that declare inline dependencies in their metadata.

use anyhow::{anyhow, Result};
use log::{info, warn};
use rattler::{
    default_cache_dir,
    install::{Installer, Reporter, Transaction},
    package_cache::PackageCache,
};
use rattler_conda_types::{
    Channel, ChannelConfig, GenericVirtualPackage, MatchSpec, ParseMatchSpecOptions, Platform,
    PrefixRecord, RepoDataRecord,
};
use rattler_repodata_gateway::Gateway;
use rattler_solve::{resolvo, SolverImpl, SolverTask};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::sync::RwLock;
use std::time::Instant;
use tauri::{AppHandle, Emitter};

/// Progress phases during environment preparation.
/// Emitted as Tauri events for frontend progress display.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "phase", rename_all = "snake_case")]
pub enum EnvProgressPhase {
    /// Starting environment preparation
    Starting { env_hash: String },
    /// Using a cached environment (fast path)
    CacheHit { env_path: String },
    /// Fetching package metadata from channels
    FetchingRepodata { channels: Vec<String> },
    /// Repodata fetch complete
    RepodataComplete { record_count: usize, elapsed_ms: u64 },
    /// Solving dependency graph
    Solving { spec_count: usize },
    /// Solve complete
    SolveComplete { package_count: usize, elapsed_ms: u64 },
    /// Installing packages (legacy phase, kept for backward compat)
    Installing { total: usize },
    /// Download progress for individual packages
    DownloadProgress {
        /// Number of packages fully downloaded
        completed: usize,
        /// Total number of packages to download
        total: usize,
        /// Name of the package currently being downloaded
        current_package: String,
        /// Total bytes downloaded so far
        bytes_downloaded: u64,
        /// Total bytes to download (if known)
        bytes_total: Option<u64>,
        /// Current download speed in bytes per second
        bytes_per_second: f64,
    },
    /// Linking/installing packages into the environment
    LinkProgress {
        /// Number of packages fully linked
        completed: usize,
        /// Total number of packages to link
        total: usize,
        /// Name of the package currently being linked
        current_package: String,
    },
    /// Installation complete
    InstallComplete { elapsed_ms: u64 },
    /// Environment is ready
    Ready { env_path: String, python_path: String },
    /// An error occurred
    Error { message: String },
}

/// Full progress event payload sent to frontend.
#[derive(Debug, Clone, Serialize)]
pub struct EnvProgressEvent {
    pub env_type: String,
    #[serde(flatten)]
    pub phase: EnvProgressPhase,
}

/// Emit a progress event to the frontend.
fn emit_progress(app: Option<&AppHandle>, phase: EnvProgressPhase) {
    if let Some(app) = app {
        let event = EnvProgressEvent {
            env_type: "conda".to_string(),
            phase,
        };
        if let Err(e) = app.emit("env:progress", &event) {
            log::warn!("Failed to emit env:progress event: {}", e);
        }
    }
}

/// Reporter implementation for tracking installation progress.
///
/// This implements the rattler Reporter trait to provide granular progress
/// updates during package download and installation.
pub struct ProgressReporter {
    app: Option<AppHandle>,
    /// Total packages to download
    total_downloads: AtomicUsize,
    /// Number of packages fully downloaded
    downloaded_packages: AtomicUsize,
    /// Total bytes downloaded across all packages
    bytes_downloaded: AtomicU64,
    /// Total bytes to download (if known)
    bytes_total: AtomicU64,
    /// When downloading started
    download_start: RwLock<Option<Instant>>,
    /// Total packages to link
    total_to_link: AtomicUsize,
    /// Number of packages fully linked
    linked_packages: AtomicUsize,
    /// Package names indexed by operation/cache index
    package_names: RwLock<HashMap<usize, String>>,
    /// Current package being downloaded
    current_download: RwLock<Option<String>>,
    /// Last time we emitted a download progress event (for throttling)
    last_download_emit: RwLock<Option<Instant>>,
}

impl ProgressReporter {
    /// Create a new progress reporter.
    pub fn new(app: Option<AppHandle>) -> Self {
        Self {
            app,
            total_downloads: AtomicUsize::new(0),
            downloaded_packages: AtomicUsize::new(0),
            bytes_downloaded: AtomicU64::new(0),
            bytes_total: AtomicU64::new(0),
            download_start: RwLock::new(None),
            total_to_link: AtomicUsize::new(0),
            linked_packages: AtomicUsize::new(0),
            package_names: RwLock::new(HashMap::new()),
            current_download: RwLock::new(None),
            last_download_emit: RwLock::new(None),
        }
    }

    /// Emit download progress (throttled to avoid flooding)
    fn emit_download_progress(&self) {
        // Throttle to at most once per 100ms
        {
            let mut last_emit = self.last_download_emit.write().unwrap();
            if let Some(last) = *last_emit {
                if last.elapsed().as_millis() < 100 {
                    return;
                }
            }
            *last_emit = Some(Instant::now());
        }

        let completed = self.downloaded_packages.load(Ordering::SeqCst);
        let total = self.total_downloads.load(Ordering::SeqCst);
        let bytes_downloaded = self.bytes_downloaded.load(Ordering::SeqCst);
        let bytes_total = self.bytes_total.load(Ordering::SeqCst);

        let current_package = self
            .current_download
            .read()
            .unwrap()
            .clone()
            .unwrap_or_default();

        // Calculate speed
        let bytes_per_second = {
            let start = self.download_start.read().unwrap();
            match *start {
                Some(s) => {
                    let elapsed = s.elapsed().as_secs_f64();
                    if elapsed > 0.0 {
                        bytes_downloaded as f64 / elapsed
                    } else {
                        0.0
                    }
                }
                None => 0.0,
            }
        };

        emit_progress(
            self.app.as_ref(),
            EnvProgressPhase::DownloadProgress {
                completed,
                total,
                current_package,
                bytes_downloaded,
                bytes_total: if bytes_total > 0 {
                    Some(bytes_total)
                } else {
                    None
                },
                bytes_per_second,
            },
        );
    }

    /// Emit link progress
    fn emit_link_progress(&self, current_package: String) {
        let completed = self.linked_packages.load(Ordering::SeqCst);
        let total = self.total_to_link.load(Ordering::SeqCst);

        emit_progress(
            self.app.as_ref(),
            EnvProgressPhase::LinkProgress {
                completed,
                total,
                current_package,
            },
        );
    }
}

impl Reporter for ProgressReporter {
    fn on_transaction_start(&self, transaction: &Transaction<PrefixRecord, RepoDataRecord>) {
        let total = transaction.operations.len();
        self.total_to_link.store(total, Ordering::SeqCst);

        // Count how many packages need to be downloaded (rough estimate)
        // The actual count may be less if packages are cached
        self.total_downloads.store(total, Ordering::SeqCst);

        // Initialize download start time
        *self.download_start.write().unwrap() = Some(Instant::now());
    }

    fn on_transaction_operation_start(&self, _operation: usize) {
        // Called when an operation (unlink or link) starts
    }

    fn on_populate_cache_start(&self, cache_entry: usize, record: &RepoDataRecord) -> usize {
        // Store the package name for later reference
        let name = record.package_record.name.as_source().to_string();
        self.package_names.write().unwrap().insert(cache_entry, name);
        cache_entry
    }

    fn on_validate_start(&self, cache_entry: usize) -> usize {
        cache_entry
    }

    fn on_validate_complete(&self, _validate_idx: usize) {
        // Validation complete - package was already in cache
    }

    fn on_download_start(&self, cache_entry: usize) -> usize {
        // Set current download package
        let name = self
            .package_names
            .read()
            .unwrap()
            .get(&cache_entry)
            .cloned()
            .unwrap_or_default();
        *self.current_download.write().unwrap() = Some(name);
        cache_entry
    }

    fn on_download_progress(&self, _download_idx: usize, progress: u64, total: Option<u64>) {
        self.bytes_downloaded.fetch_add(progress, Ordering::SeqCst);
        if let Some(t) = total {
            // Update total if provided (first call usually has it)
            let current_total = self.bytes_total.load(Ordering::SeqCst);
            if current_total == 0 {
                self.bytes_total.store(t, Ordering::SeqCst);
            }
        }
        self.emit_download_progress();
    }

    fn on_download_completed(&self, _download_idx: usize) {
        self.downloaded_packages.fetch_add(1, Ordering::SeqCst);
        self.emit_download_progress();
    }

    fn on_populate_cache_complete(&self, _cache_entry: usize) {
        // Cache population complete (either validated or downloaded)
    }

    fn on_unlink_start(&self, operation: usize, _record: &PrefixRecord) -> usize {
        operation
    }

    fn on_unlink_complete(&self, _index: usize) {
        // Unlink complete
    }

    fn on_link_start(&self, operation: usize, record: &RepoDataRecord) -> usize {
        let name = record.package_record.name.as_source().to_string();
        self.package_names.write().unwrap().insert(operation, name.clone());
        self.emit_link_progress(name);
        operation
    }

    fn on_link_complete(&self, index: usize) {
        self.linked_packages.fetch_add(1, Ordering::SeqCst);
        let name = self
            .package_names
            .read()
            .unwrap()
            .get(&index)
            .cloned()
            .unwrap_or_default();
        self.emit_link_progress(name);
    }

    fn on_transaction_operation_complete(&self, _operation: usize) {
        // Operation complete
    }

    fn on_transaction_complete(&self) {
        // Transaction complete - all packages installed
    }

    fn on_post_link_start(&self, _package_name: &str, _script_path: &str) -> usize {
        0
    }

    fn on_post_link_complete(&self, _index: usize, _success: bool) {
        // Post-link script complete
    }

    fn on_pre_unlink_start(&self, _package_name: &str, _script_path: &str) -> usize {
        0
    }

    fn on_pre_unlink_complete(&self, _index: usize, _success: bool) {
        // Pre-unlink script complete
    }
}

/// Dependencies extracted from notebook metadata (conda format).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CondaDependencies {
    pub dependencies: Vec<String>,
    #[serde(default)]
    pub channels: Vec<String>,
    pub python: Option<String>,
    /// Unique environment ID for per-notebook isolation.
    /// If set, this ID is included in the environment hash to ensure
    /// each notebook gets its own isolated environment.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub env_id: Option<String>,
}

/// Result of environment preparation.
#[derive(Debug, Clone)]
pub struct CondaEnvironment {
    pub env_path: PathBuf,
    pub python_path: PathBuf,
}

/// Extract dependencies from notebook metadata.
///
/// Looks for the `conda` key in the metadata's additional fields,
/// which should contain `dependencies`, optionally `channels`, and optionally `python`.
pub fn extract_dependencies(metadata: &nbformat::v4::Metadata) -> Option<CondaDependencies> {
    let conda_value = metadata.additional.get("conda")?;
    serde_json::from_value(conda_value.clone()).ok()
}

/// Compute a cache key for the given dependencies.
fn compute_env_hash(deps: &CondaDependencies) -> String {
    let mut hasher = Sha256::new();

    // Sort dependencies for consistent hashing
    let mut sorted_deps = deps.dependencies.clone();
    sorted_deps.sort();

    for dep in &sorted_deps {
        hasher.update(dep.as_bytes());
        hasher.update(b"\n");
    }

    // Include channels in the hash
    let mut sorted_channels = deps.channels.clone();
    sorted_channels.sort();
    for channel in &sorted_channels {
        hasher.update(b"channel:");
        hasher.update(channel.as_bytes());
        hasher.update(b"\n");
    }

    if let Some(ref py) = deps.python {
        hasher.update(b"python:");
        hasher.update(py.as_bytes());
    }

    // Include env_id for per-notebook isolation
    if let Some(ref env_id) = deps.env_id {
        hasher.update(b"env_id:");
        hasher.update(env_id.as_bytes());
    }

    let hash = hasher.finalize();
    format!("{:x}", hash)[..16].to_string()
}

/// Get the cache directory for runt conda environments.
fn get_cache_dir() -> PathBuf {
    dirs::cache_dir()
        .unwrap_or_else(|| PathBuf::from("/tmp"))
        .join("runt")
        .join("conda-envs")
}

/// Prepare a conda environment with the given dependencies.
///
/// Uses cached environments when possible (keyed by dependency hash).
/// If the cache doesn't exist or is invalid, creates a new environment using rattler.
///
/// If `app` is provided, progress events will be emitted to the frontend.
pub async fn prepare_environment(
    deps: &CondaDependencies,
    app: Option<&AppHandle>,
) -> Result<CondaEnvironment> {
    let hash = compute_env_hash(deps);
    let cache_dir = get_cache_dir();
    let env_path = cache_dir.join(&hash);

    emit_progress(app, EnvProgressPhase::Starting { env_hash: hash.clone() });

    // Determine python path based on platform
    #[cfg(target_os = "windows")]
    let python_path = env_path.join("python.exe");
    #[cfg(not(target_os = "windows"))]
    let python_path = env_path.join("bin").join("python");

    // Check if cached environment exists and is valid
    if env_path.exists() && python_path.exists() {
        info!("Using cached conda environment at {:?}", env_path);
        emit_progress(app, EnvProgressPhase::CacheHit {
            env_path: env_path.to_string_lossy().to_string(),
        });
        emit_progress(app, EnvProgressPhase::Ready {
            env_path: env_path.to_string_lossy().to_string(),
            python_path: python_path.to_string_lossy().to_string(),
        });
        return Ok(CondaEnvironment {
            env_path,
            python_path,
        });
    }

    info!("Creating new conda environment at {:?}", env_path);

    // Ensure cache directory exists
    tokio::fs::create_dir_all(&cache_dir).await?;

    // Remove partial/invalid environment if it exists
    if env_path.exists() {
        tokio::fs::remove_dir_all(&env_path).await?;
    }

    // Setup channel configuration
    let channel_config = ChannelConfig::default_with_root_dir(cache_dir.clone());

    // Parse channels (default to conda-forge if none specified)
    let channels: Vec<Channel> = if deps.channels.is_empty() {
        vec![Channel::from_str("conda-forge", &channel_config)?]
    } else {
        deps.channels
            .iter()
            .map(|c| Channel::from_str(c, &channel_config))
            .collect::<Result<Vec<_>, _>>()?
    };

    let channel_names: Vec<String> = channels.iter().map(|c| c.name().to_string()).collect();

    // Build specs: python + ipykernel + user dependencies
    let match_spec_options = ParseMatchSpecOptions::strict();
    let mut specs: Vec<MatchSpec> = Vec::new();

    // Add python version constraint
    if let Some(ref py) = deps.python {
        specs.push(MatchSpec::from_str(&format!("python={}", py), match_spec_options)?);
    } else {
        specs.push(MatchSpec::from_str("python>=3.9", match_spec_options)?);
    }

    // Add ipykernel (required for Jupyter)
    specs.push(MatchSpec::from_str("ipykernel", match_spec_options)?);
    // Add ipywidgets for interactive widget support
    specs.push(MatchSpec::from_str("ipywidgets", match_spec_options)?);

    // Add user dependencies
    for dep in &deps.dependencies {
        specs.push(MatchSpec::from_str(dep, match_spec_options)?);
    }

    info!("Resolving conda packages: {:?}", specs);

    // Find or create the rattler cache directory
    let rattler_cache_dir = default_cache_dir()
        .map_err(|e| anyhow!("could not determine rattler cache directory: {}", e))?;
    rattler_cache::ensure_cache_dir(&rattler_cache_dir)
        .map_err(|e| anyhow!("could not create rattler cache directory: {}", e))?;

    // Create HTTP client for downloading
    let download_client = reqwest::Client::builder().build()?;
    let download_client = reqwest_middleware::ClientBuilder::new(download_client).build();

    // Create gateway for fetching repodata
    let gateway = Gateway::builder()
        .with_cache_dir(rattler_cache_dir.join(rattler_cache::REPODATA_CACHE_DIR))
        .with_package_cache(PackageCache::new(
            rattler_cache_dir.join(rattler_cache::PACKAGE_CACHE_DIR),
        ))
        .with_client(download_client.clone())
        .finish();

    // Determine platforms to query
    let install_platform = Platform::current();
    let platforms = vec![install_platform, Platform::NoArch];

    // Query repodata from channels with retry logic for transient failures
    info!("Fetching repodata from channels: {:?}", channels);
    emit_progress(app, EnvProgressPhase::FetchingRepodata { channels: channel_names });

    let repodata_start = Instant::now();

    // Retry configuration for transient network errors (e.g., conda-forge 500 errors)
    const MAX_RETRIES: u32 = 3;
    const INITIAL_DELAY_MS: u64 = 1000;

    let mut last_error = None;
    let mut repo_data = None;

    for attempt in 0..MAX_RETRIES {
        if attempt > 0 {
            let delay_ms = INITIAL_DELAY_MS * (1 << (attempt - 1)); // Exponential backoff
            info!(
                "Retrying repodata fetch (attempt {}/{}) after {}ms...",
                attempt + 1,
                MAX_RETRIES,
                delay_ms
            );
            tokio::time::sleep(tokio::time::Duration::from_millis(delay_ms)).await;
        }

        match gateway
            .query(channels.clone(), platforms.clone(), specs.clone())
            .recursive(true)
            .await
        {
            Ok(data) => {
                repo_data = Some(data);
                break;
            }
            Err(e) => {
                let error_str = e.to_string();
                // Check if it's a retryable error (server errors, timeouts)
                let is_retryable = error_str.contains("500")
                    || error_str.contains("502")
                    || error_str.contains("503")
                    || error_str.contains("504")
                    || error_str.contains("timeout")
                    || error_str.contains("connection");

                if is_retryable && attempt < MAX_RETRIES - 1 {
                    info!(
                        "Transient error fetching repodata (attempt {}): {}",
                        attempt + 1,
                        error_str
                    );
                    last_error = Some(e);
                    continue;
                }

                let error_msg = format!("Failed to fetch package metadata: {}", e);
                emit_progress(app, EnvProgressPhase::Error { message: error_msg.clone() });
                return Err(anyhow!(error_msg));
            }
        }
    }

    let repo_data = match repo_data {
        Some(data) => data,
        None => {
            let error_msg = format!(
                "Failed to fetch package metadata after {} retries: {}",
                MAX_RETRIES,
                last_error.map(|e| e.to_string()).unwrap_or_else(|| "unknown error".to_string())
            );
            emit_progress(app, EnvProgressPhase::Error { message: error_msg.clone() });
            return Err(anyhow!(error_msg));
        }
    };

    let total_records: usize = repo_data.iter().map(|r| r.len()).sum();
    let repodata_elapsed = repodata_start.elapsed();
    info!(
        "Loaded {} package records in {:?}",
        total_records,
        repodata_elapsed
    );
    emit_progress(app, EnvProgressPhase::RepodataComplete {
        record_count: total_records,
        elapsed_ms: repodata_elapsed.as_millis() as u64,
    });

    // Detect virtual packages (system capabilities like __glibc, __cuda, etc.)
    let virt_start = Instant::now();
    let virtual_packages = rattler_virtual_packages::VirtualPackage::detect(
        &rattler_virtual_packages::VirtualPackageOverrides::default(),
    )?
    .iter()
    .map(|vpkg| GenericVirtualPackage::from(vpkg.clone()))
    .collect::<Vec<_>>();

    info!(
        "Detected {} virtual packages in {:?}",
        virtual_packages.len(),
        virt_start.elapsed()
    );

    // Solve dependencies
    info!("Solving dependencies...");
    emit_progress(app, EnvProgressPhase::Solving { spec_count: specs.len() });

    let solve_start = Instant::now();
    let solver_task = SolverTask {
        virtual_packages,
        specs,
        ..SolverTask::from_iter(&repo_data)
    };

    let solver_result = match resolvo::Solver.solve(solver_task) {
        Ok(result) => result,
        Err(e) => {
            let error_msg = format!("Failed to solve dependencies: {}", e);
            emit_progress(app, EnvProgressPhase::Error { message: error_msg.clone() });
            return Err(anyhow!(error_msg));
        }
    };
    let required_packages = solver_result.records;
    let solve_elapsed = solve_start.elapsed();

    info!(
        "Solved: {} packages to install in {:?}",
        required_packages.len(),
        solve_elapsed
    );
    emit_progress(app, EnvProgressPhase::SolveComplete {
        package_count: required_packages.len(),
        elapsed_ms: solve_elapsed.as_millis() as u64,
    });

    // Install packages to the environment prefix
    info!("Installing packages to {:?}", env_path);
    emit_progress(app, EnvProgressPhase::Installing { total: required_packages.len() });

    // Create progress reporter for granular progress updates
    let reporter = ProgressReporter::new(app.cloned());

    let install_start = Instant::now();
    let _result = match Installer::new()
        .with_download_client(download_client)
        .with_target_platform(install_platform)
        .with_reporter(reporter)
        .install(&env_path, required_packages)
        .await
    {
        Ok(result) => result,
        Err(e) => {
            let error_msg = format!("Failed to install packages: {}", e);
            emit_progress(app, EnvProgressPhase::Error { message: error_msg.clone() });
            return Err(anyhow!(error_msg));
        }
    };

    let install_elapsed = install_start.elapsed();
    info!(
        "Conda environment ready at {:?} (install took {:?})",
        env_path,
        install_elapsed
    );
    emit_progress(app, EnvProgressPhase::InstallComplete {
        elapsed_ms: install_elapsed.as_millis() as u64,
    });
    emit_progress(app, EnvProgressPhase::Ready {
        env_path: env_path.to_string_lossy().to_string(),
        python_path: python_path.to_string_lossy().to_string(),
    });

    Ok(CondaEnvironment {
        env_path,
        python_path,
    })
}

/// Clean up an ephemeral environment.
///
/// Note: We don't actually remove cached environments since they can be reused.
/// This is called on kernel shutdown but only cleans up if needed.
pub async fn cleanup_environment(_env: &CondaEnvironment) -> Result<()> {
    // For now, we keep cached environments for reuse.
    // Could add LRU eviction or size-based cleanup later.
    Ok(())
}

/// Force remove a cached environment (for manual cleanup).
#[allow(dead_code)]
pub async fn remove_environment(env: &CondaEnvironment) -> Result<()> {
    if env.env_path.exists() {
        tokio::fs::remove_dir_all(&env.env_path).await?;
    }
    Ok(())
}

/// Install additional dependencies into an existing environment.
///
/// This is used to sync new dependencies when the kernel is already running.
/// Uses rattler to solve and install the new packages into the existing prefix.
pub async fn sync_dependencies(env: &CondaEnvironment, deps: &CondaDependencies) -> Result<()> {
    if deps.dependencies.is_empty() {
        return Ok(());
    }

    info!(
        "Syncing {} dependencies to {:?}",
        deps.dependencies.len(),
        env.env_path
    );

    // Setup channel configuration
    let cache_dir = get_cache_dir();
    let channel_config = ChannelConfig::default_with_root_dir(cache_dir.clone());

    // Parse channels (default to conda-forge if none specified)
    let channels: Vec<Channel> = if deps.channels.is_empty() {
        vec![Channel::from_str("conda-forge", &channel_config)?]
    } else {
        deps.channels
            .iter()
            .map(|c| Channel::from_str(c, &channel_config))
            .collect::<Result<Vec<_>, _>>()?
    };

    // Build specs for all dependencies (including existing ones to ensure compatibility)
    let match_spec_options = ParseMatchSpecOptions::strict();
    let mut specs: Vec<MatchSpec> = Vec::new();

    for dep in &deps.dependencies {
        specs.push(MatchSpec::from_str(dep, match_spec_options)?);
    }

    info!("Resolving {} conda packages for sync", specs.len());

    // Find rattler cache directory
    let rattler_cache_dir = default_cache_dir()
        .map_err(|e| anyhow!("could not determine rattler cache directory: {}", e))?;

    // Create HTTP client
    let download_client = reqwest::Client::builder().build()?;
    let download_client = reqwest_middleware::ClientBuilder::new(download_client).build();

    // Create gateway for fetching repodata
    let gateway = Gateway::builder()
        .with_cache_dir(rattler_cache_dir.join(rattler_cache::REPODATA_CACHE_DIR))
        .with_package_cache(PackageCache::new(
            rattler_cache_dir.join(rattler_cache::PACKAGE_CACHE_DIR),
        ))
        .with_client(download_client.clone())
        .finish();

    // Query repodata with retry logic
    let install_platform = Platform::current();
    let platforms = vec![install_platform, Platform::NoArch];

    const MAX_RETRIES: u32 = 3;
    const INITIAL_DELAY_MS: u64 = 1000;

    let mut last_error = None;
    let mut repo_data = None;

    for attempt in 0..MAX_RETRIES {
        if attempt > 0 {
            let delay_ms = INITIAL_DELAY_MS * (1 << (attempt - 1));
            info!(
                "Retrying repodata fetch for sync (attempt {}/{}) after {}ms...",
                attempt + 1,
                MAX_RETRIES,
                delay_ms
            );
            tokio::time::sleep(tokio::time::Duration::from_millis(delay_ms)).await;
        }

        match gateway
            .query(channels.clone(), platforms.clone(), specs.clone())
            .recursive(true)
            .await
        {
            Ok(data) => {
                repo_data = Some(data);
                break;
            }
            Err(e) => {
                let error_str = e.to_string();
                let is_retryable = error_str.contains("500")
                    || error_str.contains("502")
                    || error_str.contains("503")
                    || error_str.contains("504")
                    || error_str.contains("timeout")
                    || error_str.contains("connection");

                if is_retryable && attempt < MAX_RETRIES - 1 {
                    info!(
                        "Transient error fetching repodata for sync (attempt {}): {}",
                        attempt + 1,
                        error_str
                    );
                    last_error = Some(e);
                    continue;
                }
                return Err(anyhow!("Failed to fetch package metadata: {}", e));
            }
        }
    }

    let repo_data = repo_data.ok_or_else(|| {
        anyhow!(
            "Failed to fetch package metadata after {} retries: {}",
            MAX_RETRIES,
            last_error.map(|e| e.to_string()).unwrap_or_else(|| "unknown error".to_string())
        )
    })?;

    // Detect virtual packages
    let virtual_packages = rattler_virtual_packages::VirtualPackage::detect(
        &rattler_virtual_packages::VirtualPackageOverrides::default(),
    )?
    .iter()
    .map(|vpkg| GenericVirtualPackage::from(vpkg.clone()))
    .collect::<Vec<_>>();

    // Get currently installed packages
    let installed_packages =
        PrefixRecord::collect_from_prefix::<PrefixRecord>(&env.env_path)?;

    // Solve dependencies
    info!("Solving dependencies for sync...");
    let solver_task = SolverTask {
        virtual_packages,
        specs,
        locked_packages: installed_packages
            .iter()
            .map(|r| r.repodata_record.clone())
            .collect(),
        ..SolverTask::from_iter(&repo_data)
    };

    let solver_result = resolvo::Solver.solve(solver_task)?;
    let required_packages = solver_result.records;

    info!("Installing {} packages for sync", required_packages.len());

    // Install to the existing prefix
    let _result = Installer::new()
        .with_download_client(download_client)
        .with_target_platform(install_platform)
        .with_installed_packages(installed_packages)
        .install(&env.env_path, required_packages)
        .await?;

    info!("Conda dependencies synced successfully");
    Ok(())
}

/// Clear all cached conda environments.
#[allow(dead_code)]
pub async fn clear_cache() -> Result<()> {
    let cache_dir = get_cache_dir();
    if cache_dir.exists() {
        tokio::fs::remove_dir_all(&cache_dir).await?;
    }
    Ok(())
}

// =============================================================================
// Prewarming support
// =============================================================================

/// Create a prewarmed conda environment with just ipykernel installed.
///
/// This creates a generic environment at a temporary path (`prewarm-{uuid}`)
/// that can later be claimed by a notebook using `claim_prewarmed_conda_environment`.
/// The environment has no `env_id` in its hash, allowing it to be reused by any notebook.
pub async fn create_prewarmed_conda_environment(
    app: Option<&AppHandle>,
) -> Result<CondaEnvironment> {
    let temp_id = format!("prewarm-{}", uuid::Uuid::new_v4());
    let cache_dir = get_cache_dir();
    let env_path = cache_dir.join(&temp_id);

    // Determine python path based on platform
    #[cfg(target_os = "windows")]
    let python_path = env_path.join("python.exe");
    #[cfg(not(target_os = "windows"))]
    let python_path = env_path.join("bin").join("python");

    info!("[prewarm] Creating prewarmed conda environment at {:?}", env_path);

    // Ensure cache directory exists
    tokio::fs::create_dir_all(&cache_dir).await?;

    // Create minimal dependencies (just ipykernel)
    let deps = CondaDependencies {
        dependencies: vec!["ipykernel".to_string(), "ipywidgets".to_string()],
        channels: vec!["conda-forge".to_string()],
        python: None, // Use default Python version
        env_id: None, // No env_id for prewarmed envs
    };

    // Reuse the core environment creation logic
    create_environment_at_path(&env_path, &deps, app).await?;

    info!("[prewarm] Prewarmed conda environment created at {:?}", env_path);

    let env = CondaEnvironment {
        env_path,
        python_path,
    };

    // Warm up the environment by running Python to trigger .pyc compilation
    warmup_conda_environment(&env).await?;

    Ok(env)
}

/// Warm up a conda environment by running Python to trigger initialization.
///
/// This compiles .pyc files and runs first-time setup for ipykernel,
/// dramatically reducing kernel startup time on subsequent use.
pub async fn warmup_conda_environment(env: &CondaEnvironment) -> Result<()> {
    let warmup_start = std::time::Instant::now();
    info!("[prewarm] Warming up conda environment at {:?}", env.env_path);

    // Script that imports key packages to trigger .pyc compilation
    let warmup_script = r#"
# Warmup script - triggers .pyc compilation and initialization
import sys
import ipykernel
import IPython
import ipywidgets
import traitlets
import zmq

# Force ipykernel to initialize key components
from ipykernel.kernelbase import Kernel
from ipykernel.ipkernel import IPythonKernel

# Import comm for widget support
from ipykernel.comm import CommManager

print("warmup complete")
"#;

    let output = tokio::process::Command::new(&env.python_path)
        .args(["-c", warmup_script])
        .output()
        .await?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        warn!("[prewarm] Warmup failed for {:?}: {}", env.env_path, stderr);
        // Don't fail the whole operation - environment is still usable
        return Ok(());
    }

    // Create marker file to indicate this env has been warmed
    let marker_path = env.env_path.join(".warmed");
    tokio::fs::write(&marker_path, "").await.ok();

    info!(
        "[prewarm] Warmup complete for {:?} in {}ms",
        env.env_path,
        warmup_start.elapsed().as_millis()
    );

    Ok(())
}

/// Internal function to create a conda environment at a specific path.
///
/// This is the core rattler solve/install logic extracted for reuse.
async fn create_environment_at_path(
    env_path: &std::path::Path,
    deps: &CondaDependencies,
    app: Option<&AppHandle>,
) -> Result<()> {
    // Setup channel configuration
    let cache_dir = get_cache_dir();
    let channel_config = ChannelConfig::default_with_root_dir(cache_dir.clone());

    // Parse channels (default to conda-forge if none specified)
    let channels: Vec<Channel> = if deps.channels.is_empty() {
        vec![Channel::from_str("conda-forge", &channel_config)?]
    } else {
        deps.channels
            .iter()
            .map(|c| Channel::from_str(c, &channel_config))
            .collect::<Result<Vec<_>, _>>()?
    };

    emit_progress(app, EnvProgressPhase::FetchingRepodata {
        channels: deps.channels.clone(),
    });

    // Build specs: base packages plus dependencies
    let match_spec_options = ParseMatchSpecOptions::strict();
    let mut specs: Vec<MatchSpec> = vec![
        MatchSpec::from_str("ipykernel", match_spec_options)?,
        MatchSpec::from_str("ipywidgets", match_spec_options)?,
    ];

    // Add python version constraint if specified
    if let Some(ref py_version) = deps.python {
        let py_spec = format!("python>={}", py_version);
        specs.push(MatchSpec::from_str(&py_spec, match_spec_options)?);
    }

    // Add user dependencies
    for dep in &deps.dependencies {
        if dep != "ipykernel" && dep != "ipywidgets" {
            specs.push(MatchSpec::from_str(dep, match_spec_options)?);
        }
    }

    emit_progress(app, EnvProgressPhase::Solving { spec_count: specs.len() });

    // Find rattler cache directory
    let rattler_cache_dir = default_cache_dir()
        .map_err(|e| anyhow!("could not determine rattler cache directory: {}", e))?;

    // Create HTTP client
    let download_client = reqwest::Client::builder().build()?;
    let download_client = reqwest_middleware::ClientBuilder::new(download_client).build();

    // Create gateway for fetching repodata
    let gateway = Gateway::builder()
        .with_cache_dir(rattler_cache_dir.join(rattler_cache::REPODATA_CACHE_DIR))
        .with_package_cache(PackageCache::new(
            rattler_cache_dir.join(rattler_cache::PACKAGE_CACHE_DIR),
        ))
        .with_client(download_client.clone())
        .finish();

    // Query repodata with retry logic
    let install_platform = Platform::current();
    let platforms = vec![install_platform, Platform::NoArch];

    let repodata_start = std::time::Instant::now();
    const MAX_RETRIES: u32 = 3;
    const INITIAL_DELAY_MS: u64 = 1000;

    let mut last_error = None;
    let mut repo_data = None;

    for attempt in 0..MAX_RETRIES {
        if attempt > 0 {
            let delay_ms = INITIAL_DELAY_MS * (1 << (attempt - 1));
            info!(
                "Retrying repodata fetch (attempt {}/{}) after {}ms...",
                attempt + 1,
                MAX_RETRIES,
                delay_ms
            );
            tokio::time::sleep(tokio::time::Duration::from_millis(delay_ms)).await;
        }

        match gateway
            .query(channels.clone(), platforms.clone(), specs.clone())
            .recursive(true)
            .await
        {
            Ok(data) => {
                repo_data = Some(data);
                break;
            }
            Err(e) => {
                let error_str = e.to_string();
                let is_retryable = error_str.contains("500")
                    || error_str.contains("502")
                    || error_str.contains("503")
                    || error_str.contains("504")
                    || error_str.contains("timeout")
                    || error_str.contains("connection");

                if is_retryable && attempt < MAX_RETRIES - 1 {
                    info!(
                        "Transient error fetching repodata (attempt {}): {}",
                        attempt + 1,
                        error_str
                    );
                    last_error = Some(e);
                    continue;
                }
                emit_progress(app, EnvProgressPhase::Error {
                    message: format!("Failed to fetch package metadata: {}", e),
                });
                return Err(anyhow!("Failed to fetch package metadata: {}", e));
            }
        }
    }

    let repo_data = repo_data.ok_or_else(|| {
        let msg = format!(
            "Failed to fetch package metadata after {} retries: {}",
            MAX_RETRIES,
            last_error.map(|e| e.to_string()).unwrap_or_else(|| "unknown error".to_string())
        );
        emit_progress(app, EnvProgressPhase::Error { message: msg.clone() });
        anyhow!(msg)
    })?;

    let repodata_elapsed = repodata_start.elapsed();
    let record_count: usize = repo_data.iter().map(|r| r.len()).sum();
    info!(
        "Fetched repodata with {} records in {:?}",
        record_count, repodata_elapsed
    );
    emit_progress(app, EnvProgressPhase::RepodataComplete {
        record_count,
        elapsed_ms: repodata_elapsed.as_millis() as u64,
    });

    // Detect virtual packages
    let virtual_packages = rattler_virtual_packages::VirtualPackage::detect(
        &rattler_virtual_packages::VirtualPackageOverrides::default(),
    )?
    .iter()
    .map(|vpkg| GenericVirtualPackage::from(vpkg.clone()))
    .collect::<Vec<_>>();

    // Solve dependencies
    let solve_start = std::time::Instant::now();
    info!("Solving dependencies for {} specs", specs.len());

    let solver_task = SolverTask {
        virtual_packages,
        specs,
        ..SolverTask::from_iter(&repo_data)
    };

    let solver_result = match resolvo::Solver.solve(solver_task) {
        Ok(result) => result,
        Err(e) => {
            let msg = format!("Failed to solve dependencies: {}", e);
            emit_progress(app, EnvProgressPhase::Error { message: msg.clone() });
            return Err(anyhow!(msg));
        }
    };

    let required_packages = solver_result.records;
    let solve_elapsed = solve_start.elapsed();
    info!(
        "Solved {} packages in {:?}",
        required_packages.len(),
        solve_elapsed
    );
    emit_progress(app, EnvProgressPhase::SolveComplete {
        package_count: required_packages.len(),
        elapsed_ms: solve_elapsed.as_millis() as u64,
    });

    // Install packages
    let install_start = std::time::Instant::now();
    info!(
        "Installing {} packages to {:?}",
        required_packages.len(),
        env_path
    );
    emit_progress(app, EnvProgressPhase::Installing {
        total: required_packages.len(),
    });

    // Create progress reporter if we have an app handle
    let reporter = app.map(|a| ProgressReporter::new(Some(a.clone())));

    let installer = Installer::new()
        .with_download_client(download_client)
        .with_target_platform(install_platform);

    let _result = if let Some(reporter) = reporter {
        installer
            .with_reporter(reporter)
            .install(env_path, required_packages)
            .await?
    } else {
        installer.install(env_path, required_packages).await?
    };

    let install_elapsed = install_start.elapsed();
    info!(
        "Conda environment ready at {:?} (install took {:?})",
        env_path,
        install_elapsed
    );
    emit_progress(app, EnvProgressPhase::InstallComplete {
        elapsed_ms: install_elapsed.as_millis() as u64,
    });

    Ok(())
}

/// Claim a prewarmed conda environment for a specific notebook.
///
/// This moves the prewarmed environment to the correct cache location based
/// on the notebook's `env_id`, so it will be found by `prepare_environment` later.
pub async fn claim_prewarmed_conda_environment(
    prewarmed: CondaEnvironment,
    env_id: &str,
) -> Result<CondaEnvironment> {
    // Compute the hash that would be used for empty deps with this env_id
    let deps = CondaDependencies {
        dependencies: vec!["ipykernel".to_string()],
        channels: vec!["conda-forge".to_string()],
        python: None,
        env_id: Some(env_id.to_string()),
    };
    let hash = compute_env_hash(&deps);
    let cache_dir = get_cache_dir();
    let dest_path = cache_dir.join(&hash);

    // Determine python path based on platform
    #[cfg(target_os = "windows")]
    let python_path = dest_path.join("python.exe");
    #[cfg(not(target_os = "windows"))]
    let python_path = dest_path.join("bin").join("python");

    // If destination already exists, just use it (race condition safety)
    if dest_path.exists() {
        info!(
            "[prewarm] Destination already exists, removing prewarmed conda env at {:?}",
            prewarmed.env_path
        );
        tokio::fs::remove_dir_all(&prewarmed.env_path).await.ok();
        return Ok(CondaEnvironment {
            env_path: dest_path,
            python_path,
        });
    }

    info!(
        "[prewarm] Claiming prewarmed conda environment: {:?} -> {:?}",
        prewarmed.env_path, dest_path
    );

    // Try to rename (fast if same filesystem)
    match tokio::fs::rename(&prewarmed.env_path, &dest_path).await {
        Ok(()) => {
            info!("[prewarm] Conda environment claimed via rename");
        }
        Err(e) => {
            // Rename failed (possibly cross-filesystem), fall back to copy+delete
            info!(
                "[prewarm] Rename failed ({}), falling back to copy",
                e
            );
            copy_dir_recursive(&prewarmed.env_path, &dest_path).await?;
            tokio::fs::remove_dir_all(&prewarmed.env_path).await.ok();
            info!("[prewarm] Conda environment claimed via copy");
        }
    }

    Ok(CondaEnvironment {
        env_path: dest_path,
        python_path,
    })
}

/// Recursively copy a directory, preserving symlinks.
async fn copy_dir_recursive(src: &std::path::Path, dst: &std::path::Path) -> Result<()> {
    tokio::fs::create_dir_all(dst).await?;

    let mut entries = tokio::fs::read_dir(src).await?;
    while let Some(entry) = entries.next_entry().await? {
        let ty = entry.file_type().await?;
        let src_path = entry.path();
        let dst_path = dst.join(entry.file_name());

        if ty.is_dir() {
            Box::pin(copy_dir_recursive(&src_path, &dst_path)).await?;
        } else if ty.is_symlink() {
            // Preserve symlinks (important for conda env bin/ structure)
            #[cfg(unix)]
            {
                let link_target = tokio::fs::read_link(&src_path).await?;
                tokio::fs::symlink(&link_target, &dst_path).await?;
            }
            #[cfg(windows)]
            tokio::fs::copy(&src_path, &dst_path).await?;
        } else {
            tokio::fs::copy(&src_path, &dst_path).await?;
        }
    }

    Ok(())
}

/// Find existing prewarmed conda environments from previous sessions.
///
/// Scans the cache directory for `prewarm-*` directories and validates
/// they have a working Python binary. Returns valid environments that
/// can be added to the pool on startup.
pub async fn find_existing_prewarmed_conda_environments() -> Vec<CondaEnvironment> {
    let cache_dir = get_cache_dir();
    let mut found = Vec::new();

    let Ok(mut entries) = tokio::fs::read_dir(&cache_dir).await else {
        return found;
    };

    while let Ok(Some(entry)) = entries.next_entry().await {
        let name = entry.file_name().to_string_lossy().to_string();
        if !name.starts_with("prewarm-") {
            continue;
        }

        let env_path = entry.path();

        // Determine python path based on platform
        #[cfg(target_os = "windows")]
        let python_path = env_path.join("python.exe");
        #[cfg(not(target_os = "windows"))]
        let python_path = env_path.join("bin").join("python");

        // Validate Python exists
        if !python_path.exists() {
            info!(
                "[prewarm] Skipping invalid conda env (no python): {:?}",
                env_path
            );
            // Clean up invalid environment
            tokio::fs::remove_dir_all(&env_path).await.ok();
            continue;
        }

        info!("[prewarm] Found existing prewarmed conda environment: {:?}", env_path);
        found.push(CondaEnvironment {
            env_path,
            python_path,
        });
    }

    found
}

/// Check if a conda environment has been warmed up.
///
/// Looks for a `.warmed` marker file in the environment directory.
pub fn is_environment_warmed(env: &CondaEnvironment) -> bool {
    env.env_path.join(".warmed").exists()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_compute_env_hash_stable() {
        let deps = CondaDependencies {
            dependencies: vec!["pandas".to_string(), "numpy".to_string()],
            channels: vec!["conda-forge".to_string()],
            python: Some("3.11".to_string()),
            env_id: Some("test-env-id".to_string()),
        };

        let hash1 = compute_env_hash(&deps);
        let hash2 = compute_env_hash(&deps);

        assert_eq!(hash1, hash2);
    }

    #[test]
    fn test_compute_env_hash_order_independent() {
        let deps1 = CondaDependencies {
            dependencies: vec!["pandas".to_string(), "numpy".to_string()],
            channels: vec![],
            python: None,
            env_id: Some("test-env-1".to_string()),
        };

        let deps2 = CondaDependencies {
            dependencies: vec!["numpy".to_string(), "pandas".to_string()],
            channels: vec![],
            python: None,
            env_id: Some("test-env-1".to_string()),
        };

        assert_eq!(compute_env_hash(&deps1), compute_env_hash(&deps2));
    }

    #[test]
    fn test_compute_env_hash_different_deps() {
        let deps1 = CondaDependencies {
            dependencies: vec!["pandas".to_string()],
            channels: vec![],
            python: None,
            env_id: Some("test-env-1".to_string()),
        };

        let deps2 = CondaDependencies {
            dependencies: vec!["numpy".to_string()],
            channels: vec![],
            python: None,
            env_id: Some("test-env-1".to_string()),
        };

        assert_ne!(compute_env_hash(&deps1), compute_env_hash(&deps2));
    }

    #[test]
    fn test_compute_env_hash_includes_channels() {
        let deps1 = CondaDependencies {
            dependencies: vec!["numpy".to_string()],
            channels: vec!["conda-forge".to_string()],
            python: None,
            env_id: Some("test-env-1".to_string()),
        };

        let deps2 = CondaDependencies {
            dependencies: vec!["numpy".to_string()],
            channels: vec!["defaults".to_string()],
            python: None,
            env_id: Some("test-env-1".to_string()),
        };

        assert_ne!(compute_env_hash(&deps1), compute_env_hash(&deps2));
    }

    #[test]
    fn test_compute_env_hash_different_env_id() {
        let deps1 = CondaDependencies {
            dependencies: vec!["numpy".to_string()],
            channels: vec!["conda-forge".to_string()],
            python: None,
            env_id: Some("notebook-1".to_string()),
        };

        let deps2 = CondaDependencies {
            dependencies: vec!["numpy".to_string()],
            channels: vec!["conda-forge".to_string()],
            python: None,
            env_id: Some("notebook-2".to_string()),
        };

        // Different env_ids should produce different hashes (isolated environments)
        assert_ne!(compute_env_hash(&deps1), compute_env_hash(&deps2));
    }
}
