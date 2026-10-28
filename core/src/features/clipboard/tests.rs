use super::model::{
    png_size, preview_of, Added, Content, History, MAX_IMAGE_BYTES, MAX_TEXT_BYTES,
};

fn text(s: &str) -> Content {
    Content::Text(s.into())
}

/// A PNG signature and header for a picture of `width` x `height`.
fn png_header(width: u32, height: u32) -> Vec<u8> {
    let mut bytes = vec![0x89, b'P', b'N', b'G', b'\r', b'\n', 0x1a, b'\n'];
    bytes.extend_from_slice(&13u32.to_be_bytes());
    bytes.extend_from_slice(b"IHDR");
    bytes.extend_from_slice(&width.to_be_bytes());
    bytes.extend_from_slice(&height.to_be_bytes());
    bytes.extend_from_slice(&[8, 6, 0, 0, 0]);
    bytes
}

fn ids(history: &History) -> Vec<&str> {
    history.entries().iter().map(|e| e.id.as_str()).collect()
}

#[test]
fn text_and_pictures_are_checked_before_they_are_kept() {
    assert!(Content::new("text", "hello", Vec::new()).is_some());
    assert!(
        Content::new("text", "  \n\t", Vec::new()).is_none(),
        "blank"
    );
    assert!(Content::new("text", &"x".repeat(MAX_TEXT_BYTES + 1), Vec::new()).is_none());
    assert!(Content::new("image", "", png_header(4, 3)).is_some());
    assert!(Content::new("image", "", b"not a png".to_vec()).is_none());
    let mut big = png_header(4, 3);
    big.resize(MAX_IMAGE_BYTES + 1, 0);
    assert!(Content::new("image", "", big).is_none());
    assert!(Content::new("file", "a", Vec::new()).is_none());
}

#[test]
fn a_preview_is_the_first_line_with_text_cut_short() {
    assert_eq!(
        preview_of(&text("  hello   world  \nsecond")),
        "hello world"
    );
    assert_eq!(preview_of(&text("\n\n  third line")), "third line");
    let long = "é".repeat(200);
    let preview = preview_of(&text(&long));
    assert_eq!(preview.chars().count(), 101);
    assert!(preview.ends_with('…'));
    assert_eq!(
        preview_of(&Content::Image(png_header(1920, 1080))),
        "1920 × 1080"
    );
    assert_eq!(png_size(&png_header(7, 9)), Some((7, 9)));
    assert_eq!(png_size(b"short"), None);
}

#[test]
fn the_newest_entry_comes_first_and_the_oldest_goes() {
    let mut history = History::new(3);
    for (i, s) in ["a", "b", "c"].into_iter().enumerate() {
        assert!(
            matches!(history.add(text(s), i as i64), Added::New { ref evicted, .. } if evicted.is_empty())
        );
    }
    assert_eq!(ids(&history), ["3", "2", "1"]);
    let Added::New { id, evicted } = history.add(text("d"), 10) else {
        panic!("d is new");
    };
    assert_eq!(id, "4");
    assert_eq!(evicted, ["1"]);
    assert_eq!(ids(&history), ["4", "3", "2"]);
    assert_eq!(history.entries()[0].time_us, 10);
}

#[test]
fn copying_the_same_again_moves_it_to_the_top() {
    let mut history = History::new(5);
    history.add(text("a"), 1);
    history.add(text("b"), 2);
    assert!(history.pin("1", true));
    assert_eq!(history.add(text("a"), 3), Added::Moved("1".into()));
    assert_eq!(ids(&history), ["1", "2"]);
    let top = &history.entries()[0];
    assert!(top.pinned, "it stays pinned");
    assert_eq!(top.time_us, 3);
    assert_eq!(
        history.add(text("a"), 4),
        Added::Unchanged,
        "already on top"
    );
}

