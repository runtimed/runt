use std::path::PathBuf;

fn main() {
    let path = std::env::args().nth(1).map(PathBuf::from);
    notebook::run(path).expect("notebook app failed");
}
