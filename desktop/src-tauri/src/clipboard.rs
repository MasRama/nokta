//! Windows' clipboard as the history keeps it: what to take from a copy,
//! and pictures between Windows' device-independent bitmaps (DIB) and the
//! PNGs the core keeps. Pure, so it is tested on every system.

// Only the Windows app uses it; the stub on other systems does not.
#![cfg_attr(not(windows), allow(dead_code))]

use std::io::Cursor;

use image::{ImageFormat, RgbaImage};

/// The formats a copy offers, as far as the history cares.
#[derive(Debug, Default, Clone, Copy)]
pub struct Offer {
    /// A password manager or the like asked clipboard tools to skip it:
    /// `ExcludeClipboardContentFromMonitorProcessing`, or
    /// `CanIncludeInClipboardHistory` set to 0.
    pub secret: bool,
    pub text: bool,
    /// The registered `PNG` format.
    pub png: bool,
    /// `CF_DIBV5` or `CF_DIB`.
    pub dib: bool,
}

#[derive(Debug, PartialEq, Eq, Clone, Copy)]
pub enum Kind {
    Text,
    Image,
}

/// What to keep of a copy: text first, else a picture, as the extension's
/// `captureKind`; nothing of a secret.
pub fn capture_kind(offer: Offer) -> Option<Kind> {
    if offer.secret {
        None
    } else if offer.text {
        Some(Kind::Text)
    } else if offer.png || offer.dib {
        Some(Kind::Image)
    } else {
        None
    }
}

/// `CF_UNICODETEXT`'s UTF-16 up to its NUL.
pub fn text_from_wide(units: &[u16]) -> String {
    let end = units.iter().position(|&u| u == 0).unwrap_or(units.len());
    String::from_utf16_lossy(&units[..end])
}

/// `text` as `CF_UNICODETEXT` takes it, NUL-ended.
pub fn wide_from_text(text: &str) -> Vec<u16> {
    text.encode_utf16().chain(std::iter::once(0)).collect()
}

/// A picture larger than this many pixels is not read: the core keeps at
/// most 8 MiB of PNG anyway.
const MAX_PIXELS: u64 = 40_000_000;
const BI_RGB: u32 = 0;
const BI_BITFIELDS: u32 = 3;
/// `BITMAPINFOHEADER`; V4 and V5 headers are longer and hold the masks.
const INFO_HEADER: usize = 40;

fn u16_at(bytes: &[u8], at: usize) -> Option<u16> {
    Some(u16::from_le_bytes(bytes.get(at..at + 2)?.try_into().ok()?))
}

fn u32_at(bytes: &[u8], at: usize) -> Option<u32> {
    Some(u32::from_le_bytes(bytes.get(at..at + 4)?.try_into().ok()?))
}

/// One channel of a pixel by its mask, scaled to 0..=255.
fn channel(pixel: u32, mask: u32) -> u8 {
    if mask == 0 {
        return 0;
    }
    let value = (pixel & mask) >> mask.trailing_zeros();
    let max = mask >> mask.trailing_zeros();
    ((u64::from(value) * 255 + u64::from(max) / 2) / u64::from(max)) as u8
}

