//! The picture theme's image: decoded once, scaled down, blurred and written
//! to the cache as a PNG the extension can show, with its colors.

use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use anyhow::{bail, Context};
use image::{imageops::FilterType, DynamicImage, ImageFormat, ImageReader, Limits};
use tokio::sync::watch;

use crate::shared::hash::sha256_hex;
use crate::shared::picture::accent_color;

use super::Config;

/// The prepared picture is at most this wide, the largest open notch with room.
pub const MAX_WIDTH: u32 = 1280;
/// A file larger than this is not read.
pub const MAX_FILE_BYTES: u64 = 40 * 1024 * 1024;
/// A picture that needs more memory than this is not decoded.
const MAX_DECODE_BYTES: u64 = 512 * 1024 * 1024;

/// What `Settings1` publishes: empty strings while there is no picture.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Prepared {
    pub path: String,
    /// The picture's vivid color as `#rrggbb`, or empty when it has none.
    pub color: String,
    /// The mean color of the picture's top half, where the notch sits.
    pub tone: String,
}

/// `~/x` under `home`; other paths as they are.
pub fn expand_home(path: &str, home: Option<&Path>) -> PathBuf {
    match (path.strip_prefix("~/"), home) {
        (Some(rest), Some(home)) => home.join(rest),
        _ => PathBuf::from(path),
    }
}

/// Prepares `source` with `blur` px of blur into `dir`, reusing an earlier
/// result for the same file, size, time and blur, and removing older ones.
/// Blocks while it decodes.
pub fn prepare(source: &Path, blur: u32, dir: &Path) -> anyhow::Result<Prepared> {
    let meta =
        std::fs::metadata(source).with_context(|| format!("cannot read {}", source.display()))?;
    if !meta.is_file() {
        bail!("{} is not a file", source.display());
    }
    if meta.len() > MAX_FILE_BYTES {
        bail!("{} is larger than 40 MB", source.display());
    }
    let mtime = meta.modified()?.duration_since(UNIX_EPOCH)?.as_nanos();
    let key = sha256_hex(&format!(
        "{}\n{}\n{mtime}\n{blur}",
        source.display(),
        meta.len()
    ));
    let png = dir.join(format!("{key}.png"));
    let colors = dir.join(format!("{key}.colors"));
    if let (true, Ok(text)) = (png.is_file(), std::fs::read_to_string(&colors)) {
        let (color, tone) = text.split_once('\n').unwrap_or(("", ""));
        return Ok(Prepared {
            path: png.to_string_lossy().into_owned(),
            color: color.to_owned(),
            tone: tone.trim().to_owned(),
        });
    }

    let mut reader = ImageReader::open(source)?.with_guessed_format()?;
    let mut limits = Limits::default();
    limits.max_alloc = Some(MAX_DECODE_BYTES);
    reader.limits(limits);
    let mut img = reader.decode()?;
    if img.width() > MAX_WIDTH {
        img = img.resize(MAX_WIDTH, u32::MAX, FilterType::Triangle);
    }
    if blur > 0 {
        img = img.fast_blur(blur as f32 / 2.0);
    }
    let prepared = Prepared {
        path: png.to_string_lossy().into_owned(),
        color: accent_color(&img).unwrap_or_default(),
        tone: top_tone(&img),
    };

    std::fs::create_dir_all(dir)?;
    for entry in std::fs::read_dir(dir)?.flatten() {
        let _ = std::fs::remove_file(entry.path());
    }
    // Moved in place once written, so the extension never reads half a file.
    let partial = dir.join(format!("{key}.partial"));
    img.to_rgb8().save_with_format(&partial, ImageFormat::Png)?;
    std::fs::rename(&partial, &png)?;
    std::fs::write(&colors, format!("{}\n{}", prepared.color, prepared.tone))?;
    Ok(prepared)
}

/// The mean color of the top half of `img` as `#rrggbb`.
fn top_tone(img: &DynamicImage) -> String {
    let rgb = img.to_rgb8();
    let rows = rgb.height().div_ceil(2);
    let mut sum = [0u64; 3];
    let mut n = 0u64;
    for y in 0..rows {
        for x in 0..rgb.width() {
            let p = rgb.get_pixel(x, y).0;
            for (s, c) in sum.iter_mut().zip(p) {
                *s += u64::from(c);
            }
            n += 1;
        }
    }
    let mean = |s: u64| (s + n / 2).checked_div(n).unwrap_or(0);
    format!(
        "#{:02x}{:02x}{:02x}",
        mean(sum[0]),
        mean(sum[1]),
        mean(sum[2])
    )
}

