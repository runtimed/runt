use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Wry};

// Menu item IDs for new notebook types
pub const MENU_NEW_PYTHON_NOTEBOOK: &str = "new_python_notebook";
pub const MENU_NEW_DENO_NOTEBOOK: &str = "new_deno_notebook";
pub const MENU_OPEN: &str = "open";
pub const MENU_SAVE: &str = "save";
pub const MENU_CLONE_NOTEBOOK: &str = "clone_notebook";

// Menu item IDs for zoom
pub const MENU_ZOOM_IN: &str = "zoom_in";
pub const MENU_ZOOM_OUT: &str = "zoom_out";
pub const MENU_ZOOM_RESET: &str = "zoom_reset";

// Menu item IDs for kernel operations
pub const MENU_RUN_ALL_CELLS: &str = "run_all_cells";
pub const MENU_RESTART_AND_RUN_ALL: &str = "restart_and_run_all";

// Menu item IDs for CLI installation
pub const MENU_INSTALL_CLI: &str = "install_cli";

/// Build the application menu bar
pub fn create_menu(app: &AppHandle) -> tauri::Result<Menu<Wry>> {
    let menu = Menu::new(app)?;

    // App menu (macOS standard - shows app name)
    let app_menu = Submenu::new(app, "runt-notebook", true)?;
    app_menu.append(&PredefinedMenuItem::about(app, Some("runt-notebook"), None)?)?;
    app_menu.append(&PredefinedMenuItem::separator(app)?)?;
    app_menu.append(&MenuItem::with_id(
        app,
        MENU_INSTALL_CLI,
        "Install 'runt' Command in PATH...",
        true,
        None::<&str>,
    )?)?;
    app_menu.append(&PredefinedMenuItem::separator(app)?)?;
    app_menu.append(&PredefinedMenuItem::services(app, None)?)?;
    app_menu.append(&PredefinedMenuItem::separator(app)?)?;
    app_menu.append(&PredefinedMenuItem::hide(app, None)?)?;
    app_menu.append(&PredefinedMenuItem::hide_others(app, None)?)?;
    app_menu.append(&PredefinedMenuItem::show_all(app, None)?)?;
    app_menu.append(&PredefinedMenuItem::separator(app)?)?;
    app_menu.append(&PredefinedMenuItem::quit(app, None)?)?;
    menu.append(&app_menu)?;

    // File menu
    let file_menu = Submenu::new(app, "File", true)?;

    // New Notebook submenu with Python and Deno options
    let new_notebook_submenu = Submenu::new(app, "New Notebook", true)?;
    new_notebook_submenu.append(&MenuItem::with_id(
        app,
        MENU_NEW_PYTHON_NOTEBOOK,
        "Python",
        true,
        Some("CmdOrCtrl+N"),
    )?)?;
    new_notebook_submenu.append(&MenuItem::with_id(
        app,
        MENU_NEW_DENO_NOTEBOOK,
        "Deno (TypeScript)",
        true,
        Some("CmdOrCtrl+Shift+N"),
    )?)?;
    file_menu.append(&new_notebook_submenu)?;

    file_menu.append(&MenuItem::with_id(
        app,
        MENU_OPEN,
        "Open...",
        true,
        Some("CmdOrCtrl+O"),
    )?)?;
    file_menu.append(&PredefinedMenuItem::separator(app)?)?;
    file_menu.append(&MenuItem::with_id(
        app,
        MENU_SAVE,
        "Save",
        true,
        Some("CmdOrCtrl+S"),
    )?)?;
    file_menu.append(&MenuItem::with_id(
        app,
        MENU_CLONE_NOTEBOOK,
        "Clone Notebook...",
        true,
        None::<&str>,
    )?)?;
    menu.append(&file_menu)?;

    // Edit menu (standard text editing)
    let edit_menu = Submenu::new(app, "Edit", true)?;
    edit_menu.append(&PredefinedMenuItem::undo(app, None)?)?;
    edit_menu.append(&PredefinedMenuItem::redo(app, None)?)?;
    edit_menu.append(&PredefinedMenuItem::separator(app)?)?;
    edit_menu.append(&PredefinedMenuItem::cut(app, None)?)?;
    edit_menu.append(&PredefinedMenuItem::copy(app, None)?)?;
    edit_menu.append(&PredefinedMenuItem::paste(app, None)?)?;
    edit_menu.append(&PredefinedMenuItem::select_all(app, None)?)?;
    menu.append(&edit_menu)?;

    // Kernel menu
    let kernel_menu = Submenu::new(app, "Kernel", true)?;
    kernel_menu.append(&MenuItem::with_id(
        app,
        MENU_RUN_ALL_CELLS,
        "Run All Cells",
        true,
        None::<&str>,
    )?)?;
    kernel_menu.append(&MenuItem::with_id(
        app,
        MENU_RESTART_AND_RUN_ALL,
        "Restart & Run All Cells",
        true,
        None::<&str>,
    )?)?;
    menu.append(&kernel_menu)?;

    // View menu
    let view_menu = Submenu::new(app, "View", true)?;
    view_menu.append(&MenuItem::with_id(
        app,
        MENU_ZOOM_IN,
        "Zoom In",
        true,
        Some("CmdOrCtrl+="),
    )?)?;
    view_menu.append(&MenuItem::with_id(
        app,
        MENU_ZOOM_OUT,
        "Zoom Out",
        true,
        Some("CmdOrCtrl+-"),
    )?)?;
    view_menu.append(&MenuItem::with_id(
        app,
        MENU_ZOOM_RESET,
        "Actual Size",
        true,
        Some("CmdOrCtrl+0"),
    )?)?;
    menu.append(&view_menu)?;

    // Window menu
    let window_menu = Submenu::new(app, "Window", true)?;
    window_menu.append(&PredefinedMenuItem::minimize(app, None)?)?;
    window_menu.append(&PredefinedMenuItem::close_window(app, None)?)?;
    menu.append(&window_menu)?;

    Ok(menu)
}
