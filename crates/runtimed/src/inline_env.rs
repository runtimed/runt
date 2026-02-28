//! Cached environment creation for inline dependencies.
//!
//! Creates and caches environments for notebooks with inline UV dependencies.
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

// TODO: Implement prepare_conda_inline_env using rattler
// For now, conda:inline falls back to prewarmed pool (deps not installed)
// The implementation would mirror daemon.rs create_conda_env but with custom specs
