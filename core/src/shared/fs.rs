//! File helpers.

use std::io;
use std::path::Path;

/// Writes next to the file and renames it over, so nobody reads half a file.
/// Creates the folder first when it is missing.
pub async fn write_atomically(path: &Path, contents: impl AsRef<[u8]>) -> io::Result<()> {
    if let Some(dir) = path.parent() {
        tokio::fs::create_dir_all(dir).await?;
    }
    let mut name = path.file_name().unwrap_or_default().to_owned();
    name.push(".tmp");
    let tmp = path.with_file_name(name);
    tokio::fs::write(&tmp, contents).await?;
    tokio::fs::rename(&tmp, path).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn writes_into_a_new_folder_and_replaces_the_old_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("sub").join("file.toml");
        write_atomically(&path, "one").await.unwrap();
        write_atomically(&path, b"two").await.unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "two");
        let names: Vec<_> = std::fs::read_dir(path.parent().unwrap())
            .unwrap()
            .map(|e| e.unwrap().file_name())
            .collect();
        assert_eq!(names, ["file.toml"], "no temp file is left");
    }
}
