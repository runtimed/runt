//! Tool bootstrapping via rattler.
//!
//! This module provides a way to automatically install CLI tools (like `ruff`)
//! from conda-forge on demand. Tools are cached in `~/.cache/runt/tools/`.

use anyhow::{anyhow, Result};
use log::info;
use rattler::{
    default_cache_dir,
    install::Installer,
    package_cache::PackageCache,
};
use rattler_conda_types::{
    Channel, ChannelConfig, GenericVirtualPackage, MatchSpec, ParseMatchSpecOptions, Platform,
};
use rattler_repodata_gateway::Gateway;
use rattler_solve::{resolvo, SolverImpl, SolverTask};
use sha2::{Digest, Sha256};
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::OnceCell;

/// Cache directory for bootstrapped tools.
fn tools_cache_dir() -> PathBuf {
    dirs::cache_dir()
        .unwrap_or_else(|| PathBuf::from("/tmp"))
        .join("runt")
        .join("tools")
}

/// Compute a hash for tool caching.
fn compute_tool_hash(tool_name: &str, version: Option<&str>) -> String {
    let mut hasher = Sha256::new();
    hasher.update(tool_name.as_bytes());
    if let Some(v) = version {
        hasher.update(b"=");
        hasher.update(v.as_bytes());
    }
    // Include platform in hash since binaries are platform-specific
    hasher.update(Platform::current().to_string().as_bytes());
    let hash = hasher.finalize();
    format!("{:x}", hash)[..12].to_string()
}

/// Information about a bootstrapped tool.
#[derive(Debug, Clone)]
pub struct BootstrappedTool {
    /// Path to the tool binary
    pub binary_path: PathBuf,
    /// Path to the environment containing the tool
    pub env_path: PathBuf,
}

/// Bootstrap a tool from conda-forge.
///
/// This installs the tool into a cached environment and returns the path to the binary.
/// If the tool is already cached, returns immediately.
///
/// # Arguments
/// * `tool_name` - Name of the conda package (e.g., "ruff")
/// * `version` - Optional version constraint (e.g., "0.8")
///
/// # Example
/// ```ignore
/// let tool = bootstrap_tool("ruff", None).await?;
/// // Use tool.binary_path to run ruff
/// ```
pub async fn bootstrap_tool(tool_name: &str, version: Option<&str>) -> Result<BootstrappedTool> {
    let hash = compute_tool_hash(tool_name, version);
    let cache_dir = tools_cache_dir();
    let env_path = cache_dir.join(format!("{}-{}", tool_name, hash));

    // Determine binary path based on platform
    #[cfg(target_os = "windows")]
    let binary_path = env_path.join("Scripts").join(format!("{}.exe", tool_name));
    #[cfg(not(target_os = "windows"))]
    let binary_path = env_path.join("bin").join(tool_name);

    // Check if already cached
    if binary_path.exists() {
        info!("Using cached tool {} at {:?}", tool_name, binary_path);
        return Ok(BootstrappedTool {
            binary_path,
            env_path,
        });
    }

    info!("Bootstrapping {} via rattler...", tool_name);

    // Ensure cache directory exists
    tokio::fs::create_dir_all(&cache_dir).await?;

    // Remove partial environment if it exists
    if env_path.exists() {
        tokio::fs::remove_dir_all(&env_path).await?;
    }

    // Setup channel configuration
    let channel_config = ChannelConfig::default_with_root_dir(cache_dir.clone());
    let channel = Channel::from_str("conda-forge", &channel_config)?;

    // Build spec for the tool
    let match_spec_options = ParseMatchSpecOptions::strict();
    let spec_str = match version {
        Some(v) => format!("{}={}", tool_name, v),
        None => tool_name.to_string(),
    };
    let spec = MatchSpec::from_str(&spec_str, match_spec_options)?;

    info!("Resolving {} from conda-forge...", spec_str);

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

    // Query repodata
    let repo_data = gateway
        .query(vec![channel], platforms, vec![spec.clone()])
        .recursive(true)
        .await
        .map_err(|e| anyhow!("Failed to fetch repodata for {}: {}", tool_name, e))?;

    // Detect virtual packages
    let virtual_packages = rattler_virtual_packages::VirtualPackage::detect(
        &rattler_virtual_packages::VirtualPackageOverrides::default(),
    )?
    .iter()
    .map(|vpkg| GenericVirtualPackage::from(vpkg.clone()))
    .collect::<Vec<_>>();

    // Solve dependencies
    let solver_task = SolverTask {
        virtual_packages,
        specs: vec![spec],
        ..SolverTask::from_iter(&repo_data)
    };

    let solver_result = resolvo::Solver
        .solve(solver_task)
        .map_err(|e| anyhow!("Failed to solve {} dependencies: {}", tool_name, e))?;

    let required_packages = solver_result.records;
    info!(
        "Installing {} ({} packages)...",
        tool_name,
        required_packages.len()
    );

    // Install packages
    Installer::new()
        .with_download_client(download_client)
        .with_target_platform(install_platform)
        .install(&env_path, required_packages)
        .await
        .map_err(|e| anyhow!("Failed to install {}: {}", tool_name, e))?;

    // Verify the binary exists
    if !binary_path.exists() {
        return Err(anyhow!(
            "Tool {} was installed but binary not found at {:?}",
            tool_name,
            binary_path
        ));
    }

    info!("Successfully bootstrapped {} at {:?}", tool_name, binary_path);

    Ok(BootstrappedTool {
        binary_path,
        env_path,
    })
}

/// Global cache for the ruff binary path.
/// This avoids repeated lookups once ruff is bootstrapped.
static RUFF_PATH: OnceCell<Arc<Result<PathBuf, String>>> = OnceCell::const_new();

/// Get the path to ruff, bootstrapping it if necessary.
///
/// This function:
/// 1. First checks if ruff is available on PATH (fast path)
/// 2. If not, bootstraps it via rattler from conda-forge
/// 3. Caches the result for subsequent calls
///
/// Returns the path to the ruff binary, or an error if it can't be obtained.
pub async fn get_ruff_path() -> Result<PathBuf> {
    let result = RUFF_PATH
        .get_or_init(|| async {
            // First, check if ruff is on PATH
            if let Ok(output) = tokio::process::Command::new("ruff")
                .arg("--version")
                .output()
                .await
            {
                if output.status.success() {
                    info!("Using system ruff");
                    return Arc::new(Ok(PathBuf::from("ruff")));
                }
            }

            // Not on PATH, bootstrap via rattler
            info!("ruff not found on PATH, bootstrapping via rattler...");
            match bootstrap_tool("ruff", None).await {
                Ok(tool) => Arc::new(Ok(tool.binary_path)),
                Err(e) => Arc::new(Err(e.to_string())),
            }
        })
        .await;

    match result.as_ref() {
        Ok(path) => Ok(path.clone()),
        Err(e) => Err(anyhow!("{}", e)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_compute_tool_hash() {
        let hash1 = compute_tool_hash("ruff", None);
        let hash2 = compute_tool_hash("ruff", Some("0.8"));
        let hash3 = compute_tool_hash("black", None);

        // Same tool/version should produce same hash
        assert_eq!(hash1, compute_tool_hash("ruff", None));

        // Different versions should produce different hashes
        assert_ne!(hash1, hash2);

        // Different tools should produce different hashes
        assert_ne!(hash1, hash3);
    }

    #[test]
    fn test_tools_cache_dir() {
        let dir = tools_cache_dir();
        assert!(dir.to_string_lossy().contains("runt"));
        assert!(dir.to_string_lossy().contains("tools"));
    }
}