#[test]
fn pinned_entries_are_never_evicted_or_cleared() {
    let mut history = History::new(2);
    history.add(text("a"), 1);
    history.add(text("b"), 2);
    history.pin("1", true);
    history.pin("2", true);
    let Added::New { evicted, .. } = history.add(text("c"), 3) else {
        panic!("c is new");
    };
    assert!(evicted.is_empty(), "only pinned ones to evict");
    assert_eq!(ids(&history), ["3", "2", "1"]);
    history.add(text("d"), 4);
    assert_eq!(
        ids(&history),
        ["4", "3", "2", "1"],
        "pinned ones do not count"
    );
    let Added::New { evicted, .. } = history.add(text("e"), 5) else {
        panic!("e is new");
    };
    assert_eq!(evicted, ["3"], "c was the oldest unpinned");
    assert_eq!(history.clear(), ["5", "4"]);
    assert_eq!(ids(&history), ["2", "1"]);
    assert!(!history.pin("9", true));
}

#[test]
fn a_smaller_limit_evicts_at_once_and_remove_returns_the_entry() {
    let mut history = History::new(5);
    for s in ["a", "b", "c", "d"] {
        history.add(text(s), 0);
    }
    assert_eq!(history.set_max(2), ["1", "2"], "oldest first");
    assert_eq!(ids(&history), ["4", "3"]);
    let removed = history.remove("3").unwrap();
    assert_eq!(removed.content, text("c"));
    assert!(history.remove("3").is_none());
    assert_eq!(history.get("4").unwrap().content, text("d"));
    assert_eq!(history.forget_all(), ["4"]);
    assert!(history.entries().is_empty());
}

mod service_tests {
    use std::io::Cursor;
    use std::path::Path;
    use std::time::Duration;

    use tokio::sync::{oneshot, watch};

    use super::super::model::Content;
    use super::super::service::{self, Command, Handle, Published};
    use crate::features::settings::ClipboardConfig;

    fn png(width: u32, height: u32) -> Vec<u8> {
        let picture = image::RgbImage::from_pixel(width, height, image::Rgb([40, 120, 240]));
        let mut bytes = Cursor::new(Vec::new());
        picture
            .write_to(&mut bytes, image::ImageFormat::Png)
            .unwrap();
        bytes.into_inner()
    }

    fn start(dir: &Path) -> (watch::Sender<ClipboardConfig>, Handle) {
        let (config_tx, config) = watch::channel(ClipboardConfig::default());
        (config_tx, service::spawn(config, dir.to_path_buf(), || 42))
    }

    async fn until(handle: &mut Handle, check: impl Fn(&Published) -> bool) -> Published {
        tokio::time::timeout(Duration::from_secs(5), async {
            loop {
                let now = handle.state.borrow_and_update().clone();
                if check(&now) {
                    return now;
                }
                handle.state.changed().await.unwrap();
            }
        })
        .await
        .expect("the clipboard service never got there")
    }

    async fn send(handle: &Handle, command: Command) {
        handle.commands.send(command).await.unwrap();
    }

    #[tokio::test]
    async fn copied_text_is_published_and_given_back() {
        let dir = tempfile::tempdir().unwrap();
        let (_config, mut handle) = start(dir.path());
        send(&handle, Command::Add(Content::Text("hello\nworld".into()))).await;
        let state = until(&mut handle, |s| s.items.len() == 1).await;
        let row = &state.items[0];
        assert_eq!(
            (row.kind, row.preview.as_str(), row.thumbnail.as_str()),
            ("text", "hello", "")
        );
        assert_eq!(row.time_us, 42);
        assert!(!row.pinned);

        let (tx, rx) = oneshot::channel();
        send(&handle, Command::Get(row.id.clone(), tx)).await;
        assert_eq!(
            rx.await.unwrap(),
            Some(Content::Text("hello\nworld".into()))
        );
        let (tx, rx) = oneshot::channel();
        send(&handle, Command::Get("nope".into(), tx)).await;
        assert_eq!(rx.await.unwrap(), None);

        send(&handle, Command::Pin(row.id.clone(), true)).await;
        until(&mut handle, |s| s.items[0].pinned).await;
        send(&handle, Command::Clear).await;
        send(&handle, Command::Remove(row.id.clone())).await;
        until(&mut handle, |s| s.items.is_empty()).await;
    }

