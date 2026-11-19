fn main() -> Result<(), Box<dyn std::error::Error>> {
    let manifest_dir = std::path::PathBuf::from(std::env::var("CARGO_MANIFEST_DIR")?);
    let root = manifest_dir.join("../../proto").canonicalize()?;
    println!("cargo:rerun-if-changed={}", root.display());
    println!("cargo:rerun-if-env-changed=CARGO_MANIFEST_DIR");
    let files = [
        "v1/envelope.proto",
        "v1/calls.proto",
        "v1/media.proto",
        "v1/conversations.proto",
        "v1/friends.proto",
        "v1/messages.proto",
        "v1/presence.proto",
        "v1/users.proto",
    ];
    let fds = protox::compile(files, [root])?;
    prost_build::Config::new().compile_fds(fds)?;
    Ok(())
}
