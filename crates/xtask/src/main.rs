use std::env;
use std::fs;
use std::path::Path;
use std::process::{exit, Command};

fn main() {
    let args: Vec<String> = env::args().skip(1).collect();

    if args.is_empty() {
        print_help();
        exit(0);
    }

    match args[0].as_str() {
        "dev" => cmd_dev(),
        "build" => cmd_build(),
        "run" => {
            let notebook = args.get(1).map(String::as_str);
            cmd_run(notebook);
        }
        "icons" => {
            let source = args.get(1).map(String::as_str);
            cmd_icons(source);
        }
        "build-e2e" => cmd_build_e2e(),
        "build-dmg" => cmd_build_dmg(),
        "build-app" => cmd_build_app(),
        "install-daemon" => cmd_install_daemon(),
        "--help" | "-h" | "help" => print_help(),
        cmd => {
            eprintln!("Unknown command: {cmd}");
            eprintln!();
            print_help();
            exit(1);
        }
    }
}

fn print_help() {
    eprintln!(
        "Usage: cargo xtask <COMMAND>

Development:
  dev                   Start hot-reload dev server
  build                 Quick debug build (no DMG)
  build-e2e             Debug build with built-in WebDriver server
  run [notebook.ipynb]  Build and run debug app

Release:
  build-app             Build .app bundle with icons
  build-dmg             Build DMG with icons (for CI)

Daemon:
  install-daemon        Build and install runtimed into the running service

Other:
  icons [source.png]    Generate icon variants
  help                  Show this help
"
    );
}

fn cmd_dev() {
    println!("Starting dev server with hot reload...");
    run_cmd("cargo", &["tauri", "dev", "--", "-p", "notebook"]);
}

fn cmd_build() {
    // Build runtimed daemon binary for bundling
    build_runtimed_daemon();

    // pnpm build runs: isolated-renderer + sidecar + notebook
    println!("Building frontend (isolated-renderer, sidecar, notebook)...");
    run_cmd("pnpm", &["build"]);

    println!("Building debug binary (no bundle)...");
    run_cmd(
        "cargo",
        &[
            "tauri",
            "build",
            "--debug",
            "--no-bundle",
            "--config",
            r#"{"build":{"beforeBuildCommand":""}}"#,
        ],
    );

    println!("Build complete: ./target/debug/notebook");
}

fn cmd_run(notebook: Option<&str>) {
    cmd_build();

    println!("Running notebook app...");
    match notebook {
        Some(path) => run_cmd("./target/debug/notebook", &[path]),
        None => run_cmd("./target/debug/notebook", &[]),
    }
}

fn cmd_build_e2e() {
    // Build runtimed daemon binary for bundling
    build_runtimed_daemon();

    // pnpm build runs: isolated-renderer + sidecar + notebook
    println!("Building frontend (isolated-renderer, sidecar, notebook)...");
    run_cmd("pnpm", &["build"]);

    println!("Building debug binary with WebDriver server...");
    run_cmd(
        "cargo",
        &[
            "tauri",
            "build",
            "--debug",
            "--no-bundle",
            "--features",
            "webdriver-test",
            "--config",
            r#"{"build":{"beforeBuildCommand":""}}"#,
        ],
    );

    println!("Build complete: ./target/debug/notebook");
    println!("Run with: ./target/debug/notebook --webdriver-port 4444");
}

fn cmd_icons(source: Option<&str>) {
    let default_source = "crates/notebook/icons/source.png";
    let source_path = source.unwrap_or(default_source);

    if !Path::new(source_path).exists() {
        eprintln!("Source icon not found: {source_path}");
        eprintln!("Export your icon from Figma to this location.");
        exit(1);
    }

    let output_dir = "crates/notebook/icons";

    println!("Generating icons from {source_path}...");
    run_cmd(
        "cargo",
        &["tauri", "icon", source_path, "--output", output_dir],
    );
    println!("Icons generated in {output_dir}/");
}

