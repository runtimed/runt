pub mod conda_env;
pub mod execution_queue;
pub mod kernel;
pub mod menu;
pub mod notebook_state;
pub mod pyproject;
pub mod uv_env;

use execution_queue::{ExecutionQueue, ExecutionQueueState, QueueCommand, SharedExecutionQueue};
use kernel::{CompletionResult, HistoryResult, NotebookKernel};
use notebook_state::{FrontendCell, NotebookState};

use log::info;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tauri::{Emitter, Manager};
use tokio::sync::mpsc;

#[derive(Serialize)]
struct KernelspecInfo {
    name: String,
    display_name: String,
    language: String,
}

/// Git information for debug banner display.
#[derive(Serialize)]
struct GitInfo {
    branch: String,
    commit: String,
    description: Option<String>,
}

/// Get git information for the debug banner.
/// Returns None in release builds.
#[tauri::command]
async fn get_git_info() -> Option<GitInfo> {
    #[cfg(debug_assertions)]
    {
        // Try to read workspace description from .context/workspace-description
        let description = std::fs::read_to_string(".context/workspace-description")
            .ok()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());

        Some(GitInfo {
            branch: env!("GIT_BRANCH").to_string(),
            commit: env!("GIT_COMMIT").to_string(),
            description,
        })
    }
    #[cfg(not(debug_assertions))]
    {
        None
    }
}

#[tauri::command]
async fn load_notebook(
    state: tauri::State<'_, Arc<Mutex<NotebookState>>>,
) -> Result<Vec<FrontendCell>, String> {
    let state = state.lock().map_err(|e| e.to_string())?;
    Ok(state.cells_for_frontend())
}

/// Check if the notebook has a file path set
#[tauri::command]
async fn has_notebook_path(
    state: tauri::State<'_, Arc<Mutex<NotebookState>>>,
) -> Result<bool, String> {
    let state = state.lock().map_err(|e| e.to_string())?;
    Ok(state.path.is_some())
}

/// Get the current notebook file path
#[tauri::command]
async fn get_notebook_path(
    state: tauri::State<'_, Arc<Mutex<NotebookState>>>,
) -> Result<Option<String>, String> {
    let state = state.lock().map_err(|e| e.to_string())?;
    Ok(state.path.as_ref().map(|p| p.to_string_lossy().to_string()))
}

#[tauri::command]
async fn save_notebook(
    state: tauri::State<'_, Arc<Mutex<NotebookState>>>,
) -> Result<(), String> {
    let mut state = state.lock().map_err(|e| e.to_string())?;
    let path = state
        .path
        .clone()
        .ok_or_else(|| "No file path set - use save_notebook_as".to_string())?;
    let content = state.serialize()?;
    std::fs::write(&path, &content).map_err(|e| e.to_string())?;
    state.dirty = false;
    Ok(())
}

/// Save notebook to a specific path (Save As)
#[tauri::command]
async fn save_notebook_as(
    path: String,
    window: tauri::Window,
    state: tauri::State<'_, Arc<Mutex<NotebookState>>>,
) -> Result<(), String> {
    let mut state = state.lock().map_err(|e| e.to_string())?;
    let path = PathBuf::from(&path);
    let content = state.serialize()?;
    std::fs::write(&path, &content).map_err(|e| e.to_string())?;

    // Update the stored path and window title
    let filename = path.file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("Untitled.ipynb");
    let _ = window.set_title(filename);

    state.path = Some(path);
    state.dirty = false;
    Ok(())
}

/// Open a notebook file in a new window (spawns new process)
#[tauri::command]
async fn open_notebook_in_new_window(path: String) -> Result<(), String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    std::process::Command::new(exe)
        .arg(&path)
        .spawn()
        .map_err(|e| format!("Failed to open notebook: {}", e))?;
    Ok(())
}

#[tauri::command]
async fn update_cell_source(
    cell_id: String,
    source: String,
    state: tauri::State<'_, Arc<Mutex<NotebookState>>>,
) -> Result<(), String> {
    let mut state = state.lock().map_err(|e| e.to_string())?;
    state.update_cell_source(&cell_id, &source);
    Ok(())
}

#[tauri::command]
async fn add_cell(
    cell_type: String,
    after_cell_id: Option<String>,
    state: tauri::State<'_, Arc<Mutex<NotebookState>>>,
) -> Result<FrontendCell, String> {
    let mut state = state.lock().map_err(|e| e.to_string())?;
    state
        .add_cell(&cell_type, after_cell_id.as_deref())
        .ok_or_else(|| format!("Invalid cell type: {}", cell_type))
}

#[tauri::command]
async fn delete_cell(
    cell_id: String,
    state: tauri::State<'_, Arc<Mutex<NotebookState>>>,
) -> Result<(), String> {
    let mut state = state.lock().map_err(|e| e.to_string())?;
    if state.delete_cell(&cell_id) {
        Ok(())
    } else {
        Err("Cannot delete cell (last cell or not found)".to_string())
    }
}

