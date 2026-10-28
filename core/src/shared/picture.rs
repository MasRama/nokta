//! Small PNG thumbnails of pictures, for the extension to show.

use std::io::{BufRead, Seek};
use std::path::Path;

use image::{ImageFormat, ImageReader, Limits};

/// Thumbnails fit in this square, like the freedesktop `normal` size.
pub const THUMBNAIL_SIZE: u32 = 128;
/// A picture that needs more memory than this is not decoded.
const MAX_DECODE_BYTES: u64 = 512 * 1024 * 1024;

/// Decodes the picture `reader` holds and writes a `THUMBNAIL_SIZE` PNG of
/// it to `dest`, whole or not at all. Blocks while it decodes.
pub fn write_thumbnail<R: BufRead + Seek>(
    reader: ImageReader<R>,
    dest: &Path,
) -> anyhow::Result<()> {
    let mut reader = reader.with_guessed_format()?;
    let mut limits = Limits::default();
    limits.max_alloc = Some(MAX_DECODE_BYTES);
    reader.limits(limits);
    let thumbnail = reader.decode()?.thumbnail(THUMBNAIL_SIZE, THUMBNAIL_SIZE);
    let dir = dest.parent().ok_or_else(|| anyhow::anyhow!("no folder"))?;
    std::fs::create_dir_all(dir)?;
    // Moved in place once written, so nobody reads half a file.
    let partial = dest.with_extension("png.partial");
    thumbnail.save_with_format(&partial, ImageFormat::Png)?;
    std::fs::rename(&partial, dest)?;
    Ok(())
}
