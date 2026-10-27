//! Cover art: resolves `mpris:artUrl` to a local file the extension can load,
//! downloads `http(s)` art once into the cache, and derives an accent color.

use std::path::{Path, PathBuf};
use std::time::{Duration, UNIX_EPOCH};

use futures_util::StreamExt;
use image::{imageops::FilterType, DynamicImage, ImageReader};
use tokio::io::AsyncWriteExt;

use crate::shared::hash::sha256_hex;

pub const MAX_DOWNLOAD_BYTES: usize = 5 * 1024 * 1024;
const DOWNLOAD_TIMEOUT: Duration = Duration::from_secs(10);

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ArtInfo {
    pub path: PathBuf,
    pub accent: Option<String>,
}

#[derive(Clone, Debug)]
pub struct ArtCache {
    dir: PathBuf,
    http: reqwest::Client,
}

impl ArtCache {
    /// `dir` is the daemon cache directory; art lives in `<dir>/art/`.
    pub fn new(dir: PathBuf, http: reqwest::Client) -> ArtCache {
        ArtCache {
            dir: dir.join("art"),
            http,
        }
    }

    pub async fn resolve(&self, url: &str) -> Option<ArtInfo> {
        let parsed = url::Url::parse(url).ok()?;
        match parsed.scheme() {
            "file" => self.resolve_file(&parsed).await,
            "http" | "https" => self.resolve_http(url).await,
            _ => None,
        }
    }

    async fn resolve_file(&self, url: &url::Url) -> Option<ArtInfo> {
        let path = url.to_file_path().ok()?;
        let meta = tokio::fs::metadata(&path)
            .await
            .ok()
            .filter(|m| m.is_file())?;
        // Players often rewrite one fixed path per track, so the accent is keyed
        // on the file's size and mtime as well as its URL.
        let mtime = meta
            .modified()
            .ok()?
            .duration_since(UNIX_EPOCH)
            .ok()?
            .as_nanos();
        let key = sha256_hex(&format!("{url}\n{}\n{mtime}", meta.len()));
        let accent = self
            .accent_for(&path, &self.dir.join(format!("{key}.accent")))
            .await;
        Some(ArtInfo { path, accent })
    }

    async fn resolve_http(&self, url: &str) -> Option<ArtInfo> {
        let path = self.dir.join(sha256_hex(url));
        if tokio::fs::metadata(&path).await.is_err() {
            if let Err(err) = self.download(url, &path).await {
                tracing::debug!(%url, %err, "cover art download failed");
                return None;
            }
        }
        let accent = self.accent_for(&path, &path.with_extension("accent")).await;
        Some(ArtInfo { path, accent })
    }

    async fn download(&self, url: &str, dest: &Path) -> anyhow::Result<()> {
        let resp = self
            .http
            .get(url)
            .timeout(DOWNLOAD_TIMEOUT)
            .send()
            .await?
            .error_for_status()?;
        if resp
            .content_length()
            .is_some_and(|n| n > MAX_DOWNLOAD_BYTES as u64)
        {
            anyhow::bail!("cover art is larger than {MAX_DOWNLOAD_BYTES} bytes");
        }
        tokio::fs::create_dir_all(&self.dir).await?;
        let part = dest.with_extension("part");
        let result = async {
            let mut file = tokio::fs::File::create(&part).await?;
            let mut stream = resp.bytes_stream();
            let mut total = 0usize;
            while let Some(chunk) = stream.next().await {
                let chunk = chunk?;
                total += chunk.len();
                if total > MAX_DOWNLOAD_BYTES {
                    anyhow::bail!("cover art is larger than {MAX_DOWNLOAD_BYTES} bytes");
                }
                file.write_all(&chunk).await?;
            }
            file.flush().await?;
            tokio::fs::rename(&part, dest).await?;
            Ok(())
        }
        .await;
        if result.is_err() {
            let _ = tokio::fs::remove_file(&part).await;
        }
        result
    }

