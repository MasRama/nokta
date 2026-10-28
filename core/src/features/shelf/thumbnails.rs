//! A picture for each item on the shelf: the thumbnail Files already made,
//! from the freedesktop thumbnail cache, else one Nokta makes for an image.
//! Both are files; the extension only shows them.

use std::path::{Path, PathBuf};
use std::time::SystemTime;

use image::{ImageFormat, ImageReader};
use md5::Md5;
use sha2::{Digest, Sha256};

use crate::shared::picture::write_thumbnail;

/// Larger images are not decoded.
const MAX_FILE_BYTES: u64 = 64 * 1024 * 1024;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ThumbnailDirs {
    /// The freedesktop cache (`$XDG_CACHE_HOME/thumbnails`); none off Linux.
    pub system: Option<PathBuf>,
    /// Where Nokta writes its own.
    pub own: PathBuf,
}

/// Files's thumbnails for `uri` in the freedesktop cache, larger first.
pub fn system_paths(system: &Path, uri: &str) -> [PathBuf; 2] {
    let name = format!("{}.png", hex::encode(Md5::digest(uri.as_bytes())));
    [
        system.join("large").join(&name),
        system.join("normal").join(&name),
    ]
}

pub fn own_path(own: &Path, uri: &str) -> PathBuf {
    own.join(format!(
        "{}.png",
        hex::encode(Sha256::digest(uri.as_bytes()))
    ))
}

/// The thumbnail for the file at `path`: Files's when it is newer than the
/// file, else Nokta's own for an image, made now if needed. None for other
/// files and for images that cannot be read. Blocks while it decodes.
pub fn find(dirs: &ThumbnailDirs, uri: &str, path: &Path) -> Option<PathBuf> {
    let changed = std::fs::metadata(path).and_then(|m| m.modified()).ok()?;
    if let Some(system) = &dirs.system {
        let cached = system_paths(system, uri);
        if let Some(fresh) = cached.into_iter().find(|t| newer(t, changed)) {
            return Some(fresh);
        }
    }
    let own = own_path(&dirs.own, uri);
    if newer(&own, changed) {
        return Some(own);
    }
    match write(path, &own) {
        Ok(()) => Some(own),
        Err(Skip::NotAnImage) => None,
        Err(Skip::Failed(e)) => {
            tracing::debug!("shelf: no thumbnail for {}: {e}", path.display());
            None
        }
    }
}

fn newer(thumbnail: &Path, than: SystemTime) -> bool {
    std::fs::metadata(thumbnail)
        .and_then(|m| m.modified())
        .is_ok_and(|made| made >= than)
}

enum Skip {
    NotAnImage,
    Failed(anyhow::Error),
}

impl<E: Into<anyhow::Error>> From<E> for Skip {
    fn from(e: E) -> Skip {
        Skip::Failed(e.into())
    }
}

fn write(source: &Path, dest: &Path) -> Result<(), Skip> {
    let Ok(format) = ImageFormat::from_path(source) else {
        return Err(Skip::NotAnImage);
    };
    if !matches!(
        format,
        ImageFormat::Png | ImageFormat::Jpeg | ImageFormat::WebP
    ) {
        return Err(Skip::NotAnImage);
    }
    if std::fs::metadata(source)?.len() > MAX_FILE_BYTES {
        return Err(Skip::NotAnImage);
    }
    write_thumbnail(ImageReader::open(source)?, dest)?;
    Ok(())
}
