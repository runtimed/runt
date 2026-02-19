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
        "watch-isolated" => cmd_watch_isolated(),
        "icons" => {
            let source = args.get(1).map(String::as_str);
            cmd_icons(source);
        }
        "build-dmg" => cmd_build_dmg(),
        "build-app" => cmd_build_app(),
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
  run [notebook.ipynb]  Build and run debug app
  watch-isolated        Watch and rebuild isolated renderer

Release:
  build-app             Build .app bundle with icons
  build-dmg             Build DMG with icons (for CI)

Other:
  icons [source.png]    Generate icon variants
  help                  Show this help
"
    );
}

fn cmd_dev() {
    // Build isolated renderer first (separate IIFE bundle, not part of Vite dev server)
    println!("Building isolated renderer...");
    run_cmd("pnpm", &["run", "isolated-renderer:build"]);

    println!("Starting dev server with hot reload...");
    run_cmd("cargo", &["tauri", "dev", "--", "-p", "notebook"]);
}

fn cmd_watch_isolated() {
    println!("Watching isolated renderer for changes...");
    println!("Reload app or open new notebook to see changes.");
    run_cmd(
        "pnpm",
        &[
            "vite",
            "build",
            "--watch",
            "--config",
            "src/isolated-renderer/vite.config.ts",
        ],
    );
}

fn cmd_build() {
    // Build runtimed daemon binary for bundling
    build_runtimed_sidecar();

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
    build_runtimed_sidecar();

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

/// Build runtimed and copy to binaries/ with target triple suffix for Tauri bundling.
fn build_runtimed_sidecar() {
    println!("Building runtimed daemon...");

    // Get the host target triple
    let target = get_host_target();

    // Build runtimed in release mode for smaller binary
    run_cmd("cargo", &["build", "--release", "-p", "runtimed"]);

    // Determine source and destination paths
    let source = if cfg!(windows) {
        "target/release/runtimed.exe"
    } else {
        "target/release/runtimed"
    };

    let binary_name = if cfg!(windows) {
        format!("runtimed-{}.exe", target)
    } else {
        format!("runtimed-{}", target)
    };

    // Copy to crates/notebook/binaries/ for Tauri bundle builds
    let binaries_dir = Path::new("crates/notebook/binaries");
    let dest = binaries_dir.join(&binary_name);
    fs::copy(source, &dest).unwrap_or_else(|e| {
        eprintln!("Failed to copy runtimed binary: {e}");
        exit(1);
    });
    println!("runtimed sidecar ready: {}", dest.display());

    // Also copy to target/debug/binaries/ for development (no-bundle builds)
    // Tauri's externalBin only copies to app bundle, not for --no-bundle
    let dev_binaries_dir = Path::new("target/debug/binaries");
    fs::create_dir_all(dev_binaries_dir).ok();
    let dev_dest = dev_binaries_dir.join(&binary_name);
    fs::copy(source, &dev_dest).unwrap_or_else(|e| {
        eprintln!("Failed to copy runtimed to dev binaries: {e}");
        exit(1);
    });
    println!("runtimed dev sidecar ready: {}", dev_dest.display());
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
    let status = Command::new(cmd)
        .args(args)
        .status()
        .unwrap_or_else(|e| {
            eprintln!("Failed to run {cmd}: {e}");
            exit(1);
        });

    if !status.success() {
        eprintln!("Command failed: {cmd} {}", args.join(" "));
        exit(status.code().unwrap_or(1));
    }
}
