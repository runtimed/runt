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

    // Re-run if git HEAD changes (detects branch switches).
    // .git/HEAD contains a symbolic ref like "ref: refs/heads/main",
    // so it only changes when you switch branches.
    println!("cargo:rerun-if-changed=../../.git/HEAD");

    // Also track the ref that HEAD points to (detects new commits on the
    // current branch). When HEAD is "ref: refs/heads/main", new commits
    // update .git/refs/heads/main but NOT .git/HEAD itself.
    if let Ok(head) = std::fs::read_to_string("../../.git/HEAD") {
        let head = head.trim();
        if let Some(refpath) = head.strip_prefix("ref: ") {
            println!("cargo:rerun-if-changed=../../.git/{}", refpath);
        }
    }

    // Packed-refs is updated when git packs loose refs or during fetch/gc.
    // A ref might only exist here (not as a loose file), so track it too.
    println!("cargo:rerun-if-changed=../../.git/packed-refs");
}
