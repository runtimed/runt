//! UV-based environment management for notebook dependencies.
//!
//! This module handles creating ephemeral virtual environments using `uv`
//! for notebooks that declare inline dependencies in their metadata.
//! UV is auto-bootstrapped via rattler if not found on PATH.

use crate::tools;
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

/// Check if uv is available (either on PATH or bootstrappable via rattler).
pub async fn check_uv_available() -> bool {
    tools::get_uv_path().await.is_ok()
}

/// Extract dependencies from notebook metadata.
///
/// Looks for the `uv` key in the metadata's additional fields,
/// which should contain `dependencies` and optionally `requires-python`.
pub fn extract_dependencies(metadata: &nbformat::v4::Metadata) -> Option<NotebookDependencies> {
    let uv_value = metadata.additional.get("uv")?;
    serde_json::from_value(uv_value.clone()).ok()
}

/// Extract the env_id from notebook metadata.
///
/// Looks for the `runt.env_id` field in the metadata's additional fields.
pub fn extract_env_id(metadata: &nbformat::v4::Metadata) -> Option<String> {
    let runt_value = metadata.additional.get("runt")?;
    runt_value.get("env_id")?.as_str().map(|s| s.to_string())
}

/// Compute a cache key for the given dependencies.
///
/// When deps are empty and env_id is provided, includes env_id in hash
/// for per-notebook isolation. This ensures new notebooks get fresh
/// environments while notebooks with dependencies can share cached envs.
fn compute_env_hash(deps: &NotebookDependencies, env_id: Option<&str>) -> String {
    let mut hasher = Sha256::new();

    // Sort dependencies for consistent hashing
    let mut sorted_deps = deps.dependencies.clone();
    sorted_deps.sort();

    // For empty deps, include env_id for per-notebook isolation
    // This ensures new notebooks get their own environment
    if sorted_deps.is_empty() {
        if let Some(id) = env_id {
            hasher.update(b"env_id:");
            hasher.update(id.as_bytes());
            hasher.update(b"\n");
        }
    }

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
///
/// The `env_id` parameter enables per-notebook isolation for empty deps:
/// - If deps are empty and env_id is provided, the env is unique to that notebook
/// - If deps are non-empty, env_id is ignored and envs are shared by dep hash
pub async fn prepare_environment(
    deps: &NotebookDependencies,
    env_id: Option<&str>,
) -> Result<UvEnvironment> {
    let hash = compute_env_hash(deps, env_id);
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

    // Get uv path (from PATH or bootstrapped via rattler)
    let uv_path = tools::get_uv_path().await?;

    // Ensure cache directory exists
    tokio::fs::create_dir_all(&cache_dir).await?;

    // Remove partial/invalid environment if it exists
    if venv_path.exists() {
        tokio::fs::remove_dir_all(&venv_path).await?;
    }

    // Create virtual environment with uv
    let mut venv_cmd = tokio::process::Command::new(&uv_path);
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

    // Install ipykernel, ipywidgets, and dependencies
    let mut install_args = vec![
        "pip".to_string(),
        "install".to_string(),
        "--python".to_string(),
        python_path.to_string_lossy().to_string(),
        "ipykernel".to_string(),
        "ipywidgets".to_string(),
    ];

    for dep in &deps.dependencies {
        install_args.push(dep.clone());
    }

    let install_status = tokio::process::Command::new(&uv_path)
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
/// UV is auto-bootstrapped via rattler if not found on PATH.
pub async fn sync_dependencies(env: &UvEnvironment, deps: &[String]) -> Result<()> {
    if deps.is_empty() {
        return Ok(());
    }

    info!("Syncing {} dependencies to {:?}", deps.len(), env.venv_path);

    // Get uv path (from PATH or bootstrapped via rattler)
    let uv_path = tools::get_uv_path().await?;

    let mut install_args = vec![
        "pip".to_string(),
        "install".to_string(),
        "--python".to_string(),
        env.python_path.to_string_lossy().to_string(),
    ];

    for dep in deps {
        install_args.push(dep.clone());
    }

    let output = tokio::process::Command::new(&uv_path)
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

/// Copy an existing UV environment to a new location for a cloned notebook.
///
/// This allows cloned notebooks to start with the source's environment
/// already prepared, making kernel startup instant.
pub async fn copy_environment(source: &UvEnvironment, new_env_id: &str) -> Result<UvEnvironment> {
    let cache_dir = get_cache_dir();
    let dest_path = cache_dir.join(new_env_id);

    if dest_path.exists() {
        // Already copied (shouldn't happen with UUIDs, but be safe)
        info!("Clone environment already exists at {:?}", dest_path);
        #[cfg(target_os = "windows")]
        let python_path = dest_path.join("Scripts").join("python.exe");
        #[cfg(not(target_os = "windows"))]
        let python_path = dest_path.join("bin").join("python");

        return Ok(UvEnvironment {
            venv_path: dest_path,
            python_path,
        });
    }

    info!(
        "Copying environment from {:?} to {:?}",
        source.venv_path, dest_path
    );

    // Copy the entire venv directory
    copy_dir_recursive(&source.venv_path, &dest_path).await?;

    #[cfg(target_os = "windows")]
    let python_path = dest_path.join("Scripts").join("python.exe");
    #[cfg(not(target_os = "windows"))]
    let python_path = dest_path.join("bin").join("python");

    info!("Environment copied successfully");

    Ok(UvEnvironment {
        venv_path: dest_path,
        python_path,
    })
}

/// Recursively copy a directory.
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
            // Preserve symlinks (important for venv structure)
            // On Unix, use symlink. On Windows, copy the file.
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

/// Clear all cached environments.
#[allow(dead_code)]
pub async fn clear_cache() -> Result<()> {
    let cache_dir = get_cache_dir();
    if cache_dir.exists() {
        tokio::fs::remove_dir_all(&cache_dir).await?;
    }
    Ok(())
}

/// Find existing prewarmed environments from previous sessions.
///
/// Scans the cache directory for `prewarm-*` directories and validates
/// they have a working Python binary. Returns valid environments that
/// can be added to the pool on startup.
pub async fn find_existing_prewarmed_environments() -> Vec<UvEnvironment> {
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

        let venv_path = entry.path();

        // Determine python path based on platform
        #[cfg(target_os = "windows")]
        let python_path = venv_path.join("Scripts").join("python.exe");
        #[cfg(not(target_os = "windows"))]
        let python_path = venv_path.join("bin").join("python");

        // Validate the python binary exists
        if !python_path.exists() {
            info!(
                "[prewarm] Removing invalid prewarmed env (no python): {:?}",
                venv_path
            );
            tokio::fs::remove_dir_all(&venv_path).await.ok();
            continue;
        }

        info!("[prewarm] Found existing prewarmed environment: {:?}", venv_path);
        found.push(UvEnvironment {
            venv_path,
            python_path,
        });
    }

    found
}

/// Read the `default_uv_packages` setting.
fn parse_extra_packages() -> Vec<String> {
    crate::settings::load_settings().default_uv_packages
}

/// Create a prewarmed environment with ipykernel, ipywidgets, and any
/// user-configured default packages installed.
///
/// This creates an environment at a temporary path (prewarm-{uuid}) that can
/// later be claimed by a notebook using `claim_prewarmed_environment`.
/// UV is auto-bootstrapped via rattler if not found on PATH.
pub async fn create_prewarmed_environment() -> Result<UvEnvironment> {
    let temp_id = format!("prewarm-{}", uuid::Uuid::new_v4());
    let cache_dir = get_cache_dir();
    let venv_path = cache_dir.join(&temp_id);

    // Determine python path based on platform
    #[cfg(target_os = "windows")]
    let python_path = venv_path.join("Scripts").join("python.exe");
    #[cfg(not(target_os = "windows"))]
    let python_path = venv_path.join("bin").join("python");

    info!("[prewarm] Creating prewarmed environment at {:?}", venv_path);

    // Get uv path (from PATH or bootstrapped via rattler)
    let uv_path = tools::get_uv_path().await?;

    // Ensure cache directory exists
    tokio::fs::create_dir_all(&cache_dir).await?;

    // Create virtual environment with uv
    let venv_status = tokio::process::Command::new(&uv_path)
        .arg("venv")
        .arg(&venv_path)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .status()
        .await?;

    if !venv_status.success() {
        return Err(anyhow!("Failed to create prewarmed virtual environment"));
    }

    // Install ipykernel, ipywidgets, and any user-configured default packages
    let extra = parse_extra_packages();
    let mut install_args = vec![
        "pip".to_string(),
        "install".to_string(),
        "--python".to_string(),
        python_path.to_string_lossy().to_string(),
        "ipykernel".to_string(),
        "ipywidgets".to_string(),
    ];
    if !extra.is_empty() {
        info!("[prewarm] Including default packages: {:?}", extra);
        install_args.extend(extra);
    }
    let install_status = tokio::process::Command::new(&uv_path)
        .args(&install_args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .status()
        .await?;

    if !install_status.success() {
        // Clean up failed environment
        tokio::fs::remove_dir_all(&venv_path).await.ok();
        return Err(anyhow!("Failed to install ipykernel in prewarmed environment"));
    }

    info!("[prewarm] Prewarmed environment ready at {:?}", venv_path);

    let env = UvEnvironment {
        venv_path,
        python_path,
    };

    // Warm up the environment by running Python to trigger .pyc compilation
    warmup_uv_environment(&env).await?;

    Ok(env)
}

/// Claim a prewarmed environment for a specific notebook.
///
/// This moves the prewarmed environment to the correct cache location based
/// on the notebook's env_id, so it will be found by `prepare_environment`.
pub async fn claim_prewarmed_environment(
    prewarmed: UvEnvironment,
    env_id: &str,
) -> Result<UvEnvironment> {
    // Compute the hash that would be used for empty deps with this env_id
    let deps = NotebookDependencies {
        dependencies: vec![],
        requires_python: None,
    };
    let hash = compute_env_hash(&deps, Some(env_id));
    let cache_dir = get_cache_dir();
    let dest_path = cache_dir.join(&hash);

    // Determine python path based on platform
    #[cfg(target_os = "windows")]
    let python_path = dest_path.join("Scripts").join("python.exe");
    #[cfg(not(target_os = "windows"))]
    let python_path = dest_path.join("bin").join("python");

    // If destination already exists, just use it (race condition safety)
    if dest_path.exists() {
        info!(
            "[prewarm] Destination already exists, removing prewarmed env at {:?}",
            prewarmed.venv_path
        );
        tokio::fs::remove_dir_all(&prewarmed.venv_path).await.ok();
        return Ok(UvEnvironment {
            venv_path: dest_path,
            python_path,
        });
    }

    info!(
        "[prewarm] Claiming prewarmed environment: {:?} -> {:?}",
        prewarmed.venv_path, dest_path
    );

    // Try to rename (fast if same filesystem)
    match tokio::fs::rename(&prewarmed.venv_path, &dest_path).await {
        Ok(()) => {
            info!("[prewarm] Environment claimed via rename");
        }
        Err(e) => {
            // Rename failed (possibly cross-filesystem), fall back to copy+delete
            info!(
                "[prewarm] Rename failed ({}), falling back to copy",
                e
            );
            copy_dir_recursive(&prewarmed.venv_path, &dest_path).await?;
            tokio::fs::remove_dir_all(&prewarmed.venv_path).await.ok();
            info!("[prewarm] Environment claimed via copy");
        }
    }

    Ok(UvEnvironment {
        venv_path: dest_path,
        python_path,
    })
}

/// Warm up a UV environment by running Python to trigger initialization.
///
/// This compiles .pyc files and runs first-time setup for ipykernel,
/// dramatically reducing kernel startup time on subsequent use.
pub async fn warmup_uv_environment(env: &UvEnvironment) -> Result<()> {
    let warmup_start = std::time::Instant::now();
    info!("[prewarm] Warming up UV environment at {:?}", env.venv_path);

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
        log::warn!(
            "[prewarm] UV warmup failed for {:?}: {}",
            env.venv_path,
            stderr
        );
        // Don't fail the whole operation - environment is still usable
        return Ok(());
    }

    // Create marker file to indicate this env has been warmed
    let marker_path = env.venv_path.join(".warmed");
    tokio::fs::write(&marker_path, "").await.ok();

    info!(
        "[prewarm] UV warmup complete for {:?} in {}ms",
        env.venv_path,
        warmup_start.elapsed().as_millis()
    );

    Ok(())
}

/// Check if a UV environment has been warmed up.
///
/// Looks for a `.warmed` marker file in the environment directory.
pub fn is_environment_warmed(env: &UvEnvironment) -> bool {
    env.venv_path.join(".warmed").exists()
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

        let hash1 = compute_env_hash(&deps, None);
        let hash2 = compute_env_hash(&deps, None);

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

        assert_eq!(compute_env_hash(&deps1, None), compute_env_hash(&deps2, None));
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

        assert_ne!(compute_env_hash(&deps1, None), compute_env_hash(&deps2, None));
    }
}
