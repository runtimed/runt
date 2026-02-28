//! Cached environment creation for inline dependencies.
//!
//! Creates and caches environments for notebooks with inline UV or Conda dependencies.
//! Environments are cached by dependency hash for fast reuse.

use anyhow::{anyhow, Result};
use log::info;
use sha2::{Digest, Sha256};
use std::path::PathBuf;
use std::process::Stdio;

/// Result of preparing an environment with inline deps.
#[derive(Debug, Clone)]
pub struct PreparedEnv {
    pub env_path: PathBuf,
    pub python_path: PathBuf,
}

/// Get the cache directory for inline dependency environments.
fn get_inline_cache_dir() -> PathBuf {
    dirs::cache_dir()
        .unwrap_or_else(|| PathBuf::from("/tmp"))
        .join("runt")
        .join("inline-envs")
}

/// Compute a stable hash for the given dependencies.
fn compute_deps_hash(deps: &[String]) -> String {
    let mut hasher = Sha256::new();

    // Sort dependencies for consistent hashing
    let mut sorted_deps = deps.to_vec();
    sorted_deps.sort();

    for dep in &sorted_deps {
        hasher.update(dep.as_bytes());
        hasher.update(b"\n");
    }

    let result = hasher.finalize();
    format!("inline-{}", hex::encode(&result[..8]))
}