/// Prepares the configured picture into `dir` at start and whenever
/// `picture` or `picture_blur` change, off the async runtime.
pub fn spawn(
    mut config: watch::Receiver<Config>,
    dir: PathBuf,
    home: Option<PathBuf>,
) -> watch::Receiver<Prepared> {
    let (tx, rx) = watch::channel(Prepared::default());
    tokio::spawn(async move {
        let mut last: Option<(String, u32)> = None;
        let mut failed: Option<String> = None;
        loop {
            let wanted = {
                let c = config.borrow_and_update();
                (c.appearance.picture.clone(), c.appearance.picture_blur)
            };
            if last.as_ref() != Some(&wanted) {
                last = Some(wanted.clone());
                let (picture, blur) = wanted;
                let next = if picture.is_empty() {
                    Prepared::default()
                } else {
                    let source = expand_home(&picture, home.as_deref());
                    let dir = dir.clone();
                    let result =
                        tokio::task::spawn_blocking(move || prepare(&source, blur, &dir)).await;
                    match result {
                        Ok(Ok(prepared)) => {
                            failed = None;
                            prepared
                        }
                        Ok(Err(err)) => {
                            // Logged once per picture, not on every config edit.
                            if failed.as_deref() != Some(picture.as_str()) {
                                tracing::warn!("cannot show the picture {picture:?}: {err:#}");
                                failed = Some(picture);
                            }
                            Prepared::default()
                        }
                        Err(err) => {
                            tracing::warn!("picture preparation stopped: {err}");
                            Prepared::default()
                        }
                    }
                };
                tx.send_if_modified(|current| {
                    let changed = *current != next;
                    *current = next;
                    changed
                });
            }
            if config.changed().await.is_err() {
                break;
            }
        }
    });
    rx
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{DynamicImage, Rgb, RgbImage};

    fn write_image(path: &Path, width: u32, height: u32, color: [u8; 3]) {
        DynamicImage::ImageRgb8(RgbImage::from_pixel(width, height, Rgb(color)))
            .save(path)
            .unwrap();
    }

    fn pngs(dir: &Path) -> Vec<PathBuf> {
        let mut out: Vec<PathBuf> = std::fs::read_dir(dir)
            .unwrap()
            .map(|e| e.unwrap().path())
            .filter(|p| p.extension().is_some_and(|e| e == "png"))
            .collect();
        out.sort();
        out
    }

    #[test]
    fn home_is_expanded() {
        let home = Path::new("/home/ren");
        assert_eq!(
            expand_home("~/Pictures/a.jpg", Some(home)),
            PathBuf::from("/home/ren/Pictures/a.jpg")
        );
        assert_eq!(
            expand_home("/tmp/a.jpg", Some(home)),
            PathBuf::from("/tmp/a.jpg")
        );
        assert_eq!(expand_home("~/a.jpg", None), PathBuf::from("~/a.jpg"));
        assert_eq!(
            expand_home("~other/a", Some(home)),
            PathBuf::from("~other/a")
        );
    }

    #[test]
    fn a_large_picture_is_scaled_down_with_its_colors() {
        let tmp = tempfile::tempdir().unwrap();
        let source = tmp.path().join("red.png");
        write_image(&source, 2000, 1000, [220, 30, 40]);
        let cache = tmp.path().join("cache");
        let p = prepare(&source, 0, &cache).unwrap();
        let out = image::open(&p.path).unwrap();
        assert_eq!((out.width(), out.height()), (MAX_WIDTH, 640));
        assert!(Path::new(&p.path).starts_with(&cache));
        let r = u8::from_str_radix(&p.color[1..3], 16).unwrap();
        assert!(r > 150, "{}", p.color);
        assert_eq!(p.tone, "#dc1e28");
    }

    #[test]
    fn a_small_picture_keeps_its_size() {
        let tmp = tempfile::tempdir().unwrap();
        let source = tmp.path().join("small.png");
        write_image(&source, 300, 200, [10, 10, 10]);
        let p = prepare(&source, 0, &tmp.path().join("cache")).unwrap();
        let out = image::open(&p.path).unwrap();
        assert_eq!((out.width(), out.height()), (300, 200));
        // Near black has no vivid color.
        assert_eq!(p.color, "");
        assert_eq!(p.tone, "#0a0a0a");
    }

    #[test]
    fn missing_and_broken_files_give_no_picture() {
        let tmp = tempfile::tempdir().unwrap();
        let cache = tmp.path().join("cache");
        assert!(prepare(&tmp.path().join("gone.png"), 0, &cache).is_err());
        let text = tmp.path().join("notes.png");
        std::fs::write(&text, "not a picture").unwrap();
        assert!(prepare(&text, 0, &cache).is_err());
        assert!(prepare(tmp.path(), 0, &cache).is_err());
    }

    #[test]
    fn a_new_blur_makes_a_new_file_and_removes_the_old_one() {
        let tmp = tempfile::tempdir().unwrap();
        let source = tmp.path().join("p.png");
        write_image(&source, 64, 64, [40, 120, 240]);
        let cache = tmp.path().join("cache");
        let sharp = prepare(&source, 0, &cache).unwrap();
        assert_eq!(prepare(&source, 0, &cache).unwrap(), sharp);
        let blurred = prepare(&source, 12, &cache).unwrap();
        assert_ne!(blurred.path, sharp.path);
        assert_eq!(pngs(&cache), vec![PathBuf::from(&blurred.path)]);
    }

    #[test]
    fn a_rewritten_file_is_prepared_again() {
        let tmp = tempfile::tempdir().unwrap();
        let source = tmp.path().join("p.png");
        write_image(&source, 64, 64, [40, 120, 240]);
        let cache = tmp.path().join("cache");
        let first = prepare(&source, 0, &cache).unwrap();
        write_image(&source, 80, 64, [240, 120, 40]);
        let second = prepare(&source, 0, &cache).unwrap();
        assert_ne!(first.path, second.path);
        assert_ne!(first.tone, second.tone);
    }
}
