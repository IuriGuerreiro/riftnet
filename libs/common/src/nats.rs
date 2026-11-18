/// Connects to NATS. async-nats ignores `user:pass@` in the URL, so pass it on explicitly.
pub async fn connect(url: &str) -> anyhow::Result<async_nats::Client> {
    let addr: async_nats::ServerAddr = url.parse()?;
    let mut options = async_nats::ConnectOptions::new();
    if let (Some(user), Some(pass)) = (addr.username(), addr.password()) {
        options = options.user_and_password(user.to_owned(), pass.to_owned());
    }
    Ok(options.connect(addr).await?)
}
