//! Environment pool for prewarming UV environments.
//!
//! This module manages a pool of pre-created Python virtual environments
//! (with just ipykernel installed) that can be instantly assigned to new
//! notebooks, avoiding the delay of environment creation on first kernel start.

use crate::uv_env::UvEnvironment;
use log::{error, info, warn};
use serde::Serialize;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};
use tokio::sync::Mutex;

/// A prewarmed environment ready for assignment to a notebook.
#[derive(Debug, Clone)]
pub struct PrewarmedEnv {
    /// Path to the virtual environment directory.
    pub venv_path: PathBuf,
    /// Path to the Python executable within the venv.
    pub python_path: PathBuf,
    /// When this environment was created.
    pub created_at: Instant,
}

impl PrewarmedEnv {
    /// Convert to a UvEnvironment for kernel startup.
    pub fn into_uv_environment(self) -> UvEnvironment {
        UvEnvironment {
            venv_path: self.venv_path,
            python_path: self.python_path,
        }
    }

    /// Create from a daemon's PooledEnv.
    pub fn from_pooled_env(env: runtimed::PooledEnv) -> Self {
        Self {
            venv_path: env.venv_path,
            python_path: env.python_path,
            created_at: Instant::now(),
        }
    }
}

/// Try to take a UV environment from the daemon first, falling back to in-process pool.
///
/// This provides a seamless integration where:
/// 1. If daemon is running and has envs, use them (fast, shared across windows)
/// 2. If daemon unavailable or empty, use in-process pool (local fallback)
pub async fn take_uv_env(pool: &SharedEnvPool) -> Option<PrewarmedEnv> {
    // Try daemon first (non-blocking, fast timeout)
    if let Some(env) = runtimed::client::try_get_pooled_env(runtimed::EnvType::Uv).await {
        info!("[prewarm:uv] Got environment from daemon");
        return Some(PrewarmedEnv::from_pooled_env(env));
    }

    // Fall back to in-process pool
    let result = pool.lock().await.take();
    if result.is_some() {
        info!("[prewarm:uv] Got environment from in-process pool");
    }
    result
}

/// Try to take a Conda environment from the daemon first, falling back to in-process pool.
pub async fn take_conda_env(pool: &SharedCondaEnvPool) -> Option<PrewarmedCondaEnv> {
    // Try daemon first
    if let Some(env) = runtimed::client::try_get_pooled_env(runtimed::EnvType::Conda).await {
        info!("[prewarm:conda] Got environment from daemon");
        return Some(PrewarmedCondaEnv::from_pooled_env(env));
    }

    // Fall back to in-process pool
    let result = pool.lock().await.take();
    if result.is_some() {
        info!("[prewarm:conda] Got environment from in-process pool");
    }
    result
}

/// Configuration for the environment pool.
#[derive(Debug, Clone)]
pub struct PoolConfig {
    /// Target number of prewarmed UV environments to maintain.
    pub pool_size: usize,
    /// Maximum age (in seconds) before an environment is considered stale.
    pub max_age_secs: u64,
}

impl Default for PoolConfig {
    fn default() -> Self {
        Self {
            pool_size: 3,
            max_age_secs: 172800, // 2 days (ipykernel doesn't change often)
        }
    }
}

/// State of the prewarming pool.
pub struct EnvPool {
    /// Available prewarmed environments.
    pool: Vec<PrewarmedEnv>,
    /// Configuration.
    config: PoolConfig,
    /// Number of environments currently being created.
    creating: usize,
}

/// Shared pool type for Tauri state management.
pub type SharedEnvPool = Arc<Mutex<EnvPool>>;

/// Current status of the pool for debugging/UI.
#[derive(Debug, Clone, Serialize)]
pub struct PoolStatus {
    /// Number of environments ready to use.
    pub available: usize,
    /// Number of environments currently being created.
    pub creating: usize,
    /// Target pool size.
    pub target: usize,
}