#[tauri::command]
async fn execute_cell(
    cell_id: String,
    state: tauri::State<'_, Arc<Mutex<NotebookState>>>,
    kernel_state: tauri::State<'_, Arc<tokio::sync::Mutex<NotebookKernel>>>,
) -> Result<String, String> {
    let code = {
        let mut nb = state.lock().map_err(|e| e.to_string())?;
        let src = nb
            .get_cell_source(&cell_id)
            .ok_or_else(|| "Cell not found".to_string())?;
        nb.clear_cell_outputs(&cell_id);
        src
    };

    info!("execute_cell: cell_id={}, code={:?}", cell_id, &code[..code.len().min(100)]);
    let mut kernel = kernel_state.lock().await;
    let result = kernel
        .execute(&code, &cell_id)
        .await
        .map_err(|e| e.to_string());
    match &result {
        Ok(msg_id) => info!("execute_cell: sent, msg_id={}", msg_id),
        Err(e) => info!("execute_cell: failed: {}", e),
    }
    result
}

/// Queue a cell for execution. The queue processor will execute cells in FIFO order.
#[tauri::command]
async fn queue_execute_cell(
    cell_id: String,
    queue_tx: tauri::State<'_, mpsc::Sender<QueueCommand>>,
) -> Result<(), String> {
    info!("queue_execute_cell: {}", cell_id);
    queue_tx
        .send(QueueCommand::Enqueue { cell_id })
        .await
        .map_err(|e| e.to_string())
}

/// Clear all pending cells from the execution queue (keeps currently executing cell)
#[tauri::command]
async fn clear_execution_queue(
    queue_tx: tauri::State<'_, mpsc::Sender<QueueCommand>>,
) -> Result<(), String> {
    info!("clear_execution_queue");
    queue_tx
        .send(QueueCommand::Clear)
        .await
        .map_err(|e| e.to_string())
}

/// Get the current execution queue state
#[tauri::command]
async fn get_execution_queue_state(
    queue: tauri::State<'_, SharedExecutionQueue>,
) -> Result<ExecutionQueueState, String> {
    let q = queue.lock().map_err(|e| e.to_string())?;
    Ok(q.get_state())
}

