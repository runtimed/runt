//! Conda-based environment management for notebook dependencies.
//!
//! This module handles creating ephemeral conda environments using `rattler`
//! for notebooks that declare inline dependencies in their metadata.

use anyhow::{anyhow, Result};
use log::info;
use rattler::{
    default_cache_dir,
    install::Installer,
    package_cache::PackageCache,
};
use rattler_conda_types::{
    Channel, ChannelConfig, GenericVirtualPackage, MatchSpec, ParseMatchSpecOptions, Platform,
    PrefixRecord,
};
use rattler_repodata_gateway::Gateway;
use rattler_solve::{resolvo, SolverImpl, SolverTask};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::path::PathBuf;
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
    /// Installing packages
    Installing { total: usize },
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
#[derive(Debug)]
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

    let install_start = Instant::now();
    let _result = match Installer::new()
        .with_download_client(download_client)
        .with_target_platform(install_platform)
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