/// Progress events emitted during prewarming.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "phase", rename_all = "snake_case")]
pub enum PrewarmProgress {
    /// Starting the prewarming loop.
    Starting,
    /// Creating environments.
    Creating { current: usize, target: usize },
    /// Pool is ready.
    Ready { pool_size: usize },
    /// Error during prewarming.
    Error { message: String },
}

impl EnvPool {
    /// Create a new environment pool with the given configuration.
    pub fn new(config: PoolConfig) -> Self {
        Self {
            pool: Vec::with_capacity(config.pool_size),
            config,
            creating: 0,
        }
    }

    /// Take a prewarmed environment from the pool.
    ///
    /// Returns `None` if no environments are available.
    /// Automatically prunes stale environments before returning.
    pub fn take(&mut self) -> Option<PrewarmedEnv> {
        self.prune_stale();
        let result = self.pool.pop();

        if result.is_some() {
            info!(
                "[prewarm:uv] Pool HIT - took env (remaining: {})",
                self.pool.len()
            );
        } else {
            info!(
                "[prewarm:uv] Pool MISS - no env available (available: {}, creating: {}, target: {})",
                self.pool.len(),
                self.creating,
                self.config.pool_size
            );
        }

        result
    }

    /// Add a newly created prewarmed environment to the pool.
    pub fn add(&mut self, env: PrewarmedEnv) {
        self.pool.push(env);
        self.creating = self.creating.saturating_sub(1);
    }

    /// Mark that environment creation failed.
    pub fn creation_failed(&mut self) {
        self.creating = self.creating.saturating_sub(1);
    }

    /// Calculate how many environments need to be created to reach the target.
    pub fn deficit(&self) -> usize {
        let current = self.pool.len() + self.creating;
        self.config.pool_size.saturating_sub(current)
    }

    /// Mark that we're starting to create N environments.
    pub fn mark_creating(&mut self, count: usize) {
        self.creating += count;
    }

    /// Remove environments that are older than the maximum age.
    fn prune_stale(&mut self) {
        let max_age = Duration::from_secs(self.config.max_age_secs);
        let before = self.pool.len();
        self.pool.retain(|e| e.created_at.elapsed() < max_age);
        let removed = before - self.pool.len();
        if removed > 0 {
            info!("[prewarm] Pruned {} stale environments", removed);
        }
    }

    /// Get the current status of the pool.
    pub fn status(&self) -> PoolStatus {
        PoolStatus {
            available: self.pool.len(),
            creating: self.creating,
            target: self.config.pool_size,
        }
    }
}

/// Spawn a background task to replenish the pool after taking an environment.
///
/// Call this after successfully using a prewarmed environment to immediately
/// start creating a replacement, rather than waiting for the next loop iteration.
pub fn spawn_replenishment(pool: SharedEnvPool) {
    tokio::spawn(async move {
        // Check if we actually need to create one
        let should_create = {
            let mut p = pool.lock().await;
            if p.deficit() > 0 {
                p.mark_creating(1);
                true
            } else {
                false
            }
        };

        if !should_create {
            return;
        }

        info!("[prewarm] Spawning immediate replenishment");
        match crate::uv_env::create_prewarmed_environment().await {
            Ok(env) => {
                let prewarmed = PrewarmedEnv {
                    venv_path: env.venv_path,
                    python_path: env.python_path,
                    created_at: Instant::now(),
                };
                pool.lock().await.add(prewarmed);
                info!("[prewarm] Replenishment complete");
            }
            Err(e) => {
                error!("[prewarm] Replenishment failed: {}", e);
                pool.lock().await.creation_failed();
            }
        }
    });
}