#[tauri::command]
async fn start_kernel(
    kernelspec_name: String,
    app: tauri::AppHandle,
    kernel_state: tauri::State<'_, Arc<tokio::sync::Mutex<NotebookKernel>>>,
) -> Result<(), String> {
    let mut kernel = kernel_state.lock().await;
    kernel
        .start(app, &kernelspec_name)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn interrupt_kernel(
    kernel_state: tauri::State<'_, Arc<tokio::sync::Mutex<NotebookKernel>>>,
) -> Result<(), String> {
    let kernel = kernel_state.lock().await;
    kernel.interrupt().await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn shutdown_kernel(
    kernel_state: tauri::State<'_, Arc<tokio::sync::Mutex<NotebookKernel>>>,
) -> Result<(), String> {
    let mut kernel = kernel_state.lock().await;
    kernel.shutdown().await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn send_shell_message(
    message: serde_json::Value,
    kernel_state: tauri::State<'_, Arc<tokio::sync::Mutex<NotebookKernel>>>,
) -> Result<(), String> {
    let mut kernel = kernel_state.lock().await;
    kernel
        .send_shell_message(message)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_preferred_kernelspec(
    state: tauri::State<'_, Arc<Mutex<NotebookState>>>,
) -> Result<Option<String>, String> {
    let state = state.lock().map_err(|e| e.to_string())?;
    Ok(state
        .notebook
        .metadata
        .kernelspec
        .as_ref()
        .map(|k| k.name.clone()))
}

#[tauri::command]
async fn complete(
    code: String,
    cursor_pos: usize,
    kernel_state: tauri::State<'_, Arc<tokio::sync::Mutex<NotebookKernel>>>,
) -> Result<CompletionResult, String> {
    let mut kernel = kernel_state.lock().await;
    kernel
        .complete(&code, cursor_pos)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_history(
    pattern: Option<String>,
    n: Option<i32>,
    kernel_state: tauri::State<'_, Arc<tokio::sync::Mutex<NotebookKernel>>>,
) -> Result<HistoryResult, String> {
    let mut kernel = kernel_state.lock().await;
    kernel
        .history(pattern.as_deref(), n.unwrap_or(100))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn list_kernelspecs() -> Result<Vec<KernelspecInfo>, String> {
    let specs = runtimelib::list_kernelspecs().await;
    Ok(specs
        .into_iter()
        .map(|s| KernelspecInfo {
            name: s.kernel_name,
            display_name: s.kernelspec.display_name,
            language: s.kernelspec.language,
        })
        .collect())
}

// ============================================================================
// UV Dependency Management Commands
// ============================================================================

/// Serializable notebook dependencies for the frontend.
#[derive(Serialize, Deserialize, Clone)]
struct NotebookDependenciesJson {
    dependencies: Vec<String>,
    requires_python: Option<String>,
}

/// Check if uv is available on the system.
#[tauri::command]
async fn check_uv_available() -> bool {
    uv_env::check_uv_available().await
}

/// Get dependencies from notebook metadata.
#[tauri::command]
async fn get_notebook_dependencies(
    state: tauri::State<'_, Arc<Mutex<NotebookState>>>,
) -> Result<Option<NotebookDependenciesJson>, String> {
    let state = state.lock().map_err(|e| e.to_string())?;
    let deps = uv_env::extract_dependencies(&state.notebook.metadata);
    Ok(deps.map(|d| NotebookDependenciesJson {
        dependencies: d.dependencies,
        requires_python: d.requires_python,
    }))
}

/// Set dependencies in notebook metadata.
#[tauri::command]
async fn set_notebook_dependencies(
    dependencies: Vec<String>,
    requires_python: Option<String>,
    state: tauri::State<'_, Arc<Mutex<NotebookState>>>,
) -> Result<(), String> {
    let mut state = state.lock().map_err(|e| e.to_string())?;

    let uv_value = serde_json::json!({
        "dependencies": dependencies,
        "requires-python": requires_python,
    });
    state
        .notebook
        .metadata
        .additional
        .insert("uv".to_string(), uv_value);
    state.dirty = true;

    Ok(())
}

/// Add a single dependency to the notebook.
#[tauri::command]
async fn add_dependency(
    package: String,
    state: tauri::State<'_, Arc<Mutex<NotebookState>>>,
) -> Result<(), String> {
    let mut state = state.lock().map_err(|e| e.to_string())?;

    // Get existing deps or create new
    let mut deps = uv_env::extract_dependencies(&state.notebook.metadata)
        .map(|d| d.dependencies)
        .unwrap_or_default();

    // Check if already exists (by package name, ignoring version specifiers)
    let pkg_name = package.split(&['>', '<', '=', '!', '~', '['][..]).next().unwrap_or(&package);
    let already_exists = deps.iter().any(|d| {
        let existing_name = d.split(&['>', '<', '=', '!', '~', '['][..]).next().unwrap_or(d);
        existing_name.eq_ignore_ascii_case(pkg_name)
    });

    if !already_exists {
        deps.push(package);

        let requires_python = uv_env::extract_dependencies(&state.notebook.metadata)
            .and_then(|d| d.requires_python);

        let uv_value = serde_json::json!({
            "dependencies": deps,
            "requires-python": requires_python,
        });
        state
            .notebook
            .metadata
            .additional
            .insert("uv".to_string(), uv_value);
        state.dirty = true;
    }

    Ok(())
}

/// Remove a dependency from the notebook.
#[tauri::command]
async fn remove_dependency(
    package: String,
    state: tauri::State<'_, Arc<Mutex<NotebookState>>>,
) -> Result<(), String> {
    let mut state = state.lock().map_err(|e| e.to_string())?;

    let existing = uv_env::extract_dependencies(&state.notebook.metadata);
    if let Some(existing) = existing {
        // Remove by package name (ignoring version specifiers)
        let pkg_name = package.split(&['>', '<', '=', '!', '~', '['][..]).next().unwrap_or(&package);
        let deps: Vec<String> = existing
            .dependencies
            .into_iter()
            .filter(|d| {
                let existing_name = d.split(&['>', '<', '=', '!', '~', '['][..]).next().unwrap_or(d);
                !existing_name.eq_ignore_ascii_case(pkg_name)
            })
            .collect();

        let uv_value = serde_json::json!({
            "dependencies": deps,
            "requires-python": existing.requires_python,
        });
        state
            .notebook
            .metadata
            .additional
            .insert("uv".to_string(), uv_value);
        state.dirty = true;
    }

    Ok(())
}

/// Start kernel with uv-managed environment.
#[tauri::command]
async fn start_kernel_with_uv(
    app: tauri::AppHandle,
    notebook_state: tauri::State<'_, Arc<Mutex<NotebookState>>>,
    kernel_state: tauri::State<'_, Arc<tokio::sync::Mutex<NotebookKernel>>>,
) -> Result<(), String> {
    let deps = {
        let state = notebook_state.lock().map_err(|e| e.to_string())?;
        uv_env::extract_dependencies(&state.notebook.metadata)
    };

    let deps = deps.ok_or_else(|| "No dependencies in notebook metadata".to_string())?;

    info!(
        "Starting uv-managed kernel with {} dependencies",
        deps.dependencies.len()
    );

    let mut kernel = kernel_state.lock().await;
    kernel
        .start_with_uv(app, &deps)
        .await
        .map_err(|e| e.to_string())
}

/// Check if a kernel is currently running.
#[tauri::command]
async fn is_kernel_running(
    kernel_state: tauri::State<'_, Arc<tokio::sync::Mutex<NotebookKernel>>>,
) -> Result<bool, String> {
    let kernel = kernel_state.lock().await;
    Ok(kernel.is_running())
}

/// Check if the running kernel has a uv-managed environment.
#[tauri::command]
async fn kernel_has_uv_env(
    kernel_state: tauri::State<'_, Arc<tokio::sync::Mutex<NotebookKernel>>>,
) -> Result<bool, String> {
    let kernel = kernel_state.lock().await;
    Ok(kernel.has_uv_environment())
}

/// Sync dependencies to the running kernel's uv environment.
///
/// Installs any new/changed dependencies into the existing venv.
/// Returns true if sync was performed, false if no uv environment exists.
#[tauri::command]
async fn sync_kernel_dependencies(
    notebook_state: tauri::State<'_, Arc<Mutex<NotebookState>>>,
    kernel_state: tauri::State<'_, Arc<tokio::sync::Mutex<NotebookKernel>>>,
) -> Result<bool, String> {
    let deps = {
        let state = notebook_state.lock().map_err(|e| e.to_string())?;
        uv_env::extract_dependencies(&state.notebook.metadata)
    };

    let Some(deps) = deps else {
        return Ok(false);
    };

    let kernel = kernel_state.lock().await;
    let Some(env) = kernel.uv_environment() else {
        return Ok(false);
    };

    info!("Syncing {} dependencies to kernel environment", deps.dependencies.len());

    uv_env::sync_dependencies(env, &deps.dependencies)
        .await
        .map_err(|e| e.to_string())?;

    Ok(true)
}

// ============================================================================
// Conda Dependency Management Commands
// ============================================================================

/// Serializable conda notebook dependencies for the frontend.
#[derive(Serialize, Deserialize, Clone)]
struct CondaDependenciesJson {
    dependencies: Vec<String>,
    channels: Vec<String>,
    python: Option<String>,
}

/// Get conda dependencies from notebook metadata.
#[tauri::command]
async fn get_conda_dependencies(
    state: tauri::State<'_, Arc<Mutex<NotebookState>>>,
) -> Result<Option<CondaDependenciesJson>, String> {
    let state = state.lock().map_err(|e| e.to_string())?;
    let deps = conda_env::extract_dependencies(&state.notebook.metadata);
    Ok(deps.map(|d| CondaDependenciesJson {
        dependencies: d.dependencies,
        channels: d.channels,
        python: d.python,
    }))
}

/// Set conda dependencies in notebook metadata.
#[tauri::command]
async fn set_conda_dependencies(
    dependencies: Vec<String>,
    channels: Vec<String>,
    python: Option<String>,
    state: tauri::State<'_, Arc<Mutex<NotebookState>>>,
) -> Result<(), String> {
    let mut state = state.lock().map_err(|e| e.to_string())?;

    let conda_value = serde_json::json!({
        "dependencies": dependencies,
        "channels": channels,
        "python": python,
    });
    state
        .notebook
        .metadata
        .additional
        .insert("conda".to_string(), conda_value);
    state.dirty = true;

    Ok(())
}

/// Add a single conda dependency to the notebook.
#[tauri::command]
async fn add_conda_dependency(
    package: String,
    state: tauri::State<'_, Arc<Mutex<NotebookState>>>,
) -> Result<(), String> {
    let mut state = state.lock().map_err(|e| e.to_string())?;

    // Get existing deps or create new
    let existing = conda_env::extract_dependencies(&state.notebook.metadata);
    let mut deps = existing.as_ref().map(|d| d.dependencies.clone()).unwrap_or_default();
    let channels = existing.as_ref().map(|d| d.channels.clone()).unwrap_or_default();
    let python = existing.as_ref().and_then(|d| d.python.clone());

    // Check if already exists (by package name, ignoring version specifiers)
    let pkg_name = package.split(&['>', '<', '=', '!', '~', '['][..]).next().unwrap_or(&package);
    let already_exists = deps.iter().any(|d| {
        let existing_name = d.split(&['>', '<', '=', '!', '~', '['][..]).next().unwrap_or(d);
        existing_name.eq_ignore_ascii_case(pkg_name)
    });

    if !already_exists {
        deps.push(package);

        let conda_value = serde_json::json!({
            "dependencies": deps,
            "channels": channels,
            "python": python,
        });
        state
            .notebook
            .metadata
            .additional
            .insert("conda".to_string(), conda_value);
        state.dirty = true;
    }

    Ok(())
}

/// Remove a conda dependency from the notebook.
#[tauri::command]
async fn remove_conda_dependency(
    package: String,
    state: tauri::State<'_, Arc<Mutex<NotebookState>>>,
) -> Result<(), String> {
    let mut state = state.lock().map_err(|e| e.to_string())?;

    let existing = conda_env::extract_dependencies(&state.notebook.metadata);
    if let Some(existing) = existing {
        // Remove by package name (ignoring version specifiers)
        let pkg_name = package.split(&['>', '<', '=', '!', '~', '['][..]).next().unwrap_or(&package);
        let deps: Vec<String> = existing
            .dependencies
            .into_iter()
            .filter(|d| {
                let existing_name = d.split(&['>', '<', '=', '!', '~', '['][..]).next().unwrap_or(d);
                !existing_name.eq_ignore_ascii_case(pkg_name)
            })
            .collect();

        let conda_value = serde_json::json!({
            "dependencies": deps,
            "channels": existing.channels,
            "python": existing.python,
        });
        state
            .notebook
            .metadata
            .additional
            .insert("conda".to_string(), conda_value);
        state.dirty = true;
    }

    Ok(())
}

/// Start kernel with conda-managed environment.
#[tauri::command]
async fn start_kernel_with_conda(
    app: tauri::AppHandle,
    notebook_state: tauri::State<'_, Arc<Mutex<NotebookState>>>,
    kernel_state: tauri::State<'_, Arc<tokio::sync::Mutex<NotebookKernel>>>,
) -> Result<(), String> {
    let deps = {
        let mut state = notebook_state.lock().map_err(|e| e.to_string())?;
        let mut deps = conda_env::extract_dependencies(&state.notebook.metadata)
            .ok_or_else(|| "No conda dependencies in notebook metadata".to_string())?;

        // Get or create env_id for isolation
        let env_id = state
            .notebook
            .metadata
            .additional
            .get("runt")
            .and_then(|v| v.get("env_id"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());

        if let Some(id) = env_id {
            deps.env_id = Some(id);
        } else {
            // Generate and store a new env_id
            let new_id = uuid::Uuid::new_v4().to_string();
            let runt_value = serde_json::json!({
                "env_id": new_id,
            });
            state
                .notebook
                .metadata
                .additional
                .insert("runt".to_string(), runt_value);
            state.dirty = true;
            deps.env_id = Some(new_id);
        }

        deps
    };

    info!(
        "Starting conda-managed kernel with {} dependencies (env_id: {:?})",
        deps.dependencies.len(),
        deps.env_id
    );

    let mut kernel = kernel_state.lock().await;
    kernel
        .start_with_conda(app, &deps)
        .await
        .map_err(|e| e.to_string())
}

/// Start a default uv kernel with just Python (no extra deps).
/// Used as the default when no environment is configured.
#[tauri::command]
async fn start_default_uv_kernel(
    app: tauri::AppHandle,
    notebook_state: tauri::State<'_, Arc<Mutex<NotebookState>>>,
    kernel_state: tauri::State<'_, Arc<tokio::sync::Mutex<NotebookKernel>>>,
) -> Result<(), String> {
    // Ensure uv metadata exists in the notebook (for legacy notebooks)
    {
        let mut state = notebook_state.lock().map_err(|e| e.to_string())?;

        if !state.notebook.metadata.additional.contains_key("uv") {
            state.notebook.metadata.additional.insert(
                "uv".to_string(),
                serde_json::json!({
                    "dependencies": Vec::<String>::new(),
                }),
            );
            state.dirty = true;
        }
    }

    // Create minimal deps with just ipykernel
    let deps = uv_env::NotebookDependencies {
        dependencies: vec![],
        requires_python: None,
    };

    info!("Starting default uv kernel with ipykernel");

    let mut kernel = kernel_state.lock().await;
    kernel
        .start_with_uv(app, &deps)
        .await
        .map_err(|e| e.to_string())
}

/// Start a default conda kernel with just Python (no extra deps).
/// Used as fallback when no environment is configured.
/// Each notebook gets its own isolated environment via a unique env_id.
#[tauri::command]
async fn start_default_conda_kernel(
    app: tauri::AppHandle,
    notebook_state: tauri::State<'_, Arc<Mutex<NotebookState>>>,
    kernel_state: tauri::State<'_, Arc<tokio::sync::Mutex<NotebookKernel>>>,
) -> Result<(), String> {
    // Get the env_id for this notebook (should be set at notebook creation)
    // Fall back to creating one for legacy notebooks
    let env_id = {
        let mut state = notebook_state.lock().map_err(|e| e.to_string())?;

        // Check if there's already an env_id in the runt metadata
        let existing_id = state
            .notebook
            .metadata
            .additional
            .get("runt")
            .and_then(|v| v.get("env_id"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());

        match existing_id {
            Some(id) => id,
            None => {
                // Legacy notebook without env_id - generate one and set conda metadata
                let new_id = uuid::Uuid::new_v4().to_string();

                state.notebook.metadata.additional.insert(
                    "runt".to_string(),
                    serde_json::json!({ "env_id": new_id }),
                );

                if !state.notebook.metadata.additional.contains_key("conda") {
                    state.notebook.metadata.additional.insert(
                        "conda".to_string(),
                        serde_json::json!({
                            "dependencies": Vec::<String>::new(),
                            "channels": ["conda-forge"],
                        }),
                    );
                }

                state.dirty = true;
                new_id
            }
        }
    };

    // Create minimal deps with just ipykernel and the unique env_id
    let deps = conda_env::CondaDependencies {
        dependencies: vec!["ipykernel".to_string()],
        channels: vec!["conda-forge".to_string()],
        python: None,
        env_id: Some(env_id.clone()),
    };

    info!("Starting default conda kernel with ipykernel (env_id: {})", env_id);

    let mut kernel = kernel_state.lock().await;
    kernel
        .start_with_conda(app, &deps)
        .await
        .map_err(|e| e.to_string())
}

/// Start a default kernel, automatically choosing uv or conda based on availability.
/// Uses uv if available (faster), falls back to conda/rattler if not.
#[tauri::command]
async fn start_default_kernel(
    app: tauri::AppHandle,
    notebook_state: tauri::State<'_, Arc<Mutex<NotebookState>>>,
    kernel_state: tauri::State<'_, Arc<tokio::sync::Mutex<NotebookKernel>>>,
) -> Result<String, String> {
    if uv_env::check_uv_available().await {
        info!("uv is available, using uv for default kernel");

        // Ensure uv metadata exists in the notebook (for legacy notebooks)
        {
            let mut state = notebook_state.lock().map_err(|e| e.to_string())?;

            if !state.notebook.metadata.additional.contains_key("uv") {
                state.notebook.metadata.additional.insert(
                    "uv".to_string(),
                    serde_json::json!({
                        "dependencies": Vec::<String>::new(),
                    }),
                );
                state.dirty = true;
            }
        }

        // Create minimal deps with just ipykernel
        let deps = uv_env::NotebookDependencies {
            dependencies: vec![],
            requires_python: None,
        };

        let mut kernel = kernel_state.lock().await;
        kernel
            .start_with_uv(app, &deps)
            .await
            .map_err(|e| e.to_string())?;

        Ok("uv".to_string())
    } else {
        info!("uv not available, falling back to conda/rattler for default kernel");

        // Get the env_id for this notebook (should be set at notebook creation)
        // Fall back to creating one for legacy notebooks
        let env_id = {
            let mut state = notebook_state.lock().map_err(|e| e.to_string())?;

            // Check if there's already an env_id in the runt metadata
            let existing_id = state
                .notebook
                .metadata
                .additional
                .get("runt")
                .and_then(|v| v.get("env_id"))
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());

            match existing_id {
                Some(id) => id,
                None => {
                    // Legacy notebook without env_id - generate one and set conda metadata
                    let new_id = uuid::Uuid::new_v4().to_string();

                    state.notebook.metadata.additional.insert(
                        "runt".to_string(),
                        serde_json::json!({ "env_id": new_id }),
                    );

                    if !state.notebook.metadata.additional.contains_key("conda") {
                        state.notebook.metadata.additional.insert(
                            "conda".to_string(),
                            serde_json::json!({
                                "dependencies": Vec::<String>::new(),
                                "channels": ["conda-forge"],
                            }),
                        );
                    }

                    state.dirty = true;
                    new_id
                }
            }
        };

        // Create minimal deps with just ipykernel and the unique env_id
        let deps = conda_env::CondaDependencies {
            dependencies: vec!["ipykernel".to_string()],
            channels: vec!["conda-forge".to_string()],
            python: None,
            env_id: Some(env_id.clone()),
        };

        let mut kernel = kernel_state.lock().await;
        kernel
            .start_with_conda(app, &deps)
            .await
            .map_err(|e| e.to_string())?;

        Ok("conda".to_string())
    }
}

/// Check if the running kernel has a conda-managed environment.
#[tauri::command]
async fn kernel_has_conda_env(
    kernel_state: tauri::State<'_, Arc<tokio::sync::Mutex<NotebookKernel>>>,
) -> Result<bool, String> {
    let kernel = kernel_state.lock().await;
    Ok(kernel.has_conda_environment())
}

/// Sync dependencies to the running kernel's conda environment.
///
/// Note: For conda environments, this currently requires a kernel restart.
/// Returns true if sync was performed, false if no conda environment exists.
#[tauri::command]
async fn sync_conda_dependencies(
    notebook_state: tauri::State<'_, Arc<Mutex<NotebookState>>>,
    kernel_state: tauri::State<'_, Arc<tokio::sync::Mutex<NotebookKernel>>>,
) -> Result<bool, String> {
    let deps = {
        let state = notebook_state.lock().map_err(|e| e.to_string())?;
        conda_env::extract_dependencies(&state.notebook.metadata)
    };

    let Some(deps) = deps else {
        return Ok(false);
    };

    let kernel = kernel_state.lock().await;
    let Some(env) = kernel.conda_environment() else {
        return Ok(false);
    };

    info!("Syncing {} conda dependencies to kernel environment", deps.dependencies.len());

    // Note: This will return an error for now since conda sync requires restart
    conda_env::sync_dependencies(env, &deps)
        .await
        .map_err(|e| e.to_string())?;

    Ok(true)
}

// ============================================================================
// pyproject.toml Discovery and Environment Commands
// ============================================================================

/// Detect pyproject.toml near the notebook and return info about it.
#[tauri::command]
async fn detect_pyproject(
    state: tauri::State<'_, Arc<Mutex<NotebookState>>>,
) -> Result<Option<pyproject::PyProjectInfo>, String> {
    let notebook_path = {
        let state = state.lock().map_err(|e| e.to_string())?;
        state.path.clone()
    };

    // Need a notebook path to search from
    let Some(notebook_path) = notebook_path else {
        return Ok(None);
    };

    // Find pyproject.toml walking up from notebook directory
    let Some(pyproject_path) = pyproject::find_pyproject(&notebook_path) else {
        return Ok(None);
    };

    // Parse and create info
    let config = pyproject::parse_pyproject(&pyproject_path).map_err(|e| e.to_string())?;
    let info = pyproject::create_pyproject_info(&config, &notebook_path);

    info!(
        "Detected pyproject.toml at {} with {} dependencies",
        info.relative_path, info.dependency_count
    );

    Ok(Some(info))
}

/// Full pyproject dependencies for display in the UI.
#[derive(Serialize)]
struct PyProjectDepsJson {
    path: String,
    relative_path: String,
    project_name: Option<String>,
    dependencies: Vec<String>,
    dev_dependencies: Vec<String>,
    requires_python: Option<String>,
    index_url: Option<String>,
}

/// Get full parsed dependencies from the detected pyproject.toml.
#[tauri::command]
async fn get_pyproject_dependencies(
    state: tauri::State<'_, Arc<Mutex<NotebookState>>>,
) -> Result<Option<PyProjectDepsJson>, String> {
    let notebook_path = {
        let state = state.lock().map_err(|e| e.to_string())?;
        state.path.clone()
    };

    let Some(notebook_path) = notebook_path else {
        return Ok(None);
    };

    let Some(pyproject_path) = pyproject::find_pyproject(&notebook_path) else {
        return Ok(None);
    };

    let config = pyproject::parse_pyproject(&pyproject_path).map_err(|e| e.to_string())?;

    let relative_path = pathdiff::diff_paths(&config.path, notebook_path.parent().unwrap_or(&notebook_path))
        .map(|p| p.display().to_string())
        .unwrap_or_else(|| config.path.display().to_string());

    Ok(Some(PyProjectDepsJson {
        path: config.path.display().to_string(),
        relative_path,
        project_name: config.project_name,
        dependencies: config.dependencies,
        dev_dependencies: config.dev_dependencies,
        requires_python: config.requires_python,
        index_url: config.index_url,
    }))
}

/// Import dependencies from pyproject.toml into notebook metadata.
/// This makes the notebook more portable.
#[tauri::command]
async fn import_pyproject_dependencies(
    state: tauri::State<'_, Arc<Mutex<NotebookState>>>,
) -> Result<(), String> {
    let notebook_path = {
        let state = state.lock().map_err(|e| e.to_string())?;
        state.path.clone()
    };

    let Some(notebook_path) = notebook_path else {
        return Err("No notebook path set".to_string());
    };

    let Some(pyproject_path) = pyproject::find_pyproject(&notebook_path) else {
        return Err("No pyproject.toml found".to_string());
    };

    let config = pyproject::parse_pyproject(&pyproject_path).map_err(|e| e.to_string())?;

    // Merge pyproject deps into notebook metadata
    let mut state = state.lock().map_err(|e| e.to_string())?;

    let all_deps = pyproject::get_all_dependencies(&config);

    let uv_value = serde_json::json!({
        "dependencies": all_deps,
        "requires-python": config.requires_python,
    });

    state
        .notebook
        .metadata
        .additional
        .insert("uv".to_string(), uv_value);
    state.dirty = true;

    info!(
        "Imported {} dependencies from pyproject.toml into notebook",
        all_deps.len()
    );

    Ok(())
}

/// Start kernel using `uv run` in the project directory with pyproject.toml.
///
/// This delegates environment management to uv:
/// - uv auto-detects and uses the project's pyproject.toml
/// - Creates/updates .venv in the project directory
/// - Respects uv.lock if present
/// - Adds ipykernel transiently via --with
#[tauri::command]
async fn start_kernel_with_pyproject(
    app: tauri::AppHandle,
    notebook_state: tauri::State<'_, Arc<Mutex<NotebookState>>>,
    kernel_state: tauri::State<'_, Arc<tokio::sync::Mutex<NotebookKernel>>>,
) -> Result<(), String> {
    let notebook_path = {
        let state = notebook_state.lock().map_err(|e| e.to_string())?;
        state.path.clone()
    };

    let notebook_path = notebook_path.ok_or_else(|| "No notebook path set".to_string())?;

    let pyproject_path = pyproject::find_pyproject(&notebook_path)
        .ok_or_else(|| "No pyproject.toml found".to_string())?;

    // Get the project directory (parent of pyproject.toml)
    let project_dir = pyproject_path
        .parent()
        .ok_or_else(|| "Invalid pyproject.toml path".to_string())?;

    info!(
        "Starting kernel with uv run in project {}",
        project_dir.display()
    );

    let mut kernel = kernel_state.lock().await;
    kernel
        .start_with_uv_run(app, project_dir)
        .await
        .map_err(|e| e.to_string())
}

/// Run the notebook Tauri app.
///
/// If `notebook_path` is Some, opens that file. If None, creates a new empty notebook.
pub fn run(notebook_path: Option<PathBuf>) -> anyhow::Result<()> {
    env_logger::init();

    let initial_state = match notebook_path {
        Some(ref path) if path.exists() => {
            let content = std::fs::read_to_string(path)?;
            let nb = nbformat::parse_notebook(&content).map_err(|e| anyhow::anyhow!("{}", e))?;
            let nb_v4 = match nb {
                nbformat::Notebook::V4(nb) => nb,
                nbformat::Notebook::Legacy(legacy) => {
                    nbformat::upgrade_legacy_notebook(legacy)?
                }
            };
            NotebookState::from_notebook(nb_v4, path.clone())
        }
        Some(ref path) => {
            let mut state = NotebookState::new_empty();
            state.path = Some(path.clone());
            state
        }
        None => NotebookState::new_empty(),
    };

    let window_title = notebook_path
        .as_ref()
        .and_then(|p| p.file_name())
        .and_then(|n| n.to_str())
        .unwrap_or("Untitled.ipynb")
        .to_string();

    // Create execution queue and command sender
    let queue: SharedExecutionQueue = Arc::new(Mutex::new(ExecutionQueue::default()));
    let notebook_state = Arc::new(Mutex::new(initial_state));
    let kernel_state = Arc::new(tokio::sync::Mutex::new(NotebookKernel::default()));

    // Clone for setup closure
    let queue_for_processor = queue.clone();
    let notebook_for_processor = notebook_state.clone();
    let kernel_for_processor = kernel_state.clone();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(notebook_state)
        .manage(kernel_state)
        .manage(queue)
        .invoke_handler(tauri::generate_handler![
            load_notebook,
            has_notebook_path,
            get_notebook_path,
            save_notebook,
            save_notebook_as,
            open_notebook_in_new_window,
            update_cell_source,
            add_cell,
            delete_cell,
            execute_cell,
            queue_execute_cell,
            clear_execution_queue,
            get_execution_queue_state,
            start_kernel,
            interrupt_kernel,
            shutdown_kernel,
            send_shell_message,
            complete,
            get_history,
            get_preferred_kernelspec,
            list_kernelspecs,
            // UV dependency management
            check_uv_available,
            get_notebook_dependencies,
            set_notebook_dependencies,
            add_dependency,
            remove_dependency,
            start_kernel_with_uv,
            start_default_uv_kernel,
            is_kernel_running,
            kernel_has_uv_env,
            sync_kernel_dependencies,
            // Conda dependency management
            get_conda_dependencies,
            set_conda_dependencies,
            add_conda_dependency,
            remove_conda_dependency,
            start_kernel_with_conda,
            start_default_conda_kernel,
            start_default_kernel,
            kernel_has_conda_env,
            sync_conda_dependencies,
            // pyproject.toml discovery
            detect_pyproject,
            get_pyproject_dependencies,
            import_pyproject_dependencies,
            start_kernel_with_pyproject,
            // Debug info
            get_git_info,
        ])
        .setup(move |app| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_title(&window_title);
            }
            // Set up native menu bar
            let menu = crate::menu::create_menu(app.handle())?;
            app.set_menu(menu)?;

            // Spawn the execution queue processor
            let app_handle = app.handle().clone();
            let queue_tx = execution_queue::spawn_queue_processor(
                app_handle,
                queue_for_processor,
                notebook_for_processor,
                kernel_for_processor.clone(),
            );

            // Store the queue sender in Tauri state for commands to use
            app.manage(queue_tx.clone());

            // Set the queue sender on the kernel so iopub can signal completion
            let kernel_for_tx = kernel_for_processor.clone();
            let tx_for_kernel = queue_tx.clone();
            tauri::async_runtime::spawn(async move {
                let mut kernel = kernel_for_tx.lock().await;
                kernel.set_queue_tx(tx_for_kernel);
            });

            Ok(())
        })
        .on_menu_event(|app, event| {
            match event.id().as_ref() {
                crate::menu::MENU_NEW_NOTEBOOK => {
                    // Spawn new process with no file argument
                    if let Ok(exe) = std::env::current_exe() {
                        let _ = std::process::Command::new(exe).spawn();
                    }
                }
                crate::menu::MENU_OPEN => {
                    // Emit event to frontend to trigger open dialog
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.emit("menu:open", ());
                    }
                }
                crate::menu::MENU_SAVE => {
                    // Emit event to frontend to trigger save
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.emit("menu:save", ());
                    }
                }
                _ => {}
            }
        })
        .run(tauri::generate_context!())
        .map_err(|e| anyhow::anyhow!("Tauri error: {}", e))
}