/// A `CF_DIB` or `CF_DIBV5` (the header, masks and pixels, no file header)
/// as a PNG. Reads 24- and 32-bit pictures, which is what apps copy; None
/// for anything else.
pub fn dib_to_png(dib: &[u8]) -> Option<Vec<u8>> {
    let header = u32_at(dib, 0)? as usize;
    if header < INFO_HEADER {
        return None;
    }
    let width = i32::from_le_bytes(dib.get(4..8)?.try_into().ok()?);
    let height = i32::from_le_bytes(dib.get(8..12)?.try_into().ok()?);
    let bits = u16_at(dib, 14)?;
    let compression = u32_at(dib, 16)?;
    if width <= 0 || height == 0 || (bits != 24 && bits != 32) {
        return None;
    }
    let (width, rows) = (width as u32, height.unsigned_abs());
    if u64::from(width) * u64::from(rows) > MAX_PIXELS {
        return None;
    }
    // Rows go from the bottom up unless the height is negative.
    let top_down = height < 0;
    let (masks, pixels_at) = match (compression, bits) {
        (BI_RGB, 24) => ([0x00ff_0000, 0x0000_ff00, 0x0000_00ff, 0], header),
        // A plain 32-bit picture's fourth byte is alpha only when it is
        // not all zero.
        (BI_RGB, 32) => ([0x00ff_0000, 0x0000_ff00, 0x0000_00ff, 0xff00_0000], header),
        (BI_BITFIELDS, 32) if header == INFO_HEADER => {
            let rgb = [u32_at(dib, 40)?, u32_at(dib, 44)?, u32_at(dib, 48)?];
            ([rgb[0], rgb[1], rgb[2], 0], header + 12)
        }
        (BI_BITFIELDS, 32) => {
            let alpha = if header >= 56 { u32_at(dib, 52)? } else { 0 };
            (
                [u32_at(dib, 40)?, u32_at(dib, 44)?, u32_at(dib, 48)?, alpha],
                header,
            )
        }
        _ => return None,
    };
    let stride = (width as usize * usize::from(bits)).div_ceil(32) * 4;
    let data = dib.get(pixels_at..pixels_at + stride * rows as usize)?;
    let step = usize::from(bits / 8);
    let mut picture = RgbaImage::new(width, rows);
    let mut any_alpha = false;
    for y in 0..rows {
        let source = if top_down { y } else { rows - 1 - y } as usize;
        let row = &data[source * stride..source * stride + width as usize * step];
        for (x, bytes) in row.chunks_exact(step).enumerate() {
            let pixel = if step == 4 {
                u32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]])
            } else {
                u32::from_le_bytes([bytes[0], bytes[1], bytes[2], 0])
            };
            let alpha = channel(pixel, masks[3]);
            any_alpha |= alpha != 0;
            picture.put_pixel(
                x as u32,
                y,
                image::Rgba([
                    channel(pixel, masks[0]),
                    channel(pixel, masks[1]),
                    channel(pixel, masks[2]),
                    alpha,
                ]),
            );
        }
    }
    if masks[3] == 0 || !any_alpha {
        for pixel in picture.pixels_mut() {
            pixel.0[3] = 255;
        }
    }
    let mut png = Vec::new();
    picture
        .write_to(&mut Cursor::new(&mut png), ImageFormat::Png)
        .ok()?;
    Some(png)
}

