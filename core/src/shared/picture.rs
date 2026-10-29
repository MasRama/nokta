//! Small PNG thumbnails of pictures, for the extension to show, and the
//! accent color of a picture.

use std::io::{BufRead, Seek};
use std::path::Path;

use image::{imageops::FilterType, DynamicImage, ImageFormat, ImageReader, Limits};

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

/// The dominant vivid color of an image as `#rrggbb`, or `None` for images
/// with no meaningful color (grayscale, near black).
pub fn accent_color(img: &DynamicImage) -> Option<String> {
    let small = img.resize_exact(32, 32, FilterType::Triangle).to_rgb8();
    let mut pixels: Vec<(f32, [u8; 3])> = small
        .pixels()
        .filter_map(|p| {
            let [r, g, b] = p.0;
            let max = r.max(g).max(b);
            let min = r.min(g).min(b);
            let value = f32::from(max) / 255.0;
            if value <= 0.2 {
                return None;
            }
            Some((f32::from(max - min) / f32::from(max), p.0))
        })
        .collect();
    if pixels.is_empty() {
        return None;
    }
    pixels.sort_by(|a, b| b.0.total_cmp(&a.0));
    let top = &pixels[..pixels.len().div_ceil(5)];
    let n = top.len() as f32;
    let mean_saturation = top.iter().map(|(s, _)| s).sum::<f32>() / n;
    if mean_saturation < 0.15 {
        return None;
    }
    let channel =
        |i: usize| (top.iter().map(|(_, c)| f32::from(c[i])).sum::<f32>() / n).round() as u8;
    Some(format!(
        "#{:02x}{:02x}{:02x}",
        channel(0),
        channel(1),
        channel(2)
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{Rgb, RgbImage};

    fn red_image() -> DynamicImage {
        DynamicImage::ImageRgb8(RgbImage::from_fn(16, 16, |x, _| {
            if x < 12 {
                Rgb([220, 30, 40])
            } else {
                Rgb([40, 40, 40])
            }
        }))
    }

    fn gray_image() -> DynamicImage {
        DynamicImage::ImageRgb8(RgbImage::from_fn(16, 16, |x, y| {
            let v = (40 + (x + y) * 6) as u8;
            Rgb([v, v, v])
        }))
    }

    #[test]
    fn accent_of_red_image_is_reddish() {
        let hex = accent_color(&red_image()).unwrap();
        assert_eq!(hex.len(), 7);
        assert_eq!(hex, hex.to_lowercase());
        let r = u8::from_str_radix(&hex[1..3], 16).unwrap();
        let g = u8::from_str_radix(&hex[3..5], 16).unwrap();
        let b = u8::from_str_radix(&hex[5..7], 16).unwrap();
        assert!(r > 150 && r > g * 2 && r > b * 2, "{hex}");
    }

    #[test]
    fn accent_of_grayscale_is_none() {
        assert_eq!(accent_color(&gray_image()), None);
    }

    #[test]
    fn accent_of_black_is_none() {
        let black = DynamicImage::ImageRgb8(RgbImage::new(8, 8));
        assert_eq!(accent_color(&black), None);
    }
}
