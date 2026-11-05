//! Installing a plugin from a folder, and removing one. Blocking file work:
//! the service runs it with `spawn_blocking`.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use super::manifest::{self, Manifest};

/// A plugin folder may hold this many files…
const MAX_FILES: usize = 500;
/// …and this many bytes.
const MAX_BYTES: u64 = 20 * 1024 * 1024;

/// Reads the `plugin.toml` in `dir`.
pub fn read_manifest(dir: &Path) -> Result<Manifest, String> {
    let text = fs::read_to_string(dir.join(manifest::FILE))
        .map_err(|err| format!("cannot read {}: {err}", manifest::FILE))?;
    manifest::parse(&text)
}

/// Copies the plugin in `source` into `plugins_dir`, replacing the one with
/// its id. Returns its manifest.
pub fn install(source: &Path, plugins_dir: &Path) -> Result<Manifest, String> {
    let source = source
        .canonicalize()
        .map_err(|err| format!("cannot open {}: {err}", source.display()))?;
    if !source.is_dir() {
        return Err(format!("{} is not a folder", source.display()));
    }
    let manifest = read_manifest(&source)?;
    fs::create_dir_all(plugins_dir).map_err(|err| err.to_string())?;
    let plugins_dir = plugins_dir.canonicalize().map_err(|err| err.to_string())?;
    if source.starts_with(&plugins_dir) {
        return Err("this plugin is already installed".into());
    }
    let target = plugins_dir.join(&manifest.id);
    let staging = plugins_dir.join(format!(".{}.installing", manifest.id));
    let _ = fs::remove_dir_all(&staging);
    let mut budget = (MAX_FILES, MAX_BYTES);
    if let Err(err) = copy_dir(&source, &staging, &mut budget) {
        let _ = fs::remove_dir_all(&staging);
        return Err(err);
    }
    replace(&staging, &target).map_err(|err| {
        let _ = fs::remove_dir_all(&staging);
        format!("cannot install into {}: {err}", target.display())
    })?;
    Ok(manifest)
}

/// Puts the folder `staging` in place of `target`.
pub fn replace(staging: &Path, target: &Path) -> io::Result<()> {
    let old = target.with_file_name(format!(
        ".{}.old",
        target.file_name().unwrap_or_default().to_string_lossy()
    ));
    let _ = fs::remove_dir_all(&old);
    let had = target.exists();
    if had {
        fs::rename(target, &old)?;
    }
    if let Err(err) = fs::rename(staging, target) {
        if had {
            let _ = fs::rename(&old, target);
        }
        return Err(err);
    }
    let _ = fs::remove_dir_all(&old);
    Ok(())
}

/// Copies files and folders, keeping their permissions; links, `.git` and
/// anything past the budget are refused or left out.
fn copy_dir(from: &Path, to: &Path, budget: &mut (usize, u64)) -> Result<(), String> {
    fs::create_dir_all(to).map_err(|err| err.to_string())?;
    let entries = fs::read_dir(from).map_err(|err| err.to_string())?;
    for entry in entries {
        let entry = entry.map_err(|err| err.to_string())?;
        let name = entry.file_name();
        if name == ".git" {
            continue;
        }
        let kind = entry.file_type().map_err(|err| err.to_string())?;
        let target: PathBuf = to.join(&name);
        if kind.is_symlink() {
            tracing::info!("left out the link {}", entry.path().display());
        } else if kind.is_dir() {
            copy_dir(&entry.path(), &target, budget)?;
        } else if kind.is_file() {
            let size = entry.metadata().map_err(|err| err.to_string())?.len();
            if budget.0 == 0 || size > budget.1 {
                return Err(format!(
                    "a plugin holds at most {MAX_FILES} files and {} MB",
                    MAX_BYTES / 1024 / 1024
                ));
            }
            budget.0 -= 1;
            budget.1 -= size;
            fs::copy(entry.path(), &target).map_err(|err| err.to_string())?;
        }
    }
    Ok(())
}

/// Where the plugin `id` keeps its own files: in `plugins_dir`, out of the
/// way of its folder being replaced by an update.
pub fn data_dir(id: &str, plugins_dir: &Path) -> PathBuf {
    plugins_dir.join(".data").join(id)
}

/// Deletes the plugin `id` and what it kept from `plugins_dir`.
pub fn remove(id: &str, plugins_dir: &Path) -> Result<(), String> {
    if !manifest::valid_id(id) {
        return Err(format!("no plugin {id}"));
    }
    let dir = plugins_dir.join(id);
    if !dir.is_dir() {
        return Err(format!("no plugin {id}"));
    }
    fs::remove_dir_all(&dir).map_err(|err| format!("cannot remove {}: {err}", dir.display()))?;
    let _ = fs::remove_dir_all(data_dir(id, plugins_dir));
    Ok(())
}
