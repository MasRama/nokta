//! Cover art: resolves `mpris:artUrl` to a local file the extension can load,
//! downloads `http(s)` art once into the cache, and derives an accent color.

use std::path::{Path, PathBuf};
use std::time::{Duration, UNIX_EPOCH};

use futures_util::StreamExt;
use image::{imageops::FilterType, DynamicImage, ImageFormat, ImageReader};
use tokio::io::AsyncWriteExt;

use crate::shared::hash::sha256_hex;
use crate::shared::picture::accent_color;

pub const MAX_DOWNLOAD_BYTES: usize = 5 * 1024 * 1024;
const DOWNLOAD_TIMEOUT: Duration = Duration::from_secs(10);
/// The backdrop fits in a square this size: the notch stretches it anyway.
pub const BACKDROP_SIZE: u32 = 160;
const BACKDROP_SIGMA: f32 = 12.0;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ArtInfo {
    pub path: PathBuf,
    pub accent: Option<String>,
    /// The cover downsized and blurred, to show behind the player.
    pub backdrop: Option<PathBuf>,
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
        let (accent, backdrop) = self
            .derive(
                &path,
                &self.dir.join(format!("{key}.accent")),
                &self.dir.join(format!("{key}.backdrop.png")),
            )
            .await;
        Some(ArtInfo {
            path,
            accent,
            backdrop,
        })
    }

    async fn resolve_http(&self, url: &str) -> Option<ArtInfo> {
        let path = self.dir.join(sha256_hex(url));
        if tokio::fs::metadata(&path).await.is_err() {
            if let Err(err) = self.download(url, &path).await {
                tracing::debug!(%url, %err, "cover art download failed");
                return None;
            }
        }
        let (accent, backdrop) = self
            .derive(
                &path,
                &path.with_extension("accent"),
                &path.with_extension("backdrop.png"),
            )
            .await;
        Some(ArtInfo {
            path,
            accent,
            backdrop,
        })
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

    /// Reads the cached accent and backdrop, or decodes the cover once to
    /// make and store what is missing. An empty accent file means "no
    /// accent", so gray covers are not decoded again for it.
    async fn derive(
        &self,
        image_path: &Path,
        accent_path: &Path,
        backdrop_path: &Path,
    ) -> (Option<String>, Option<PathBuf>) {
        let cached = tokio::fs::read_to_string(accent_path)
            .await
            .ok()
            .map(|a| a.trim().to_owned());
        let has_backdrop = tokio::fs::metadata(backdrop_path)
            .await
            .is_ok_and(|m| m.is_file());
        if let (Some(accent), true) = (&cached, has_backdrop) {
            return (
                (!accent.is_empty()).then(|| accent.clone()),
                Some(backdrop_path.to_owned()),
            );
        }
        if tokio::fs::create_dir_all(&self.dir).await.is_err() {
            return (cached.filter(|a| !a.is_empty()), None);
        }
        let image_path = image_path.to_owned();
        let backdrop_path = backdrop_path.to_owned();
        let accent_path = accent_path.to_owned();
        tokio::task::spawn_blocking(move || {
            let decoded = ImageReader::open(&image_path)
                .ok()
                .and_then(|r| r.with_guessed_format().ok())
                .and_then(|r| r.decode().ok());
            let accent = match cached {
                Some(accent) => (!accent.is_empty()).then_some(accent),
                None => {
                    let accent = decoded.as_ref().and_then(accent_color);
                    let _ = std::fs::write(&accent_path, accent.as_deref().unwrap_or(""));
                    accent
                }
            };
            let backdrop = if has_backdrop {
                Some(backdrop_path)
            } else {
                decoded.and_then(|img| write_backdrop(&img, &backdrop_path).ok())
            };
            (accent, backdrop)
        })
        .await
        .unwrap_or((None, None))
    }
}

/// Writes `img` downsized and blurred to `dest`, through a partial file so
/// the extension never reads half of it.
fn write_backdrop(img: &DynamicImage, dest: &Path) -> anyhow::Result<PathBuf> {
    let small = img
        .resize(BACKDROP_SIZE, BACKDROP_SIZE, FilterType::Triangle)
        .fast_blur(BACKDROP_SIGMA);
    let partial = dest.with_extension("partial");
    small
        .to_rgb8()
        .save_with_format(&partial, ImageFormat::Png)?;
    std::fs::rename(&partial, dest)?;
    Ok(dest.to_owned())
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
    async fn a_cover_gets_a_small_blurred_backdrop() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("cover.png");
        DynamicImage::ImageRgb8(RgbImage::from_fn(600, 400, |x, _| {
            if x < 300 {
                Rgb([220, 30, 40])
            } else {
                Rgb([30, 40, 220])
            }
        }))
        .save(&file)
        .unwrap();
        let url = url::Url::from_file_path(&file).unwrap();
        let art = cache(&dir);
        let info = art.resolve(url.as_str()).await.unwrap();
        let backdrop = info.backdrop.clone().unwrap();
        assert!(backdrop.starts_with(dir.path().join("cache").join("art")));
        assert!(backdrop.to_string_lossy().ends_with(".backdrop.png"));
        let img = image::open(&backdrop).unwrap().to_rgb8();
        assert_eq!((img.width(), img.height()), (BACKDROP_SIZE, 107));
        // Blurred: the middle mixes the two halves.
        let mid = img.get_pixel(BACKDROP_SIZE / 2, 53).0;
        assert!(mid[0] > 60 && mid[2] > 60, "{mid:?}");

        let written = std::fs::metadata(&backdrop).unwrap().modified().unwrap();
        let again = art.resolve(url.as_str()).await.unwrap();
        assert_eq!(again, info);
        assert_eq!(
            std::fs::metadata(&backdrop).unwrap().modified().unwrap(),
            written
        );
    }

    #[tokio::test]
    async fn a_broken_cover_has_no_backdrop() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("cover.png");
        std::fs::write(&file, "not a picture").unwrap();
        let url = url::Url::from_file_path(&file).unwrap();
        let info = cache(&dir).resolve(url.as_str()).await.unwrap();
        assert_eq!(info.backdrop, None);
        assert_eq!(info.accent, None);
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
        assert!(first.backdrop.is_some_and(|b| b.is_file()));
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
}