fn cmd_build_dmg() {
    build_with_bundle("dmg");
}

fn cmd_build_app() {
    build_with_bundle("app");
}

fn build_with_bundle(bundle: &str) {
    // Generate icons if source exists
    let source_path = "crates/notebook/icons/source.png";
    if Path::new(source_path).exists() {
        cmd_icons(None);
    } else {
        println!("Skipping icon generation (no source.png found)");
    }

    // Build runtimed daemon binary for bundling
    build_runtimed_daemon();

    // Build frontend
    println!("Building frontend...");
    run_cmd("pnpm", &["build"]);

    // Build Tauri app
    println!("Building Tauri app ({bundle} bundle)...");
    run_cmd(
        "cargo",
        &[
            "tauri",
            "build",
            "--bundles",
            bundle,
            "--config",
            r#"{"build":{"beforeBuildCommand":""}}"#,
        ],
    );

    println!("Build complete!");
}

/// Build runtimed and install it into the running launchd/systemd service.
///
/// This is the dev workflow for testing daemon changes:
/// 1. Build runtimed in release mode
/// 2. Stop the running service
/// 3. Copy the new binary over the installed one
/// 4. Restart the service
fn cmd_install_daemon() {
    println!("Building runtimed (release)...");
    run_cmd("cargo", &["build", "--release", "-p", "runtimed"]);

    let source = if cfg!(windows) {
        "target/release/runtimed.exe"
    } else {
        "target/release/runtimed"
    };

    if !Path::new(source).exists() {
        eprintln!("Build succeeded but binary not found at {source}");
        exit(1);
    }

    // Use runtimed's own service manager to perform the upgrade.
    // The `runtimed install` CLI already handles stop → copy → chmod → start.
    // We call `runtimed upgrade --from <source>` if available, otherwise
    // fall back to the manual stop/copy/start dance.
    println!("Installing daemon...");

    // Stop the running daemon gracefully
    #[cfg(target_os = "macos")]
    {
        let uid = Command::new("id")
            .args(["-u"])
            .output()
            .ok()
            .and_then(|o| String::from_utf8(o.stdout).ok())
            .map(|s| s.trim().to_string())
            .unwrap_or_else(|| "501".to_string());
        let domain = format!("gui/{uid}/io.runtimed");

        // Stop (ignore errors — may not be running)
        let _ = Command::new("launchctl")
            .args(["bootout", &domain])
            .status();

        // Brief pause for process cleanup
        std::thread::sleep(std::time::Duration::from_secs(1));
    }

    #[cfg(target_os = "linux")]
    {
        let _ = Command::new("systemctl")
            .args(["--user", "stop", "runtimed.service"])
            .status();
        std::thread::sleep(std::time::Duration::from_secs(1));
    }

    // Determine install path (matches runtimed::service::default_binary_path)
    let install_dir = dirs::data_local_dir()
        .expect("Could not determine data directory")
        .join("runt")
        .join("bin");

    let install_path = if cfg!(windows) {
        install_dir.join("runtimed.exe")
    } else {
        install_dir.join("runtimed")
    };

    if !install_path.exists() {
        eprintln!(
            "No existing daemon installation found at {}",
            install_path.display()
        );
        eprintln!("Run the app once first to install the daemon service.");
        exit(1);
    }

    // Copy new binary
    fs::copy(source, &install_path).unwrap_or_else(|e| {
        eprintln!("Failed to copy binary: {e}");
        exit(1);
    });

    // Make executable on Unix
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&install_path, fs::Permissions::from_mode(0o755)).unwrap_or_else(|e| {
            eprintln!("Failed to set permissions: {e}");
            exit(1);
        });
    }

    println!("Installed to {}", install_path.display());

    // Restart the service
    #[cfg(target_os = "macos")]
    {
        let plist = dirs::home_dir()
            .expect("No home dir")
            .join("Library/LaunchAgents/io.runtimed.plist");
        if plist.exists() {
            let uid = Command::new("id")
                .args(["-u"])
                .output()
                .ok()
                .and_then(|o| String::from_utf8(o.stdout).ok())
                .map(|s| s.trim().to_string())
                .unwrap_or_else(|| "501".to_string());
            let domain = format!("gui/{uid}");
            run_cmd(
                "launchctl",
                &["bootstrap", &domain, &plist.to_string_lossy()],
            );
        } else {
            eprintln!("Warning: launchd plist not found at {}", plist.display());
            eprintln!("Start manually with: {}", install_path.display());
        }
    }

    #[cfg(target_os = "linux")]
    {
        run_cmd("systemctl", &["--user", "start", "runtimed.service"]);
    }

    // Wait briefly and verify
    std::thread::sleep(std::time::Duration::from_secs(2));
    let daemon_json = dirs::cache_dir()
        .unwrap_or_else(|| Path::new("/tmp").to_path_buf())
        .join("runt")
        .join("daemon.json");

    if daemon_json.exists() {
        if let Ok(contents) = fs::read_to_string(&daemon_json) {
            if let Ok(info) = serde_json::from_str::<serde_json::Value>(&contents) {
                if let Some(version) = info.get("version").and_then(|v| v.as_str()) {
                    println!("Daemon running: version {version}");
                    return;
                }
            }
        }
    }

    println!("Daemon restarted (could not verify version from daemon.json)");
}

