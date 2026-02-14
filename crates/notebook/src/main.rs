use clap::Parser;
use notebook::Runtime;
use std::path::PathBuf;

#[derive(Parser, Debug)]
#[command(name = "notebook", about = "Runt Notebook - Interactive computing environment")]
struct Args {
    /// Path to notebook file to open or create
    path: Option<PathBuf>,

    /// Runtime for new notebooks (python, deno)
    #[arg(long, short, default_value = "python")]
    runtime: Runtime,
}

fn main() {
    let args = Args::parse();
    notebook::run(args.path, args.runtime).expect("notebook app failed");
}