/// Prepare a cached UV environment with the given inline dependencies.
///
/// If a cached environment with the same deps already exists, returns it immediately.
/// Otherwise creates a new environment with uv venv + uv pip install.
pub async fn prepare_uv_inline_env(deps: &[String]) -> Result<PreparedEnv> {
    let hash = compute_deps_hash(deps);
    let cache_dir = get_inline_cache_dir();
    let env_path = cache_dir.join(&hash);

    // Determine python path based on platform
    #[cfg(target_os = "windows")]
    let python_path = env_path.join("Scripts").join("python.exe");
    #[cfg(not(target_os = "windows"))]
    let python_path = env_path.join("bin").join("python");

    // Check if cached environment exists and is valid
    if env_path.exists() && python_path.exists() {
        info!(
            "[inline-env] Cache hit for UV inline deps {:?} at {:?}",
            deps, env_path
        );
        return Ok(PreparedEnv {
            env_path,
            python_path,
        });
    }

    info!(
        "[inline-env] Creating new UV env for deps {:?} at {:?}",
        deps, env_path
    );

    // Get uv path
    let uv_path = kernel_launch::tools::get_uv_path().await?;

    // Ensure cache directory exists
    tokio::fs::create_dir_all(&cache_dir).await?;

    // Remove partial/invalid environment if it exists
    if env_path.exists() {
        tokio::fs::remove_dir_all(&env_path).await?;
    }

    // Create virtual environment with uv
    let venv_output = tokio::process::Command::new(&uv_path)
        .args(["venv", &env_path.to_string_lossy()])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .await?;

    if !venv_output.status.success() {
        let stderr = String::from_utf8_lossy(&venv_output.stderr);
        return Err(anyhow!("Failed to create virtual environment: {}", stderr));
    }

    // Install ipykernel + dependencies
    let mut install_args = vec![
        "pip".to_string(),
        "install".to_string(),
        "--python".to_string(),
        python_path.to_string_lossy().to_string(),
        "ipykernel".to_string(),
    ];

    for dep in deps {
        install_args.push(dep.clone());
    }

    info!("[inline-env] Installing: {:?}", install_args);

    let install_output = tokio::process::Command::new(&uv_path)
        .args(&install_args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .await?;

    if !install_output.status.success() {
        // Clean up failed environment
        tokio::fs::remove_dir_all(&env_path).await.ok();
        let stderr = String::from_utf8_lossy(&install_output.stderr);
        return Err(anyhow!("Failed to install dependencies: {}", stderr));
    }

    info!("[inline-env] UV environment ready at {:?}", env_path);

    Ok(PreparedEnv {
        env_path,
        python_path,
    })
}

/// Compute a stable hash for conda dependencies + channels.
///
/// Includes channels in the hash because the same package name from different
/// channels can yield different packages.
fn compute_conda_deps_hash(deps: &[String], channels: &[String]) -> String {
    let mut hasher = Sha256::new();

    // Hash channels first (sorted for stability)
    let mut sorted_channels = channels.to_vec();
    sorted_channels.sort();
    for ch in &sorted_channels {
        hasher.update(b"channel:");
        hasher.update(ch.as_bytes());
        hasher.update(b"\n");
    }

    // Then hash deps (sorted for stability)
    let mut sorted_deps = deps.to_vec();
    sorted_deps.sort();
    for dep in &sorted_deps {
        hasher.update(dep.as_bytes());
        hasher.update(b"\n");
    }

    let result = hasher.finalize();
    format!("conda-inline-{}", hex::encode(&result[..8]))
}

/// Prepare a cached Conda environment with the given inline dependencies.
///
/// If a cached environment with the same deps+channels already exists, returns it
/// immediately. Otherwise creates a new environment using rattler (solve + install).
///
/// This mirrors the pattern in `daemon.rs::create_conda_env` but for inline deps
/// instead of the prewarmed pool.
pub async fn prepare_conda_inline_env(deps: &[String], channels: &[String]) -> Result<PreparedEnv> {
    use rattler::{default_cache_dir, install::Installer, package_cache::PackageCache};
    use rattler_conda_types::{
        Channel, ChannelConfig, GenericVirtualPackage, MatchSpec, ParseMatchSpecOptions, Platform,
    };
    use rattler_repodata_gateway::Gateway;
    use rattler_solve::{resolvo, SolverImpl, SolverTask};

    let hash = compute_conda_deps_hash(deps, channels);
    let cache_dir = get_inline_cache_dir();
    let env_path = cache_dir.join(&hash);

    // Determine python path based on platform
    #[cfg(target_os = "windows")]
    let python_path = env_path.join("python.exe");
    #[cfg(not(target_os = "windows"))]
    let python_path = env_path.join("bin").join("python");

    // Check if cached environment exists and is valid
    if env_path.exists() && python_path.exists() {
        info!(
            "[inline-env] Cache hit for Conda inline deps {:?} at {:?}",
            deps, env_path
        );
        return Ok(PreparedEnv {
            env_path,
            python_path,
        });
    }

    info!(
        "[inline-env] Creating new Conda env for deps {:?} (channels: {:?}) at {:?}",
        deps, channels, env_path
    );

    // Ensure cache directory exists
    tokio::fs::create_dir_all(&cache_dir).await?;

    // Remove partial/invalid environment if it exists
    if env_path.exists() {
        tokio::fs::remove_dir_all(&env_path).await?;
    }

    // Setup channel configuration
    let channel_config = ChannelConfig::default_with_root_dir(cache_dir.clone());

    // Parse channels (default to conda-forge if none specified)
    let channel_names = if channels.is_empty() {
        vec!["conda-forge".to_string()]
    } else {
        channels.to_vec()
    };
    let parsed_channels: Vec<Channel> = channel_names
        .iter()
        .map(|ch| Channel::from_str(ch, &channel_config))
        .collect::<std::result::Result<Vec<_>, _>>()
        .map_err(|e| anyhow!("Failed to parse conda channel: {}", e))?;

    // Build specs: python + ipykernel + user deps
    let match_spec_options = ParseMatchSpecOptions::strict();
    let mut specs = vec![
        MatchSpec::from_str("python>=3.9", match_spec_options)
            .map_err(|e| anyhow!("Failed to parse python spec: {}", e))?,
        MatchSpec::from_str("ipykernel", match_spec_options)
            .map_err(|e| anyhow!("Failed to parse ipykernel spec: {}", e))?,
    ];
    for dep in deps {
        specs.push(
            MatchSpec::from_str(dep, match_spec_options)
                .map_err(|e| anyhow!("Failed to parse dep '{}': {}", dep, e))?,
        );
    }

    // Find rattler cache directory
    let rattler_cache_dir =
        default_cache_dir().map_err(|e| anyhow!("Could not determine rattler cache dir: {}", e))?;
    rattler_cache::ensure_cache_dir(&rattler_cache_dir)
        .map_err(|e| anyhow!("Could not create rattler cache dir: {}", e))?;

    // Create HTTP client
    let download_client = reqwest_middleware::ClientBuilder::new(
        reqwest::Client::builder()
            .build()
            .map_err(|e| anyhow!("Failed to create HTTP client: {}", e))?,
    )
    .build();

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

    info!("[inline-env] Fetching conda repodata for inline deps...");
    let repo_data = gateway
        .query(parsed_channels, platforms, specs.clone())
        .recursive(true)
        .await
        .map_err(|e| anyhow!("Failed to fetch conda repodata: {}", e))?;

    info!("[inline-env] Solving conda dependencies...");

    // Detect virtual packages
    let virtual_packages = rattler_virtual_packages::VirtualPackage::detect(
        &rattler_virtual_packages::VirtualPackageOverrides::default(),
    )
    .map_err(|e| anyhow!("Failed to detect virtual packages: {}", e))?
    .iter()
    .map(|vpkg| GenericVirtualPackage::from(vpkg.clone()))
    .collect::<Vec<_>>();

    // Solve dependencies
    let solver_task = SolverTask {
        virtual_packages,
        specs,
        ..SolverTask::from_iter(&repo_data)
    };

    let required_packages = resolvo::Solver
        .solve(solver_task)
        .map_err(|e| anyhow!("Failed to solve conda dependencies: {}", e))?
        .records;

    info!(
        "[inline-env] Solved: {} conda packages to install",
        required_packages.len()
    );

    // Install packages
    Installer::new()
        .with_download_client(download_client)
        .with_target_platform(install_platform)
        .install(&env_path, required_packages)
        .await
        .map_err(|e| {
            // Clean up failed environment
            let env_path_clone = env_path.clone();
            tokio::spawn(async move {
                tokio::fs::remove_dir_all(&env_path_clone).await.ok();
            });
            anyhow!("Failed to install conda packages: {}", e)
        })?;

    // Verify python exists
    if !python_path.exists() {
        tokio::fs::remove_dir_all(&env_path).await.ok();
        return Err(anyhow!(
            "Python not found at {:?} after conda install",
            python_path
        ));
    }

    info!(
        "[inline-env] Conda inline environment ready at {:?}",
        env_path
    );

    Ok(PreparedEnv {
        env_path,
        python_path,
    })
}

/// Extract channels from conda metadata in a notebook file.
/// Returns the list of channel strings, or defaults to ["conda-forge"].
pub fn get_inline_conda_channels(notebook_path: &std::path::Path) -> Vec<String> {
    let content = match std::fs::read_to_string(notebook_path) {
        Ok(c) => c,
        Err(_) => return vec!["conda-forge".to_string()],
    };
    let nb: serde_json::Value = match serde_json::from_str(&content) {
        Ok(v) => v,
        Err(_) => return vec!["conda-forge".to_string()],
    };
    let metadata_value = match nb.get("metadata") {
        Some(m) => m,
        None => return vec!["conda-forge".to_string()],
    };

    let metadata: std::collections::HashMap<String, serde_json::Value> =
        match serde_json::from_value(metadata_value.clone()) {
            Ok(m) => m,
            Err(_) => return vec!["conda-forge".to_string()],
        };

    if let Some(conda) = runt_trust::get_conda_metadata(&metadata) {
        if let Some(channels) = conda.get("channels").and_then(|c| c.as_array()) {
            let ch: Vec<String> = channels
                .iter()
                .filter_map(|v| v.as_str().map(|s| s.to_string()))
                .collect();
            if !ch.is_empty() {
                return ch;
            }
        }
    }

    vec!["conda-forge".to_string()]
}