/// Recover any existing prewarmed environments from disk.
///
/// This scans the cache directory for `prewarm-*` directories left over
/// from previous sessions and adds valid ones to the pool. This allows
/// the pool to start with environments already available, providing
/// instant kernel startup even on first notebook open after app launch.
///
/// Returns the number of environments recovered.
pub async fn recover_existing_prewarmed(pool: &SharedEnvPool) -> usize {
    let recovered = crate::uv_env::find_existing_prewarmed_environments().await;

    if recovered.is_empty() {
        info!("[prewarm:uv] No existing prewarmed environments found");
        return 0;
    }

    info!(
        "[prewarm:uv] Recovered {} existing prewarmed environments",
        recovered.len()
    );

    let mut added = 0;
    let mut p = pool.lock().await;
    for env in recovered {
        // Only add up to the pool size
        if p.pool.len() >= p.config.pool_size {
            // Clean up extras we don't need
            info!(
                "[prewarm:uv] Pool full, removing extra prewarmed env: {:?}",
                env.venv_path
            );
            tokio::fs::remove_dir_all(&env.venv_path).await.ok();
            continue;
        }

        // Only add environments that have been fully warmed
        // Unwarmed environments are from incomplete creation (e.g., crash during warmup)
        // and will be recreated fresh by the prewarming loop
        if !crate::uv_env::is_environment_warmed(&env) {
            info!(
                "[prewarm:uv] Skipping unwarmed env (will be recreated): {:?}",
                env.venv_path
            );
            tokio::fs::remove_dir_all(&env.venv_path).await.ok();
            continue;
        }

        let prewarmed = PrewarmedEnv {
            venv_path: env.venv_path,
            python_path: env.python_path,
            created_at: Instant::now(), // Treat as freshly created
        };
        p.pool.push(prewarmed);
        added += 1;
    }

    info!(
        "[prewarm:uv] Pool initialized with {} environments",
        p.pool.len()
    );
    added
}

use std::sync::atomic::{AtomicBool, Ordering};

/// Run the background prewarming loop.
///
/// This function runs indefinitely, periodically checking the pool
/// and creating new environments as needed to maintain the target size.
///
/// The `recovery_complete` flag is set after recovery finishes, allowing
/// other tasks (like auto-launch) to wait for recovery before proceeding.
pub async fn run_prewarming_loop(
    pool: SharedEnvPool,
    app: AppHandle,
    recovery_complete: Arc<AtomicBool>,
) {
    // First, recover any existing prewarmed environments from disk
    let recovered = recover_existing_prewarmed(&pool).await;
    info!(
        "[prewarm:uv] Recovery complete: {} envs recovered",
        recovered
    );
    recovery_complete.store(true, Ordering::SeqCst);

    // Check if uv is available before attempting to create environments
    if !crate::uv_env::check_uv_available().await {
        warn!("[prewarm:uv] uv is not installed - skipping environment prewarming");
        emit_progress(&app, PrewarmProgress::Ready { pool_size: 0 });
        return;
    }

    // Small delay to let the app finish startup before creating new envs
    tokio::time::sleep(Duration::from_millis(500)).await;

    info!("[prewarm:uv] Starting prewarming loop");
    emit_progress(&app, PrewarmProgress::Starting);

    loop {
        // Check what needs to be created
        let deficit = {
            let mut p = pool.lock().await;
            let d = p.deficit();
            if d > 0 {
                p.mark_creating(d);
            }
            d
        };

        if deficit > 0 {
            info!("[prewarm] Creating {} UV environments", deficit);
            emit_progress(
                &app,
                PrewarmProgress::Creating {
                    current: 0,
                    target: deficit,
                },
            );

            // Create environments in parallel
            let mut handles = Vec::with_capacity(deficit);
            for _ in 0..deficit {
                let pool_clone = pool.clone();
                handles.push(tokio::spawn(async move {
                    match crate::uv_env::create_prewarmed_environment().await {
                        Ok(env) => {
                            let prewarmed = PrewarmedEnv {
                                venv_path: env.venv_path,
                                python_path: env.python_path,
                                created_at: Instant::now(),
                            };
                            pool_clone.lock().await.add(prewarmed);
                            info!("[prewarm] Created prewarmed environment");
                            Ok(())
                        }
                        Err(e) => {
                            error!("[prewarm] Failed to create environment: {}", e);
                            pool_clone.lock().await.creation_failed();
                            Err(e)
                        }
                    }
                }));
            }

            // Wait for all creations to complete
            futures::future::join_all(handles).await;
        }

        // Emit ready status
        {
            let p = pool.lock().await;
            let status = p.status();
            emit_progress(
                &app,
                PrewarmProgress::Ready {
                    pool_size: status.available,
                },
            );
            info!(
                "[prewarm] Pool status: {}/{} ready, {} creating",
                status.available, status.target, status.creating
            );
        }

        // Sleep before next check
        tokio::time::sleep(Duration::from_secs(30)).await;
    }
}

