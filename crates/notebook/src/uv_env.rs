//! UV-based environment management for notebook dependencies.
//!
//! This module handles creating ephemeral virtual environments using `uv`
//! for notebooks that declare inline dependencies in their metadata.

use anyhow::{anyhow, Result};
use log::info;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::path::PathBuf;
use std::process::Stdio;

/// Dependencies extracted from notebook metadata.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NotebookDependencies {
    pub dependencies: Vec<String>,
    #[serde(rename = "requires-python")]
    pub requires_python: Option<String>,
}

/// Result of environment preparation.
#[derive(Debug)]
pub struct UvEnvironment {
    pub venv_path: PathBuf,
    pub python_path: PathBuf,
}

/// Check if uv is available on the system.
pub async fn check_uv_available() -> bool {
    tokio::process::Command::new("uv")
        .arg("--version")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .await
        .map(|s| s.success())
        .unwrap_or(false)
}

/// Extract dependencies from notebook metadata.
///
/// Looks for the `uv` key in the metadata's additional fields,
/// which should contain `dependencies` and optionally `requires-python`.
pub fn extract_dependencies(metadata: &nbformat::v4::Metadata) -> Option<NotebookDependencies> {
    let uv_value = metadata.additional.get("uv")?;
    serde_json::from_value(uv_value.clone()).ok()
}

/// Compute a cache key for the given dependencies.
fn compute_env_hash(deps: &NotebookDependencies) -> String {
    let mut hasher = Sha256::new();

    // Sort dependencies for consistent hashing
    let mut sorted_deps = deps.dependencies.clone();
    sorted_deps.sort();

    for dep in &sorted_deps {
        hasher.update(dep.as_bytes());
        hasher.update(b"\n");
    }

    if let Some(ref py) = deps.requires_python {
        hasher.update(b"requires-python:");
        hasher.update(py.as_bytes());
    }

    let hash = hasher.finalize();
    format!("{:x}", hash)[..16].to_string()
}

/// Get the cache directory for runt environments.
fn get_cache_dir() -> PathBuf {
    dirs::cache_dir()
        .unwrap_or_else(|| PathBuf::from("/tmp"))
        .join("runt")
        .join("envs")
}

/// Prepare a virtual environment with the given dependencies.
///
/// Uses cached environments when possible (keyed by dependency hash).
/// If the cache doesn't exist or is invalid, creates a new environment.
pub async fn prepare_environment(deps: &NotebookDependencies) -> Result<UvEnvironment> {
    let hash = compute_env_hash(deps);
    let cache_dir = get_cache_dir();
    let venv_path = cache_dir.join(&hash);

    // Determine python path based on platform
    #[cfg(target_os = "windows")]
    let python_path = venv_path.join("Scripts").join("python.exe");
    #[cfg(not(target_os = "windows"))]
    let python_path = venv_path.join("bin").join("python");

    // Check if cached environment exists and is valid
    if venv_path.exists() && python_path.exists() {
        info!("Using cached environment at {:?}", venv_path);
        return Ok(UvEnvironment {
            venv_path,
            python_path,
        });
    }

    info!("Creating new environment at {:?}", venv_path);

    // Ensure cache directory exists
    tokio::fs::create_dir_all(&cache_dir).await?;

    // Remove partial/invalid environment if it exists
    if venv_path.exists() {
        tokio::fs::remove_dir_all(&venv_path).await?;
    }

    // Create virtual environment with uv
    let mut venv_cmd = tokio::process::Command::new("uv");
    venv_cmd.arg("venv").arg(&venv_path);

    // Add python version constraint if specified
    if let Some(ref py_version) = deps.requires_python {
        // Extract version number from constraint like ">=3.10" -> "3.10"
        let version = py_version
            .trim_start_matches(|c: char| !c.is_ascii_digit())
            .to_string();
        if !version.is_empty() {
            venv_cmd.arg("--python").arg(&version);
        }
    }

    let venv_status = venv_cmd
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .status()
        .await?;

    if !venv_status.success() {
        return Err(anyhow!("Failed to create virtual environment"));
    }

    // Install ipykernel and dependencies
    let mut install_args = vec![
        "pip".to_string(),
        "install".to_string(),
        "--python".to_string(),
        python_path.to_string_lossy().to_string(),
        "ipykernel".to_string(),
    ];

    for dep in &deps.dependencies {
        install_args.push(dep.clone());
    }

    let install_status = tokio::process::Command::new("uv")
        .args(&install_args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .status()
        .await?;

    if !install_status.success() {
        // Clean up failed environment
        tokio::fs::remove_dir_all(&venv_path).await.ok();
        return Err(anyhow!("Failed to install dependencies"));
    }

    info!("Environment ready at {:?}", venv_path);

    Ok(UvEnvironment {
        venv_path,
        python_path,
    })
}

/// Clean up an ephemeral environment.
///
/// Note: We don't actually remove cached environments since they can be reused.
/// This is called on kernel shutdown but only cleans up if needed.
pub async fn cleanup_environment(_env: &UvEnvironment) -> Result<()> {
    // For now, we keep cached environments for reuse.
    // Could add LRU eviction or size-based cleanup later.
    Ok(())
}

/// Force remove a cached environment (for manual cleanup).
#[allow(dead_code)]
pub async fn remove_environment(env: &UvEnvironment) -> Result<()> {
    if env.venv_path.exists() {
        tokio::fs::remove_dir_all(&env.venv_path).await?;
    }
    Ok(())
}

/// Install additional dependencies into an existing environment.
///
/// This is used to sync new dependencies when the kernel is already running.
pub async fn sync_dependencies(env: &UvEnvironment, deps: &[String]) -> Result<()> {
    if deps.is_empty() {
        return Ok(());
    }

    info!("Syncing {} dependencies to {:?}", deps.len(), env.venv_path);

    let mut install_args = vec![
        "pip".to_string(),
        "install".to_string(),
        "--python".to_string(),
        env.python_path.to_string_lossy().to_string(),
    ];

    for dep in deps {
        install_args.push(dep.clone());
    }

    let output = tokio::process::Command::new("uv")
        .args(&install_args)
        .output()
        .await?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(anyhow!("Failed to sync dependencies: {}", stderr));
    }

    info!("Dependencies synced successfully");
    Ok(())
}

/// Clear all cached environments.
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
        let deps = NotebookDependencies {
            dependencies: vec!["pandas".to_string(), "numpy".to_string()],
            requires_python: Some(">=3.10".to_string()),
        };

        let hash1 = compute_env_hash(&deps);
        let hash2 = compute_env_hash(&deps);

        assert_eq!(hash1, hash2);
    }

    #[test]
    fn test_compute_env_hash_order_independent() {
        let deps1 = NotebookDependencies {
            dependencies: vec!["pandas".to_string(), "numpy".to_string()],
            requires_python: None,
        };

        let deps2 = NotebookDependencies {
            dependencies: vec!["numpy".to_string(), "pandas".to_string()],
            requires_python: None,
        };

        assert_eq!(compute_env_hash(&deps1), compute_env_hash(&deps2));
    }

    #[test]
    fn test_compute_env_hash_different_deps() {
        let deps1 = NotebookDependencies {
            dependencies: vec!["pandas".to_string()],
            requires_python: None,
        };

        let deps2 = NotebookDependencies {
            dependencies: vec!["numpy".to_string()],
            requires_python: None,
        };

        assert_ne!(compute_env_hash(&deps1), compute_env_hash(&deps2));
    }
}
