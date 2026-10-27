//! Where Nokta keeps its config and cache, following the XDG base directory spec.

use std::env;
use std::path::{Path, PathBuf};

use anyhow::{bail, Result};

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Paths {
    pub config_file: PathBuf,
    pub cache_dir: PathBuf,
}

impl Paths {
    pub fn new(config_home: &Path, cache_home: &Path) -> Paths {
        Paths {
            config_file: config_home.join("nokta").join("config.toml"),
            cache_dir: cache_home.join("nokta"),
        }
    }

    pub fn from_env() -> Result<Paths> {
        let home = env::var_os("HOME")
            .filter(|h| !h.is_empty())
            .map(PathBuf::from);
        let pick = |var: &str, fallback: &str| -> Result<PathBuf> {
            match env::var_os(var).filter(|v| !v.is_empty()) {
                Some(dir) => Ok(PathBuf::from(dir)),
                None => match &home {
                    Some(home) => Ok(home.join(fallback)),
                    None => bail!("neither {var} nor HOME is set"),
                },
            }
        };
        Ok(Paths::new(
            &pick("XDG_CONFIG_HOME", ".config")?,
            &pick("XDG_CACHE_HOME", ".cache")?,
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    #[test]
    fn paths_use_nokta_subdirs() {
        let paths = Paths::new(Path::new("/c"), Path::new("/k"));
        assert_eq!(paths.config_file, Path::new("/c/nokta/config.toml"));
        assert_eq!(paths.cache_dir, Path::new("/k/nokta"));
    }

    #[test]
    fn from_env_prefers_xdg_vars() {
        temp_env::with_vars(
            [
                ("XDG_CONFIG_HOME", Some("/xc")),
                ("XDG_CACHE_HOME", Some("/xk")),
                ("HOME", Some("/home/u")),
            ],
            || {
                let paths = Paths::from_env().unwrap();
                assert_eq!(paths.config_file, Path::new("/xc/nokta/config.toml"));
                assert_eq!(paths.cache_dir, Path::new("/xk/nokta"));
            },
        );
    }

    #[test]
    fn from_env_falls_back_to_home() {
        temp_env::with_vars(
            [
                ("XDG_CONFIG_HOME", None),
                ("XDG_CACHE_HOME", Some("")),
                ("HOME", Some("/home/u")),
            ],
            || {
                let paths = Paths::from_env().unwrap();
                assert_eq!(
                    paths.config_file,
                    Path::new("/home/u/.config/nokta/config.toml")
                );
                assert_eq!(paths.cache_dir, Path::new("/home/u/.cache/nokta"));
            },
        );
    }
}
