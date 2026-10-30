//! File helpers: writing safely and naming a file's icon.

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

/// The icon for a file from its extension; folders get "folder".
pub fn icon_for(path: &Path, is_dir: bool) -> &'static str {
    if is_dir {
        return "folder";
    }
    let ext = path
        .extension()
        .map(|e| e.to_string_lossy().to_ascii_lowercase())
        .unwrap_or_default();
    match ext.as_str() {
        "png" | "jpg" | "jpeg" | "gif" | "webp" | "svg" | "bmp" | "tif" | "tiff" | "heic"
        | "avif" | "ico" => "image-x-generic",
        "mp4" | "mkv" | "webm" | "mov" | "avi" | "m4v" | "mpg" | "mpeg" => "video-x-generic",
        "mp3" | "flac" | "ogg" | "opus" | "wav" | "m4a" | "aac" => "audio-x-generic",
        "pdf" | "doc" | "docx" | "odt" | "rtf" | "epub" => "x-office-document",
        "xls" | "xlsx" | "ods" | "csv" => "x-office-spreadsheet",
        "ppt" | "pptx" | "odp" => "x-office-presentation",
        "zip" | "tar" | "gz" | "tgz" | "xz" | "bz2" | "zst" | "7z" | "rar" | "deb" | "rpm" => {
            "package-x-generic"
        }
        "txt" | "md" | "log" | "json" | "toml" | "yaml" | "yml" | "xml" | "html" | "css" | "js"
        | "ts" | "rs" | "py" | "sh" | "c" | "h" | "cpp" | "go" | "java" => "text-x-generic",
        _ => "application-x-generic",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn icons_follow_the_file_kind() {
        let cases = [
            ("a.jpg", "image-x-generic"),
            ("a.webp", "image-x-generic"),
            ("a.mp4", "video-x-generic"),
            ("a.mkv", "video-x-generic"),
            ("a.mp3", "audio-x-generic"),
            ("a.flac", "audio-x-generic"),
            ("a.pdf", "x-office-document"),
            ("a.docx", "x-office-document"),
            ("a.odt", "x-office-document"),
            ("a.xlsx", "x-office-spreadsheet"),
            ("a.csv", "x-office-spreadsheet"),
            ("a.pptx", "x-office-presentation"),
            ("a.zip", "package-x-generic"),
            ("a.tar.gz", "package-x-generic"),
            ("a.txt", "text-x-generic"),
            ("a.md", "text-x-generic"),
            ("a.bin", "application-x-generic"),
            ("no-extension", "application-x-generic"),
        ];
        for (name, icon) in cases {
            assert_eq!(icon_for(Path::new(name), false), icon, "{name}");
        }
        assert_eq!(icon_for(Path::new("photos.jpg"), true), "folder");
    }

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
