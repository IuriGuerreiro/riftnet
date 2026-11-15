// Compiles ../../proto/**/*.proto with protox (pure Rust, no `protoc` needed).
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let root = "../../proto";
    println!("cargo:rerun-if-changed={root}");
    let files = [
        "v1/envelope.proto",
        "v1/conversations.proto",
        "v1/friends.proto",
        "v1/messages.proto",
        "v1/users.proto",
    ];
    let fds = protox::compile(files, [root])?;
    prost_build::Config::new().compile_fds(fds)?;
    Ok(())
}
