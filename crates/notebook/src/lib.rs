pub mod conda_env;
pub mod kernel;
pub mod notebook_state;
pub mod uv_env;

use notebook_state::{FrontendCell, NotebookState};
use kernel::{CompletionResult, NotebookKernel};

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Mutex;
use log::info;
use tauri::Manager;

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
    state: tauri::State<'_, Mutex<NotebookState>>,
) -> Result<Vec<FrontendCell>, String> {
    let state = state.lock().map_err(|e| e.to_string())?;
    Ok(state.cells_for_frontend())
}

#[tauri::command]
async fn save_notebook(
    state: tauri::State<'_, Mutex<NotebookState>>,
) -> Result<(), String> {
    let mut state = state.lock().map_err(|e| e.to_string())?;
    let path = state
        .path
        .clone()
        .ok_or_else(|| "No file path set".to_string())?;
    let content = state.serialize()?;
    std::fs::write(&path, &content).map_err(|e| e.to_string())?;
    state.dirty = false;
    Ok(())
}

#[tauri::command]
async fn update_cell_source(
    cell_id: String,
    source: String,
    state: tauri::State<'_, Mutex<NotebookState>>,
) -> Result<(), String> {
    let mut state = state.lock().map_err(|e| e.to_string())?;
    state.update_cell_source(&cell_id, &source);
    Ok(())
}

#[tauri::command]
async fn add_cell(
    cell_type: String,
    after_cell_id: Option<String>,
    state: tauri::State<'_, Mutex<NotebookState>>,
) -> Result<FrontendCell, String> {
    let mut state = state.lock().map_err(|e| e.to_string())?;
    state
        .add_cell(&cell_type, after_cell_id.as_deref())
        .ok_or_else(|| format!("Invalid cell type: {}", cell_type))
}

#[tauri::command]
async fn delete_cell(
    cell_id: String,
    state: tauri::State<'_, Mutex<NotebookState>>,
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
    state: tauri::State<'_, Mutex<NotebookState>>,
    kernel_state: tauri::State<'_, tokio::sync::Mutex<NotebookKernel>>,
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

#[tauri::command]
async fn start_kernel(
    kernelspec_name: String,
    app: tauri::AppHandle,
    kernel_state: tauri::State<'_, tokio::sync::Mutex<NotebookKernel>>,
) -> Result<(), String> {
    let mut kernel = kernel_state.lock().await;
    kernel
        .start(app, &kernelspec_name)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn interrupt_kernel(
    kernel_state: tauri::State<'_, tokio::sync::Mutex<NotebookKernel>>,
) -> Result<(), String> {
    let kernel = kernel_state.lock().await;
    kernel.interrupt().await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn send_shell_message(
    message: serde_json::Value,
    kernel_state: tauri::State<'_, tokio::sync::Mutex<NotebookKernel>>,
) -> Result<(), String> {
    let mut kernel = kernel_state.lock().await;
    kernel
        .send_shell_message(message)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_preferred_kernelspec(
    state: tauri::State<'_, Mutex<NotebookState>>,
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
    kernel_state: tauri::State<'_, tokio::sync::Mutex<NotebookKernel>>,
) -> Result<CompletionResult, String> {
    let mut kernel = kernel_state.lock().await;
    kernel
        .complete(&code, cursor_pos)
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
    state: tauri::State<'_, Mutex<NotebookState>>,
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
    state: tauri::State<'_, Mutex<NotebookState>>,
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
    state: tauri::State<'_, Mutex<NotebookState>>,
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
    state: tauri::State<'_, Mutex<NotebookState>>,
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
    notebook_state: tauri::State<'_, Mutex<NotebookState>>,
    kernel_state: tauri::State<'_, tokio::sync::Mutex<NotebookKernel>>,
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
    kernel_state: tauri::State<'_, tokio::sync::Mutex<NotebookKernel>>,
) -> Result<bool, String> {
    let kernel = kernel_state.lock().await;
    Ok(kernel.is_running())
}

/// Check if the running kernel has a uv-managed environment.
#[tauri::command]
async fn kernel_has_uv_env(
    kernel_state: tauri::State<'_, tokio::sync::Mutex<NotebookKernel>>,
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
    notebook_state: tauri::State<'_, Mutex<NotebookState>>,
    kernel_state: tauri::State<'_, tokio::sync::Mutex<NotebookKernel>>,
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
    state: tauri::State<'_, Mutex<NotebookState>>,
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
    state: tauri::State<'_, Mutex<NotebookState>>,
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
    state: tauri::State<'_, Mutex<NotebookState>>,
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
    state: tauri::State<'_, Mutex<NotebookState>>,
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
    notebook_state: tauri::State<'_, Mutex<NotebookState>>,
    kernel_state: tauri::State<'_, tokio::sync::Mutex<NotebookKernel>>,
) -> Result<(), String> {
    let deps = {
        let state = notebook_state.lock().map_err(|e| e.to_string())?;
        conda_env::extract_dependencies(&state.notebook.metadata)
    };

    let deps = deps.ok_or_else(|| "No conda dependencies in notebook metadata".to_string())?;

    info!(
        "Starting conda-managed kernel with {} dependencies",
        deps.dependencies.len()
    );

    let mut kernel = kernel_state.lock().await;
    kernel
        .start_with_conda(app, &deps)
        .await
        .map_err(|e| e.to_string())
}

/// Check if the running kernel has a conda-managed environment.
#[tauri::command]
async fn kernel_has_conda_env(
    kernel_state: tauri::State<'_, tokio::sync::Mutex<NotebookKernel>>,
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
    notebook_state: tauri::State<'_, Mutex<NotebookState>>,
    kernel_state: tauri::State<'_, tokio::sync::Mutex<NotebookKernel>>,
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

    tauri::Builder::default()
        .manage(Mutex::new(initial_state))
        .manage(tokio::sync::Mutex::new(NotebookKernel::default()))
        .invoke_handler(tauri::generate_handler![
            load_notebook,
            save_notebook,
            update_cell_source,
            add_cell,
            delete_cell,
            execute_cell,
            start_kernel,
            interrupt_kernel,
            send_shell_message,
            complete,
            get_preferred_kernelspec,
            list_kernelspecs,
            // UV dependency management
            check_uv_available,
            get_notebook_dependencies,
            set_notebook_dependencies,
            add_dependency,
            remove_dependency,
            start_kernel_with_uv,
            is_kernel_running,
            kernel_has_uv_env,
            sync_kernel_dependencies,
            // Conda dependency management
            get_conda_dependencies,
            set_conda_dependencies,
            add_conda_dependency,
            remove_conda_dependency,
            start_kernel_with_conda,
            kernel_has_conda_env,
            sync_conda_dependencies,
            // Debug info
            get_git_info,
        ])
        .setup(move |app| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_title(&window_title);
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .map_err(|e| anyhow::anyhow!("Tauri error: {}", e))
}