/// Build external binaries (runtimed daemon and runt CLI) for Tauri bundling.
fn build_runtimed_daemon() {
    build_external_binary("runtimed", "runtimed");
    build_external_binary("runt-cli", "runt");
}

/// Build a binary and copy to binaries/ with target triple suffix for Tauri bundling.
fn build_external_binary(package: &str, binary_name: &str) {
    println!("Building {binary_name}...");

    // Get the host target triple
    let target = get_host_target();

    // Build in release mode for smaller binary
    run_cmd("cargo", &["build", "--release", "-p", package]);

    // Determine source and destination paths
    let source = if cfg!(windows) {
        format!("target/release/{binary_name}.exe")
    } else {
        format!("target/release/{binary_name}")
    };

    let dest_name = if cfg!(windows) {
        format!("{binary_name}-{target}.exe")
    } else {
        format!("{binary_name}-{target}")
    };

    // Copy to crates/notebook/binaries/ for Tauri bundle builds
    let binaries_dir = Path::new("crates/notebook/binaries");
    let dest = binaries_dir.join(&dest_name);
    fs::copy(&source, &dest).unwrap_or_else(|e| {
        eprintln!("Failed to copy {binary_name} binary: {e}");
        exit(1);
    });
    println!("{binary_name} ready: {}", dest.display());

    // Also copy to target/debug/binaries/ for development (no-bundle builds)
    // Tauri's externalBin only copies to app bundle, not for --no-bundle
    let dev_binaries_dir = Path::new("target/debug/binaries");
    fs::create_dir_all(dev_binaries_dir).ok();
    let dev_dest = dev_binaries_dir.join(&dest_name);
    fs::copy(&source, &dev_dest).unwrap_or_else(|e| {
        eprintln!("Failed to copy {binary_name} to dev binaries: {e}");
        exit(1);
    });
    println!("{binary_name} dev ready: {}", dev_dest.display());
}

/// Get the host target triple (e.g., aarch64-apple-darwin).
fn get_host_target() -> String {
    let output = Command::new("rustc")
        .args(["--print", "host-tuple"])
        .output()
        .expect("Failed to get host target from rustc");

    String::from_utf8(output.stdout)
        .expect("Invalid UTF-8 from rustc")
        .trim()
        .to_string()
}

fn run_cmd(cmd: &str, args: &[&str]) {
    let status = Command::new(cmd).args(args).status().unwrap_or_else(|e| {
        eprintln!("Failed to run {cmd}: {e}");
        exit(1);
    });

    if !status.success() {
        eprintln!("Command failed: {cmd} {}", args.join(" "));
        exit(status.code().unwrap_or(1));
    }
}
