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

/// Dependencies extracted from notebook metadata (conda format).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CondaDependencies {
    pub dependencies: Vec<String>,
    #[serde(default)]
    pub channels: Vec<String>,
    pub python: Option<String>,
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
pub async fn prepare_environment(deps: &CondaDependencies) -> Result<CondaEnvironment> {
    let hash = compute_env_hash(deps);
    let cache_dir = get_cache_dir();
    let env_path = cache_dir.join(&hash);

    // Determine python path based on platform
    #[cfg(target_os = "windows")]
    let python_path = env_path.join("python.exe");
    #[cfg(not(target_os = "windows"))]
    let python_path = env_path.join("bin").join("python");

    // Check if cached environment exists and is valid
    if env_path.exists() && python_path.exists() {
        info!("Using cached conda environment at {:?}", env_path);
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
    let download_client = reqwest::Client::builder()
        .no_gzip()
        .build()?;

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

    // Query repodata from channels
    info!("Fetching repodata from channels: {:?}", channels);
    let repo_data = gateway
        .query(channels, platforms.clone(), specs.clone())
        .recursive(true)
        .await?;

    let total_records: usize = repo_data.iter().map(|r| r.len()).sum();
    info!("Loaded {} package records", total_records);

    // Detect virtual packages (system capabilities like __glibc, __cuda, etc.)
    let virtual_packages = rattler_virtual_packages::VirtualPackage::detect(
        &rattler_virtual_packages::VirtualPackageOverrides::default(),
    )?
    .iter()
    .map(|vpkg| GenericVirtualPackage::from(vpkg.clone()))
    .collect::<Vec<_>>();

    info!("Detected {} virtual packages", virtual_packages.len());

    // Solve dependencies
    info!("Solving dependencies...");
    let solver_task = SolverTask {
        virtual_packages,
        specs,
        ..SolverTask::from_iter(&repo_data)
    };

    let solver_result = resolvo::Solver.solve(solver_task)?;
    let required_packages = solver_result.records;

    info!("Solved: {} packages to install", required_packages.len());

    // Install packages to the environment prefix
    info!("Installing packages to {:?}", env_path);
    let _result = Installer::new()
        .with_download_client(download_client)
        .with_target_platform(install_platform)
        .install(&env_path, required_packages)
        .await?;

    info!("Conda environment ready at {:?}", env_path);

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
    let download_client = reqwest::Client::builder().no_gzip().build()?;
    let download_client = reqwest_middleware::ClientBuilder::new(download_client).build();

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

    let repo_data = gateway
        .query(channels, platforms.clone(), specs.clone())
        .recursive(true)
        .await?;

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
        };

        let deps2 = CondaDependencies {
            dependencies: vec!["numpy".to_string(), "pandas".to_string()],
            channels: vec![],
            python: None,
        };

        assert_eq!(compute_env_hash(&deps1), compute_env_hash(&deps2));
    }

    #[test]
    fn test_compute_env_hash_different_deps() {
        let deps1 = CondaDependencies {
            dependencies: vec!["pandas".to_string()],
            channels: vec![],
            python: None,
        };

        let deps2 = CondaDependencies {
            dependencies: vec!["numpy".to_string()],
            channels: vec![],
            python: None,
        };

        assert_ne!(compute_env_hash(&deps1), compute_env_hash(&deps2));
    }

    #[test]
    fn test_compute_env_hash_includes_channels() {
        let deps1 = CondaDependencies {
            dependencies: vec!["numpy".to_string()],
            channels: vec!["conda-forge".to_string()],
            python: None,
        };

        let deps2 = CondaDependencies {
            dependencies: vec!["numpy".to_string()],
            channels: vec!["defaults".to_string()],
            python: None,
        };

        assert_ne!(compute_env_hash(&deps1), compute_env_hash(&deps2));
    }
}
