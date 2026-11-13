//! Reading and writing secret files (signing key, Zitadel token).
//! Secrets must only be readable by the owner: dir 0700, files 0600.

use std::io::Write;
use std::path::Path;

/// Reads a secret file. If its permissions (or its folder's) are too open,
/// tightens them and warns, since the api owns these files.
pub fn read(path: &Path) -> anyhow::Result<String> {
    tighten(path)?;
    let raw = std::fs::read_to_string(path)
        .map_err(|e| anyhow::anyhow!("reading secret {}: {e}", path.display()))?;
    Ok(raw.trim().to_string())
}

/// Creates a new secret file with 0600 permissions. Fails if it already exists.
pub fn create(path: &Path, contents: &str) -> anyhow::Result<()> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
        set_mode(dir, 0o700)?;
    }
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    std::os::unix::fs::OpenOptionsExt::mode(&mut options, 0o600);
    options.open(path)?.write_all(contents.as_bytes())?;
    Ok(())
}

fn tighten(path: &Path) -> anyhow::Result<()> {
    if let Some(dir) = path.parent() {
        restrict(dir, 0o700)?;
    }
    restrict(path, 0o600)
}

#[cfg(unix)]
fn restrict(path: &Path, mode: u32) -> anyhow::Result<()> {
    use std::os::unix::fs::PermissionsExt;
    let current = std::fs::metadata(path)?.permissions().mode() & 0o777;
    if current & 0o077 != 0 {
        tracing::warn!(path = %path.display(), from = format!("{current:o}"), to = format!("{mode:o}"),
            "secret was readable by other users, tightening permissions");
        set_mode(path, mode)?;
    }
    Ok(())
}

#[cfg(not(unix))]
fn restrict(_path: &Path, _mode: u32) -> anyhow::Result<()> {
    Ok(())
}

#[cfg(unix)]
fn set_mode(path: &Path, mode: u32) -> anyhow::Result<()> {
    use std::os::unix::fs::PermissionsExt;
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(mode))?;
    Ok(())
}

#[cfg(not(unix))]
fn set_mode(_path: &Path, _mode: u32) -> anyhow::Result<()> {
    Ok(())
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;

    fn mode(p: &Path) -> u32 {
        std::fs::metadata(p).unwrap().permissions().mode() & 0o777
    }

    #[test]
    fn create_is_private_and_read_tightens() {
        let dir = std::env::temp_dir().join(format!("secrets-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let file = dir.join("key");

        create(&file, "s3cret").unwrap();
        assert_eq!(mode(&file), 0o600);
        assert_eq!(mode(&dir), 0o700);
        assert!(create(&file, "again").is_err(), "must not overwrite");

        set_mode(&file, 0o644).unwrap();
        set_mode(&dir, 0o777).unwrap();
        assert_eq!(read(&file).unwrap(), "s3cret");
        assert_eq!(mode(&file), 0o600);
        assert_eq!(mode(&dir), 0o700);

        std::fs::remove_dir_all(&dir).unwrap();
    }
}
