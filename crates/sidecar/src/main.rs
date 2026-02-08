use anyhow::Result;
use clap::Parser;
use std::path::PathBuf;

#[derive(Parser)]
#[clap(name = "sidecar", version = "0.1.0", author = "Kyle Kelley")]
struct Cli {
    /// connection file to a jupyter kernel
    file: PathBuf,

    /// Suppress output
    #[clap(short, long)]
    quiet: bool,

    /// Dump all messages to a JSON file
    #[clap(long)]
    dump: Option<PathBuf>,
}

fn main() -> Result<()> {
    let args = Cli::parse();
    sidecar::launch(&args.file, args.quiet, args.dump.as_deref())
}
