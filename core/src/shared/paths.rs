//! Where Nokta keeps its config and cache: the XDG base directories on
//! Linux, `~/Library` on macOS, `%APPDATA%` and `%LOCALAPPDATA%` on Windows.

use std::env;
use std::ffi::OsString;
use std::path::{Path, PathBuf};

use anyhow::{bail, Result};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum System {
    Linux,
    MacOs,
    Windows,
}

impl System {
    /// The system noktad was built for. Other Unix systems count as Linux.
    pub fn current() -> System {
        if cfg!(windows) {
            System::Windows
        } else if cfg!(target_os = "macos") {
            System::MacOs
        } else {
            System::Linux
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Paths {
    pub config_file: PathBuf,
    pub cache_dir: PathBuf,
    /// The user's own `.lrc` files.
    pub lyrics_dir: PathBuf,
    /// The lyric timing set per song from the lyrics view, next to `lyrics_dir`.
    pub lyrics_offsets_file: PathBuf,
    /// The freedesktop thumbnail cache that Files fills; Linux only.
    pub system_thumbnails: Option<PathBuf>,
    /// Thumbnails of copied pictures, emptied at start: in the runtime
    /// folder (memory, this user only) where there is one.
    pub clipboard_dir: PathBuf,
    /// The folder finished downloads land in; none outside a real session.
    pub downloads_dir: Option<PathBuf>,
}

impl Paths {
    /// The Linux layout under the given config, cache and data homes.
    pub fn new(config_home: &Path, cache_home: &Path, data_home: &Path) -> Paths {
        Paths {
            config_file: config_home.join("nokta").join("config.toml"),
            cache_dir: cache_home.join("nokta"),
            lyrics_dir: data_home.join("nokta").join("lyrics"),
            lyrics_offsets_file: data_home.join("nokta").join("lyrics-offsets.toml"),
            system_thumbnails: Some(cache_home.join("thumbnails")),
            clipboard_dir: cache_home.join("nokta").join("clipboard"),
            downloads_dir: None,
        }
    }

    pub fn from_env() -> Result<Paths> {
        Paths::for_system(System::current(), |name| env::var_os(name))
    }

    /// The folders on `system`, reading environment variables through `var`.
    /// Empty variables count as unset.
    pub fn for_system(system: System, var: impl Fn(&str) -> Option<OsString>) -> Result<Paths> {
        let dir = |name: &str| var(name).filter(|v| !v.is_empty()).map(PathBuf::from);
        let need = |name: &str| match dir(name) {
            Some(dir) => Ok(dir),
            None => bail!("{name} is not set"),
        };
        Ok(match system {
            System::Linux => {
                let home = dir("HOME");
                let pick = |name: &str, fallback: &str| match (dir(name), &home) {
                    (Some(dir), _) => Ok(dir),
                    (None, Some(home)) => Ok(home.join(fallback)),
                    (None, None) => bail!("neither {name} nor HOME is set"),
                };
                let config_home = pick("XDG_CONFIG_HOME", ".config")?;
                let mut paths = Paths::new(
                    &config_home,
                    &pick("XDG_CACHE_HOME", ".cache")?,
                    &pick("XDG_DATA_HOME", ".local/share")?,
                );
                if let Some(home) = &home {
                    let user_dirs = std::fs::read_to_string(config_home.join("user-dirs.dirs"));
                    paths.downloads_dir = Some(download_dir(user_dirs.ok().as_deref(), home));
                }
                if let Some(runtime) = dir("XDG_RUNTIME_DIR") {
                    paths.clipboard_dir = runtime.join("nokta").join("clipboard");
                }
                paths
            }
            System::MacOs => {
                let home = need("HOME")?;
                let library = home.join("Library");
                let support = library.join("Application Support").join("nokta");
                let cache_dir = library.join("Caches").join("nokta");
                Paths {
                    config_file: support.join("config.toml"),
                    clipboard_dir: cache_dir.join("clipboard"),
                    cache_dir,
                    lyrics_dir: support.join("lyrics"),
                    lyrics_offsets_file: support.join("lyrics-offsets.toml"),
                    system_thumbnails: None,
                    downloads_dir: Some(home.join("Downloads")),
                }
            }
            System::Windows => {
                let roaming = need("APPDATA")?.join("nokta");
                let cache_dir = need("LOCALAPPDATA")?.join("nokta").join("cache");
                Paths {
                    config_file: roaming.join("config.toml"),
                    clipboard_dir: cache_dir.join("clipboard"),
                    cache_dir,
                    lyrics_dir: roaming.join("lyrics"),
                    lyrics_offsets_file: roaming.join("lyrics-offsets.toml"),
                    system_thumbnails: None,
                    downloads_dir: dir("USERPROFILE").map(|home| home.join("Downloads")),
                }
            }
        })
    }
}

/// `XDG_DOWNLOAD_DIR` from the text of `user-dirs.dirs`, with `$HOME`
/// filled in, or `~/Downloads` when it is not set or turned off.
pub fn download_dir(user_dirs: Option<&str>, home: &Path) -> PathBuf {
    let value = user_dirs.and_then(|text| {
        text.lines()
            .rev()
            .find_map(|line| line.trim().strip_prefix("XDG_DOWNLOAD_DIR="))
    });
    let dir = value.map(|v| v.trim().trim_matches('"')).and_then(|v| {
        match v.strip_prefix("$HOME") {
            // The home folder itself means the folder is turned off.
            Some(rest) => {
                let rest = rest.trim_start_matches('/');
                (!rest.is_empty()).then(|| home.join(rest))
            }
            None => v.starts_with('/').then(|| PathBuf::from(v)),
        }
    });
    dir.unwrap_or_else(|| home.join("Downloads"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;
    use std::path::Path;

    fn env<'a>(vars: &'a [(&str, &str)]) -> impl Fn(&str) -> Option<OsString> + 'a {
        let vars: HashMap<_, _> = vars.iter().copied().collect();
        move |name| vars.get(name).map(OsString::from)
    }

    #[test]
    fn paths_use_nokta_subdirs() {
        let paths = Paths::new(Path::new("/c"), Path::new("/k"), Path::new("/d"));
        assert_eq!(paths.config_file, Path::new("/c/nokta/config.toml"));
        assert_eq!(paths.cache_dir, Path::new("/k/nokta"));
        assert_eq!(paths.lyrics_dir, Path::new("/d/nokta/lyrics"));
        assert_eq!(
            paths.lyrics_offsets_file,
            Path::new("/d/nokta/lyrics-offsets.toml")
        );
        assert_eq!(
            paths.system_thumbnails.as_deref(),
            Some(Path::new("/k/thumbnails"))
        );
    }

    #[test]
    fn linux_prefers_xdg_vars() {
        let vars = [
            ("XDG_CONFIG_HOME", "/xc"),
            ("XDG_CACHE_HOME", "/xk"),
            ("XDG_DATA_HOME", "/xd"),
            ("HOME", "/home/u"),
        ];
        let paths = Paths::for_system(System::Linux, env(&vars)).unwrap();
        assert_eq!(
            paths,
            Paths {
                downloads_dir: Some(PathBuf::from("/home/u/Downloads")),
                ..Paths::new(Path::new("/xc"), Path::new("/xk"), Path::new("/xd"))
            }
        );
    }

    #[test]
    fn linux_falls_back_to_home() {
        let vars = [("XDG_CACHE_HOME", ""), ("HOME", "/home/u")];
        let paths = Paths::for_system(System::Linux, env(&vars)).unwrap();
        let home = Path::new("/home/u");
        assert_eq!(
            paths.lyrics_offsets_file,
            home.join(".local")
                .join("share")
                .join("nokta")
                .join("lyrics-offsets.toml")
        );
        assert_eq!(
            paths,
            Paths {
                downloads_dir: Some(home.join("Downloads")),
                ..Paths::new(
                    &home.join(".config"),
                    &home.join(".cache"),
                    &home.join(".local").join("share")
                )
            }
        );
        assert!(Paths::for_system(System::Linux, env(&[])).is_err());
    }

    #[test]
    fn copied_pictures_go_to_the_runtime_folder() {
        let paths = Paths::new(Path::new("/c"), Path::new("/k"), Path::new("/d"));
        assert_eq!(paths.clipboard_dir, Path::new("/k/nokta/clipboard"));
        let vars = [("HOME", "/home/u"), ("XDG_RUNTIME_DIR", "/run/user/1000")];
        let paths = Paths::for_system(System::Linux, env(&vars)).unwrap();
        assert_eq!(
            paths.clipboard_dir,
            Path::new("/run/user/1000/nokta/clipboard")
        );
        let vars = [("HOME", "/Users/u")];
        let paths = Paths::for_system(System::MacOs, env(&vars)).unwrap();
        assert_eq!(paths.clipboard_dir, paths.cache_dir.join("clipboard"));
    }

    #[test]
    fn macos_uses_library() {
        let vars = [("HOME", "/Users/u"), ("XDG_CONFIG_HOME", "/xc")];
        let paths = Paths::for_system(System::MacOs, env(&vars)).unwrap();
        let library = Path::new("/Users/u").join("Library");
        assert_eq!(
            paths.config_file,
            library
                .join("Application Support")
                .join("nokta")
                .join("config.toml")
        );
        assert_eq!(paths.cache_dir, library.join("Caches").join("nokta"));
        assert_eq!(
            paths.lyrics_dir,
            library
                .join("Application Support")
                .join("nokta")
                .join("lyrics")
        );
        assert_eq!(
            paths.lyrics_offsets_file,
            library
                .join("Application Support")
                .join("nokta")
                .join("lyrics-offsets.toml")
        );
        assert!(Paths::for_system(System::MacOs, env(&[])).is_err());
    }

    #[test]
    fn windows_uses_app_data() {
        let vars = [
            ("APPDATA", r"C:\Users\u\AppData\Roaming"),
            ("LOCALAPPDATA", r"C:\Users\u\AppData\Local"),
        ];
        let paths = Paths::for_system(System::Windows, env(&vars)).unwrap();
        let roaming = Path::new(vars[0].1);
        let local = Path::new(vars[1].1);
        assert_eq!(paths.config_file, roaming.join("nokta").join("config.toml"));
        assert_eq!(paths.cache_dir, local.join("nokta").join("cache"));
        assert_eq!(paths.lyrics_dir, roaming.join("nokta").join("lyrics"));
        assert_eq!(
            paths.lyrics_offsets_file,
            roaming.join("nokta").join("lyrics-offsets.toml")
        );
        assert!(Paths::for_system(System::Windows, env(&vars[..1])).is_err());
    }

    #[test]
    fn current_system_reads_the_environment() {
        let expected = if cfg!(windows) {
            System::Windows
        } else if cfg!(target_os = "macos") {
            System::MacOs
        } else {
            System::Linux
        };
        assert_eq!(System::current(), expected);
    }

    #[test]
    fn the_download_folder_comes_from_user_dirs() {
        let home = Path::new("/home/x");
        let user_dirs = "# written by xdg-user-dirs-update\n\
                         XDG_DESKTOP_DIR=\"$HOME/Desktop\"\n\
                         XDG_DOWNLOAD_DIR=\"$HOME/Unduhan\"\n";
        assert_eq!(
            download_dir(Some(user_dirs), home),
            Path::new("/home/x/Unduhan")
        );
        assert_eq!(
            download_dir(Some("XDG_DOWNLOAD_DIR=\"/data/dl\"\n"), home),
            Path::new("/data/dl")
        );
        // Missing, commented out, or the home folder itself (turned off).
        for text in [
            None,
            Some("XDG_DESKTOP_DIR=\"$HOME/Desktop\"\n"),
            Some("# XDG_DOWNLOAD_DIR=\"$HOME/Unduhan\"\n"),
            Some("XDG_DOWNLOAD_DIR=\"$HOME/\"\n"),
        ] {
            assert_eq!(download_dir(text, home), home.join("Downloads"), "{text:?}");
        }
    }

    #[test]
    fn only_a_real_session_has_a_download_folder() {
        let paths = Paths::new(Path::new("/c"), Path::new("/k"), Path::new("/d"));
        assert_eq!(paths.downloads_dir, None);
        let vars = [("HOME", "/Users/u")];
        let paths = Paths::for_system(System::MacOs, env(&vars)).unwrap();
        assert_eq!(
            paths.downloads_dir.as_deref(),
            Some(Path::new("/Users/u").join("Downloads").as_path())
        );
    }
}
