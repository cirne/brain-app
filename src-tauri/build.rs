#[path = "build/embed.rs"]
mod embed;

fn main() {
    println!("cargo:rerun-if-changed=build/embed.rs");
    embed::run();
    tauri_build::build();
}