    #[tokio::test]
    async fn nothing_is_kept_while_paused() {
        let dir = tempfile::tempdir().unwrap();
        let (_config, mut handle) = start(dir.path());
        send(&handle, Command::SetPaused(true)).await;
        until(&mut handle, |s| s.paused).await;
        send(&handle, Command::Add(Content::Text("secret".into()))).await;
        send(&handle, Command::SetPaused(false)).await;
        send(&handle, Command::Add(Content::Text("open".into()))).await;
        let state = until(&mut handle, |s| !s.items.is_empty()).await;
        assert!(!state.paused);
        assert_eq!(state.items.len(), 1);
        assert_eq!(state.items[0].preview, "open");
    }

    #[tokio::test]
    async fn a_picture_gets_a_thumbnail_that_goes_with_it() {
        let dir = tempfile::tempdir().unwrap();
        let stale = dir.path().join("old.png");
        std::fs::write(&stale, b"from the last run").unwrap();
        let (_config, mut handle) = start(dir.path());
        send(&handle, Command::Add(Content::Image(png(400, 200)))).await;
        let state = until(&mut handle, |s| {
            s.items.first().is_some_and(|r| !r.thumbnail.is_empty())
        })
        .await;
        let row = &state.items[0];
        assert_eq!((row.kind, row.preview.as_str()), ("image", "400 × 200"));
        let thumbnail = image::open(&row.thumbnail).unwrap();
        assert_eq!((thumbnail.width(), thumbnail.height()), (128, 64));
        assert!(!stale.exists(), "files from the last run are deleted");

        send(&handle, Command::Remove(row.id.clone())).await;
        until(&mut handle, |s| s.items.is_empty()).await;
        let path = row.thumbnail.clone();
        tokio::time::timeout(Duration::from_secs(5), async {
            while Path::new(&path).exists() {
                tokio::time::sleep(Duration::from_millis(20)).await;
            }
        })
        .await
        .expect("the thumbnail is deleted with its entry");
    }

    #[tokio::test]
    async fn the_config_sets_the_size_and_turning_it_off_forgets_everything() {
        let dir = tempfile::tempdir().unwrap();
        let (config, mut handle) = start(dir.path());
        for i in 0..8 {
            send(&handle, Command::Add(Content::Text(format!("copy {i}")))).await;
        }
        let oldest = until(&mut handle, |s| s.items.len() == 8).await.items[7]
            .id
            .clone();
        send(&handle, Command::Pin(oldest, true)).await;
        until(&mut handle, |s| s.items[7].pinned).await;
        config.send_modify(|c| c.max_items = 5);
        let state = until(&mut handle, |s| s.items.len() == 6).await;
        assert_eq!(state.items[0].preview, "copy 7");
        assert_eq!(state.items[5].preview, "copy 0", "pinned stays");

        config.send_modify(|c| c.enabled = false);
        until(&mut handle, |s| s.items.is_empty()).await;
        send(&handle, Command::Add(Content::Text("while off".into()))).await;
        // Commands run in order, so once this answers the copy was turned away.
        let (tx, rx) = oneshot::channel();
        send(&handle, Command::Get("1".into(), tx)).await;
        rx.await.unwrap();
        config.send_modify(|c| c.enabled = true);
        send(&handle, Command::Add(Content::Text("back on".into()))).await;
        let state = until(&mut handle, |s| !s.items.is_empty()).await;
        assert_eq!(state.items.len(), 1);
        assert_eq!(state.items[0].preview, "back on");
    }
}