fn emit_progress(app: &AppHandle, progress: PrewarmProgress) {
    if let Err(e) = app.emit("prewarm:progress", &progress) {
        error!("[prewarm] Failed to emit progress: {}", e);
    }
}

// =============================================================================
// Conda environment pool
// =============================================================================

use crate::conda_env::CondaEnvironment;

/// A prewarmed conda environment ready for assignment to a notebook.
#[derive(Debug, Clone)]
pub struct PrewarmedCondaEnv {
    /// Path to the conda environment directory.
    pub env_path: PathBuf,
    /// Path to the Python executable within the env.
    pub python_path: PathBuf,
    /// When this environment was created.
    pub created_at: Instant,
}

impl PrewarmedCondaEnv {
    /// Convert to a CondaEnvironment for kernel startup.
    pub fn into_conda_environment(self) -> CondaEnvironment {
        CondaEnvironment {
            env_path: self.env_path,
            python_path: self.python_path,
        }
    }

    /// Create from a daemon's PooledEnv.
    pub fn from_pooled_env(env: runtimed::PooledEnv) -> Self {
        Self {
            env_path: env.venv_path, // daemon uses venv_path for both uv and conda
            python_path: env.python_path,
            created_at: Instant::now(),
        }
    }
}

/// State of the conda prewarming pool.
pub struct CondaEnvPool {
    /// Available prewarmed conda environments.
    pool: Vec<PrewarmedCondaEnv>,
    /// Configuration.
    config: PoolConfig,
    /// Number of environments currently being created.
    creating: usize,
}

/// Shared conda pool type for Tauri state management.
pub type SharedCondaEnvPool = Arc<Mutex<CondaEnvPool>>;

/// Current status of the conda pool for debugging/UI.
#[derive(Debug, Clone, Serialize)]
pub struct CondaPoolStatus {
    /// Number of conda environments ready to use.
    pub available: usize,
    /// Number of conda environments currently being created.
    pub creating: usize,
    /// Target pool size.
    pub target: usize,
}

impl CondaEnvPool {
    /// Create a new conda environment pool with the given configuration.
    pub fn new(config: PoolConfig) -> Self {
        Self {
            pool: Vec::with_capacity(config.pool_size),
            config,
            creating: 0,
        }
    }

    /// Take a prewarmed conda environment from the pool.
    ///
    /// Returns `None` if no environments are available.
    /// Automatically prunes stale environments before returning.
    pub fn take(&mut self) -> Option<PrewarmedCondaEnv> {
        self.prune_stale();
        let result = self.pool.pop();

        if result.is_some() {
            info!(
                "[prewarm:conda] Pool HIT - took env (remaining: {})",
                self.pool.len()
            );
        } else {
            info!(
                "[prewarm:conda] Pool MISS - no env available (available: {}, creating: {}, target: {})",
                self.pool.len(),
                self.creating,
                self.config.pool_size
            );
        }

        result
    }

    /// Add a newly created prewarmed conda environment to the pool.
    pub fn add(&mut self, env: PrewarmedCondaEnv) {
        self.pool.push(env);
        self.creating = self.creating.saturating_sub(1);
    }

    /// Mark that environment creation failed.
    pub fn creation_failed(&mut self) {
        self.creating = self.creating.saturating_sub(1);
    }

    /// Calculate how many environments need to be created to reach the target.
    pub fn deficit(&self) -> usize {
        let current = self.pool.len() + self.creating;
        self.config.pool_size.saturating_sub(current)
    }

