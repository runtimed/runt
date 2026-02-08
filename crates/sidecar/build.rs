use std::path::Path;

fn main() {
    let ui_dist = Path::new("../../packages/sidecar-ui/dist");
    let index_html = ui_dist.join("index.html");

    // Tell Cargo to rerun this build script if the dist folder changes
    println!("cargo:rerun-if-changed=../../packages/sidecar-ui/dist");

    if !index_html.exists() {
        eprintln!();
        eprintln!("╭─────────────────────────────────────────────────────────────╮");
        eprintln!("│                                                             │");
        eprintln!("│  ERROR: UI assets not found!                                │");
        eprintln!("│                                                             │");
        eprintln!("│  The sidecar UI must be built before compiling.             │");
        eprintln!("│  Run the following commands:                                │");
        eprintln!("│                                                             │");
        eprintln!("│    cd packages/sidecar-ui                                   │");
        eprintln!("│    pnpm install                                             │");
        eprintln!("│    pnpm run build                                           │");
        eprintln!("│                                                             │");
        eprintln!("╰─────────────────────────────────────────────────────────────╯");
        eprintln!();
        panic!("UI dist folder not found. See instructions above.");
    }
}
