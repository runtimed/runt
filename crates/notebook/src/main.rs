use clap::Parser;
use notebook::Runtime;
use std::path::PathBuf;

#[derive(Parser, Debug)]
#[command(name = "notebook", about = "Runt Notebook - Interactive computing environment")]
struct Args {
    /// Path to notebook file to open or create
    path: Option<PathBuf>,

    /// Runtime for new notebooks (python, deno). Falls back to user settings if not specified.
    #[arg(long, short)]
    runtime: Option<Runtime>,
}

fn main() {
    let args = Args::parse();
    notebook::run(args.path, args.runtime).expect("notebook app failed");
}