    /// Mark that we're starting to create N environments.
    pub fn mark_creating(&mut self, count: usize) {
        self.creating += count;
    }

    /// Remove environments that are older than the maximum age.
    fn prune_stale(&mut self) {
        let max_age = Duration::from_secs(self.config.max_age_secs);
        let before = self.pool.len();
        self.pool.retain(|e| e.created_at.elapsed() < max_age);
        let removed = before - self.pool.len();
        if removed > 0 {
            info!("[prewarm] Pruned {} stale conda environments", removed);
        }
    }

    /// Get the current status of the pool.
    pub fn status(&self) -> CondaPoolStatus {
        CondaPoolStatus {
            available: self.pool.len(),
            creating: self.creating,
            target: self.config.pool_size,
        }
    }
}

/// Spawn a background task to replenish the conda pool after taking an environment.
pub fn spawn_conda_replenishment(pool: SharedCondaEnvPool) {
    tokio::spawn(async move {
        // Check if we actually need to create one
        let should_create = {
            let mut p = pool.lock().await;
            if p.deficit() > 0 {
                p.mark_creating(1);
                true
            } else {
                false
            }
        };

        if !should_create {
            return;
        }

        info!("[prewarm] Spawning immediate conda replenishment");
        match crate::conda_env::create_prewarmed_conda_environment(None).await {
            Ok(env) => {
                let prewarmed = PrewarmedCondaEnv {
                    env_path: env.env_path,
                    python_path: env.python_path,
                    created_at: Instant::now(),
                };
                pool.lock().await.add(prewarmed);
                info!("[prewarm] Conda replenishment complete");
            }
            Err(e) => {
                error!("[prewarm] Conda replenishment failed: {}", e);
                pool.lock().await.creation_failed();
            }
        }
    });
}

/// Recover any existing prewarmed conda environments from disk.
///
/// Returns the number of environments recovered.
/// Only fully warmed environments are added to the pool. Unwarmed environments
/// (from incomplete creation or crashes) are skipped and cleaned up.
pub async fn recover_existing_prewarmed_conda(pool: &SharedCondaEnvPool) -> usize {
    let recovered = crate::conda_env::find_existing_prewarmed_conda_environments().await;

    if recovered.is_empty() {
        info!("[prewarm:conda] No existing prewarmed conda environments found");
        return 0;
    }

    info!(
        "[prewarm:conda] Recovered {} existing prewarmed conda environments",
        recovered.len()
    );

    let mut added = 0;
    let mut p = pool.lock().await;

    for env in recovered {
        // Only add up to the pool size
        if p.pool.len() >= p.config.pool_size {
            // Clean up extras we don't need
            info!(
                "[prewarm:conda] Conda pool full, removing extra prewarmed env: {:?}",
                env.env_path
            );
            tokio::fs::remove_dir_all(&env.env_path).await.ok();
            continue;
        }

        // Only add environments that have been fully warmed
        // Unwarmed environments are from incomplete creation (e.g., crash during warmup)
        // and will be recreated fresh by the prewarming loop
        if !crate::conda_env::is_environment_warmed(&env) {
            info!(
                "[prewarm:conda] Skipping unwarmed env (will be recreated): {:?}",
                env.env_path
            );
            tokio::fs::remove_dir_all(&env.env_path).await.ok();
            continue;
        }

        let prewarmed = PrewarmedCondaEnv {
            env_path: env.env_path,
            python_path: env.python_path,
            created_at: Instant::now(), // Treat as freshly created
        };
        p.pool.push(prewarmed);
        added += 1;
    }

    info!(
        "[prewarm:conda] Conda pool initialized with {} environments",
        added
    );
    added
}