/// A PNG as a 32-bit `CF_DIB` from the bottom up, for apps that do not
/// read the `PNG` format; None when it is not a PNG.
pub fn png_to_dib(png: &[u8]) -> Option<Vec<u8>> {
    let picture = image::load_from_memory_with_format(png, ImageFormat::Png)
        .ok()?
        .to_rgba8();
    let (width, height) = picture.dimensions();
    let size = width as usize * height as usize * 4;
    let mut dib = Vec::with_capacity(INFO_HEADER + size);
    dib.extend_from_slice(&(INFO_HEADER as u32).to_le_bytes());
    dib.extend_from_slice(&(width as i32).to_le_bytes());
    dib.extend_from_slice(&(height as i32).to_le_bytes());
    dib.extend_from_slice(&1u16.to_le_bytes());
    dib.extend_from_slice(&32u16.to_le_bytes());
    dib.extend_from_slice(&BI_RGB.to_le_bytes());
    dib.extend_from_slice(&(size as u32).to_le_bytes());
    // Resolution and palette: none.
    dib.extend_from_slice(&[0; 16]);
    for row in picture.rows().rev() {
        for pixel in row {
            let [r, g, b, a] = pixel.0;
            dib.extend_from_slice(&[b, g, r, a]);
        }
    }
    Some(dib)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn png_of(picture: &RgbaImage) -> Vec<u8> {
        let mut png = Vec::new();
        picture
            .write_to(&mut Cursor::new(&mut png), ImageFormat::Png)
            .expect("a PNG");
        png
    }

    fn pixels(png: &[u8]) -> RgbaImage {
        image::load_from_memory(png).expect("a PNG").to_rgba8()
    }

    /// A 24-bit DIB 2×2 from the bottom up: red, green over blue, white.
    fn dib24() -> Vec<u8> {
        let mut dib = vec![0; INFO_HEADER];
        dib[0] = INFO_HEADER as u8;
        dib[4..8].copy_from_slice(&2i32.to_le_bytes());
        dib[8..12].copy_from_slice(&2i32.to_le_bytes());
        dib[12] = 1;
        dib[14] = 24;
        // Each row is 6 bytes, padded to 8; the bottom row comes first.
        dib.extend_from_slice(&[255, 0, 0, 255, 255, 255, 0, 0]);
        dib.extend_from_slice(&[0, 0, 255, 0, 255, 0, 0, 0]);
        dib
    }

    #[test]
    fn keeps_text_first_then_a_picture_and_never_a_secret() {
        let both = Offer {
            text: true,
            dib: true,
            ..Offer::default()
        };
        assert_eq!(capture_kind(both), Some(Kind::Text));
        let picture = Offer {
            png: true,
            ..Offer::default()
        };
        assert_eq!(capture_kind(picture), Some(Kind::Image));
        let secret = Offer {
            secret: true,
            ..both
        };
        assert_eq!(capture_kind(secret), None);
        assert_eq!(capture_kind(Offer::default()), None);
    }

    #[test]
    fn reads_text_up_to_its_end() {
        let wide = wide_from_text("héllo\r\nwörld");
        assert_eq!(wide.last(), Some(&0));
        let mut padded = wide.clone();
        padded.extend_from_slice(&[b'x' as u16, 0]);
        assert_eq!(text_from_wide(&padded), "héllo\r\nwörld");
    }

    #[test]
    fn a_24_bit_picture_from_the_bottom_up_becomes_a_png() {
        let picture = pixels(&dib_to_png(&dib24()).expect("a picture"));
        assert_eq!(picture.dimensions(), (2, 2));
        assert_eq!(picture.get_pixel(0, 0).0, [255, 0, 0, 255]);
        assert_eq!(picture.get_pixel(1, 0).0, [0, 255, 0, 255]);
        assert_eq!(picture.get_pixel(0, 1).0, [0, 0, 255, 255]);
        assert_eq!(picture.get_pixel(1, 1).0, [255, 255, 255, 255]);
    }

    #[test]
    fn a_png_goes_there_and_back_with_its_alpha() {
        let mut picture = RgbaImage::new(3, 2);
        picture.put_pixel(0, 0, image::Rgba([10, 20, 30, 128]));
        picture.put_pixel(2, 1, image::Rgba([200, 100, 50, 255]));
        let dib = png_to_dib(&png_of(&picture)).expect("a DIB");
        assert_eq!(dib.len(), INFO_HEADER + 3 * 2 * 4);
        assert_eq!(pixels(&dib_to_png(&dib).expect("a PNG")), picture);
    }

    #[test]
    fn a_32_bit_picture_without_alpha_is_opaque() {
        let mut picture = RgbaImage::new(1, 1);
        picture.put_pixel(0, 0, image::Rgba([1, 2, 3, 255]));
        let mut dib = png_to_dib(&png_of(&picture)).expect("a DIB");
        // Apps leave the fourth byte at zero.
        dib[INFO_HEADER + 3] = 0;
        let back = pixels(&dib_to_png(&dib).expect("a PNG"));
        assert_eq!(back.get_pixel(0, 0).0, [1, 2, 3, 255]);
    }

    #[test]
    fn reads_a_top_down_picture_with_bitfields() {
        let mut dib = vec![0; INFO_HEADER];
        dib[0] = INFO_HEADER as u8;
        dib[4..8].copy_from_slice(&1i32.to_le_bytes());
        dib[8..12].copy_from_slice(&(-2i32).to_le_bytes());
        dib[12] = 1;
        dib[14] = 32;
        dib[16] = BI_BITFIELDS as u8;
        for mask in [0x00ff_0000u32, 0x0000_ff00, 0x0000_00ff] {
            dib.extend_from_slice(&mask.to_le_bytes());
        }
        // Top row red, then blue.
        dib.extend_from_slice(&[0, 0, 255, 0, 255, 0, 0, 0]);
        let picture = pixels(&dib_to_png(&dib).expect("a picture"));
        assert_eq!(picture.get_pixel(0, 0).0, [255, 0, 0, 255]);
        assert_eq!(picture.get_pixel(0, 1).0, [0, 0, 255, 255]);
    }

    #[test]
    fn leaves_out_what_it_cannot_read() {
        let mut short = dib24();
        short.truncate(INFO_HEADER + 10);
        assert_eq!(dib_to_png(&short), None);
        let mut paletted = dib24();
        paletted[14] = 8;
        assert_eq!(dib_to_png(&paletted), None);
        assert_eq!(dib_to_png(&[1, 2, 3]), None);
        assert_eq!(png_to_dib(b"not a png"), None);
    }
}