    /// Reads the cached accent, or computes and stores it. An empty cache file
    /// means "no accent", so gray covers are not decoded again.
    async fn accent_for(&self, image_path: &Path, accent_path: &Path) -> Option<String> {
        if let Ok(cached) = tokio::fs::read_to_string(accent_path).await {
            let cached = cached.trim();
            return (!cached.is_empty()).then(|| cached.to_owned());
        }
        let image_path = image_path.to_owned();
        let accent = tokio::task::spawn_blocking(move || {
            let img = ImageReader::open(&image_path)
                .ok()?
                .with_guessed_format()
                .ok()?
                .decode()
                .ok()?;
            accent_color(&img)
        })
        .await
        .ok()
        .flatten();
        if tokio::fs::create_dir_all(&self.dir).await.is_ok() {
            let _ = tokio::fs::write(accent_path, accent.as_deref().unwrap_or("")).await;
        }
        accent
    }
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
    use image::{DynamicImage, Rgb, RgbImage};
    use wiremock::matchers::path;
    use wiremock::{Mock, MockServer, ResponseTemplate};

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

    fn png_bytes(img: &DynamicImage) -> Vec<u8> {
        let mut out = std::io::Cursor::new(Vec::new());
        img.write_to(&mut out, image::ImageFormat::Png).unwrap();
        out.into_inner()
    }

    fn cache(dir: &tempfile::TempDir) -> ArtCache {
        ArtCache::new(dir.path().join("cache"), reqwest::Client::new())
    }

    #[tokio::test]
    async fn file_url_is_percent_decoded() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("my cover ü.png");
        red_image().save(&file).unwrap();
        let url = url::Url::from_file_path(&file).unwrap();
        assert!(url.as_str().contains("my%20cover%20%C3%BC.png"));
        let info = cache(&dir).resolve(url.as_str()).await.unwrap();
        assert_eq!(info.path, file);
        assert!(info.accent.is_some());
    }

    #[tokio::test]
    async fn missing_file_is_none() {
        let dir = tempfile::tempdir().unwrap();
        assert!(cache(&dir)
            .resolve("file:///does/not/exist.png")
            .await
            .is_none());
    }

    #[tokio::test]
    async fn unknown_scheme_is_none() {
        let dir = tempfile::tempdir().unwrap();
        assert!(cache(&dir)
            .resolve("data:image/png;base64,AAAA")
            .await
            .is_none());
        assert!(cache(&dir).resolve("not a url").await.is_none());
    }

    #[tokio::test]
    async fn http_art_is_downloaded_once() {
        let dir = tempfile::tempdir().unwrap();
        let server = MockServer::start().await;
        Mock::given(path("/cover.png"))
            .respond_with(ResponseTemplate::new(200).set_body_bytes(png_bytes(&red_image())))
            .expect(1)
            .mount(&server)
            .await;
        let url = format!("{}/cover.png", server.uri());
        let art = cache(&dir);
        let first = art.resolve(&url).await.unwrap();
        let second = art.resolve(&url).await.unwrap();
        assert_eq!(first, second);
        assert!(first.path.starts_with(dir.path().join("cache").join("art")));
        assert!(first.accent.is_some());
    }

    #[tokio::test]
    async fn oversized_download_is_rejected() {
        let dir = tempfile::tempdir().unwrap();
        let server = MockServer::start().await;
        Mock::given(path("/huge.png"))
            .respond_with(
                ResponseTemplate::new(200).set_body_bytes(vec![0u8; MAX_DOWNLOAD_BYTES + 1]),
            )
            .mount(&server)
            .await;
        let art = cache(&dir);
        assert!(art
            .resolve(&format!("{}/huge.png", server.uri()))
            .await
            .is_none());
        let leftovers = std::fs::read_dir(dir.path().join("cache").join("art"))
            .map(|d| d.count())
            .unwrap_or(0);
        assert_eq!(leftovers, 0);
    }

    #[tokio::test]
    async fn http_error_is_none() {
        let dir = tempfile::tempdir().unwrap();
        let server = MockServer::start().await;
        Mock::given(path("/gone.png"))
            .respond_with(ResponseTemplate::new(404))
            .mount(&server)
            .await;
        assert!(cache(&dir)
            .resolve(&format!("{}/gone.png", server.uri()))
            .await
            .is_none());
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