/// Run the background conda prewarming loop.
///
/// This function runs indefinitely, periodically checking the pool
/// and creating new environments as needed to maintain the target size.
///
/// The `recovery_complete` flag is set after recovery finishes, allowing
/// other tasks (like auto-launch) to wait for recovery before proceeding.
pub async fn run_conda_prewarming_loop(
    pool: SharedCondaEnvPool,
    recovery_complete: Arc<AtomicBool>,
) {
    // First, recover any existing prewarmed environments from disk
    let recovered = recover_existing_prewarmed_conda(&pool).await;
    info!(
        "[prewarm:conda] Recovery complete: {} envs recovered",
        recovered
    );
    recovery_complete.store(true, Ordering::SeqCst);

    // Small delay to let the app finish startup before creating new envs
    tokio::time::sleep(Duration::from_millis(500)).await;

    info!("[prewarm:conda] Starting conda prewarming loop");

    loop {
        // Check what needs to be created
        let deficit = {
            let mut p = pool.lock().await;
            let d = p.deficit();
            if d > 0 {
                p.mark_creating(d);
            }
            d
        };

        if deficit > 0 {
            info!("[prewarm] Creating {} conda environments", deficit);

            // Create environments sequentially (conda/rattler is resource-intensive)
            for i in 0..deficit {
                info!("[prewarm] Creating conda env {}/{}", i + 1, deficit);
                match crate::conda_env::create_prewarmed_conda_environment(None).await {
                    Ok(env) => {
                        let prewarmed = PrewarmedCondaEnv {
                            env_path: env.env_path,
                            python_path: env.python_path,
                            created_at: Instant::now(),
                        };
                        pool.lock().await.add(prewarmed);
                        info!("[prewarm] Created prewarmed conda environment");
                    }
                    Err(e) => {
                        error!("[prewarm] Failed to create conda environment: {}", e);
                        pool.lock().await.creation_failed();
                    }
                }
            }
        }

        // Log status
        {
            let p = pool.lock().await;
            let status = p.status();
            info!(
                "[prewarm] Conda pool status: {}/{} ready, {} creating",
                status.available, status.target, status.creating
            );
        }

        // Sleep before next check (longer interval for conda since it's expensive)
        tokio::time::sleep(Duration::from_secs(60)).await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_pool_deficit() {
        let config = PoolConfig {
            pool_size: 3,
            max_age_secs: 3600,
        };
        let pool = EnvPool::new(config);
        assert_eq!(pool.deficit(), 3);
    }

    #[test]
    fn test_pool_take_and_add() {
        let config = PoolConfig {
            pool_size: 3,
            max_age_secs: 3600,
        };
        let mut pool = EnvPool::new(config);

        // Add an env
        let env = PrewarmedEnv {
            venv_path: PathBuf::from("/test/path"),
            python_path: PathBuf::from("/test/path/bin/python"),
            created_at: Instant::now(),
        };
        pool.creating = 1; // Simulate marking as creating
        pool.add(env);

        assert_eq!(pool.status().available, 1);
        assert_eq!(pool.deficit(), 2);

        // Take it back
        let taken = pool.take();
        assert!(taken.is_some());
        assert_eq!(pool.status().available, 0);
        assert_eq!(pool.deficit(), 3);
    }

    #[test]
    fn test_pool_mark_creating() {
        let config = PoolConfig {
            pool_size: 3,
            max_age_secs: 3600,
        };
        let mut pool = EnvPool::new(config);

        pool.mark_creating(2);
        assert_eq!(pool.deficit(), 1);
        assert_eq!(pool.status().creating, 2);
    }

    #[test]
    fn test_pool_prune_stale() {
        let config = PoolConfig {
            pool_size: 3,
            max_age_secs: 0, // Everything is immediately stale
        };
        let mut pool = EnvPool::new(config);

        // Add an env
        let env = PrewarmedEnv {
            venv_path: PathBuf::from("/test/path"),
            python_path: PathBuf::from("/test/path/bin/python"),
            created_at: Instant::now(),
        };
        pool.pool.push(env); // Direct push to avoid creating count

        // It should be pruned when we take
        let taken = pool.take();
        assert!(taken.is_none());
    }
}
