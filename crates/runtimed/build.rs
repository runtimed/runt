use std::process::Command;

fn main() {
    // Capture short commit hash for version-mismatch detection.
    // This ensures the daemon gets restarted when the binary changes,
    // even if the crate version (Cargo.toml) hasn't been bumped.
    let commit = Command::new("git")
        .args(["rev-parse", "--short=7", "HEAD"])
        .output()
        .ok()
        .and_then(|o| String::from_utf8(o.stdout).ok())
        .map(|s| s.trim().to_string())
        .unwrap_or_else(|| "unknown".to_string());

    println!("cargo:rustc-env=GIT_COMMIT={}", commit);

    // Re-run if git HEAD changes (detects branch switches, commits)
    println!("cargo:rerun-if-changed=../../.git/HEAD");
    println!("cargo:rerun-if-changed=../../.git/index");
}
