use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use super::model::{EventKind, Model, REPEAT, SETTLE};

const MS: Duration = Duration::from_millis(1);

fn file(name: &str) -> PathBuf {
    Path::new("/dl").join(name)
}

/// Every file has 10 bytes, except the ones named `empty`.
fn size(path: &Path) -> Option<u64> {
    Some(if path.ends_with("empty") { 0 } else { 10 })
}

#[test]
fn a_renamed_download_is_reported_once_it_settles() {
    let start = Instant::now();
    let mut model = Model::default();
    // A browser writes the .part file, then renames it.
    model.event(file("film.mkv.part"), EventKind::ClosedWrite, start);
    model.event(file("film.mkv"), EventKind::RenamedTo, start);
    assert_eq!(model.next_deadline(), Some(start + SETTLE));
    assert!(model.due(start + SETTLE - MS, size).is_empty());
    assert_eq!(model.due(start + SETTLE, size), [file("film.mkv")]);
    assert_eq!(model.next_deadline(), None);
    assert!(model.due(start + SETTLE * 2, size).is_empty());
}

#[test]
fn hidden_and_temporary_names_are_skipped() {
    let now = Instant::now();
    let mut model = Model::default();
    for name in [
        ".hidden",
        "a.part",
        "b.crdownload",
        "c.download",
        "d.partial",
        "e.tmp",
        "f.opdownload",
        "g.txt~",
        "H.PART",
    ] {
        model.event(file(name), EventKind::RenamedTo, now);
        model.event(file(name), EventKind::ClosedWrite, now);
    }
    assert_eq!(model.next_deadline(), None);
}

#[test]
fn empty_files_and_folders_are_skipped() {
    let now = Instant::now();
    let mut model = Model::default();
    model.event(file("empty"), EventKind::ClosedWrite, now);
    model.event(file("folder"), EventKind::RenamedTo, now);
    let is_folder = |path: &Path| {
        if path.ends_with("folder") {
            None
        } else {
            size(path)
        }
    };
    assert!(model.due(now + SETTLE, is_folder).is_empty());
}

#[test]
fn more_writes_push_the_deadline() {
    let start = Instant::now();
    let mut model = Model::default();
    model.event(file("song.flac"), EventKind::ClosedWrite, start);
    model.event(
        file("song.flac"),
        EventKind::ClosedWrite,
        start + SETTLE - MS,
    );
    assert!(model.due(start + SETTLE, size).is_empty());
    assert_eq!(model.next_deadline(), Some(start + SETTLE * 2 - MS));
    assert_eq!(model.due(start + SETTLE * 2, size), [file("song.flac")]);
}

#[test]
fn the_same_file_is_not_reported_twice_within_a_minute() {
    let start = Instant::now();
    let mut model = Model::default();
    model.event(file("a.pdf"), EventKind::ClosedWrite, start);
    assert_eq!(model.due(start + SETTLE, size), [file("a.pdf")]);
    // Something touches it again a moment later.
    let again = start + SETTLE + Duration::from_secs(5);
    model.event(file("a.pdf"), EventKind::ClosedWrite, again);
    assert!(model.due(again + SETTLE, size).is_empty());
    // Downloaded once more, later.
    let later = start + SETTLE + REPEAT;
    model.event(file("a.pdf"), EventKind::RenamedTo, later);
    assert_eq!(model.due(later + SETTLE, size), [file("a.pdf")]);
}

#[test]
fn a_file_removed_before_it_settles_is_not_reported() {
    let now = Instant::now();
    let mut model = Model::default();
    model.event(file("a.zip"), EventKind::ClosedWrite, now);
    model.event(file("a.zip"), EventKind::Removed, now + MS);
    assert_eq!(model.next_deadline(), None);
    assert!(model.due(now + SETTLE * 2, size).is_empty());
}

#[test]
fn several_files_settle_in_name_order() {
    let now = Instant::now();
    let mut model = Model::default();
    model.event(file("b.png"), EventKind::ClosedWrite, now);
    model.event(file("a.png"), EventKind::ClosedWrite, now + MS);
    assert_eq!(model.next_deadline(), Some(now + SETTLE));
    assert_eq!(
        model.due(now + SETTLE + MS, size),
        [file("a.png"), file("b.png")]
    );
}

mod events {
    use notify::event::{AccessKind, AccessMode, ModifyKind, RemoveKind, RenameMode};
    use notify::{Event, EventKind as Raw};

    use super::*;
    use crate::features::downloads::watch::kinds;

    fn event(kind: Raw, paths: &[&str]) -> Event {
        paths
            .iter()
            .fold(Event::new(kind), |e, name| e.add_path(file(name)))
    }

    #[test]
    fn a_rename_reports_both_ends() {
        let both = event(
            Raw::Modify(ModifyKind::Name(RenameMode::Both)),
            &["a.part", "a"],
        );
        assert_eq!(
            kinds(&both),
            [
                (file("a.part"), EventKind::Removed),
                (file("a"), EventKind::RenamedTo)
            ]
        );
        let to = event(Raw::Modify(ModifyKind::Name(RenameMode::To)), &["b"]);
        assert_eq!(kinds(&to), [(file("b"), EventKind::RenamedTo)]);
        let from = event(Raw::Modify(ModifyKind::Name(RenameMode::From)), &["c"]);
        assert_eq!(kinds(&from), [(file("c"), EventKind::Removed)]);
    }

    #[test]
    fn a_closed_write_and_a_removal_are_seen() {
        let closed = event(Raw::Access(AccessKind::Close(AccessMode::Write)), &["a"]);
        assert_eq!(kinds(&closed), [(file("a"), EventKind::ClosedWrite)]);
        let removed = event(Raw::Remove(RemoveKind::File), &["a"]);
        assert_eq!(kinds(&removed), [(file("a"), EventKind::Removed)]);
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn writes_still_going_on_are_not_candidates() {
        // wget and curl write the final name directly; only the close counts.
        for raw in [
            Raw::Create(notify::event::CreateKind::File),
            Raw::Modify(ModifyKind::Data(notify::event::DataChange::Any)),
            Raw::Access(AccessKind::Open(AccessMode::Any)),
        ] {
            assert!(kinds(&event(raw, &["a"])).is_empty(), "{raw:?}");
        }
    }
}

mod service {
    use tokio::sync::watch;

    use super::super::service::{self, Finished, KEEP_THUMBNAILS};
    use crate::features::settings::DownloadsConfig;

    fn config(folder: &std::path::Path) -> DownloadsConfig {
        DownloadsConfig {
            enabled: true,
            folder: folder.display().to_string(),
        }
    }

    async fn next(finished: &mut tokio::sync::mpsc::Receiver<Finished>) -> Option<Finished> {
        tokio::time::timeout(std::time::Duration::from_secs(5), finished.recv())
            .await
            .ok()
            .flatten()
    }

    #[tokio::test]
    async fn a_new_file_in_the_folder_is_finished() {
        let dir = tempfile::tempdir().unwrap();
        let folder = dir.path().join("dl");
        std::fs::create_dir(&folder).unwrap();
        let (_config, rx) = watch::channel(config(&folder));
        let mut finished = service::spawn(rx, None, dir.path().join("thumbs"));
        // Give the watcher a moment to start.
        tokio::time::sleep(std::time::Duration::from_millis(200)).await;

        std::fs::write(folder.join("notes.pdf.part"), "%PDF").unwrap();
        std::fs::rename(folder.join("notes.pdf.part"), folder.join("notes.pdf")).unwrap();
        let file = next(&mut finished).await.expect("no Finished");
        assert_eq!(file.name, "notes.pdf");
        assert_eq!(file.size, 4);
        assert_eq!(file.icon, "x-office-document");
        assert!(file.uri.starts_with("file:///"), "{}", file.uri);
        assert!(file.uri.ends_with("/dl/notes.pdf"), "{}", file.uri);
        assert_eq!(file.thumbnail, "");

        let picture = image::RgbImage::from_pixel(300, 200, image::Rgb([200, 40, 40]));
        picture.save(folder.join("photo.png")).unwrap();
        let file = next(&mut finished).await.expect("no Finished");
        assert_eq!(file.name, "photo.png");
        assert!(std::path::Path::new(&file.thumbnail).is_file(), "{file:?}");
        assert!(file
            .thumbnail
            .starts_with(&dir.path().join("thumbs").display().to_string()));
    }

    #[tokio::test]
    async fn nothing_is_watched_while_it_is_off() {
        let dir = tempfile::tempdir().unwrap();
        let (config_tx, rx) = watch::channel(DownloadsConfig {
            enabled: false,
            ..config(dir.path())
        });
        let mut finished = service::spawn(rx, None, dir.path().join("thumbs"));
        tokio::time::sleep(std::time::Duration::from_millis(200)).await;
        std::fs::write(dir.path().join("a.txt"), "a").unwrap();
        tokio::time::sleep(std::time::Duration::from_millis(2000)).await;
        assert!(finished.try_recv().is_err());

        // Turned on, the folder is watched from then on.
        config_tx.send(config(dir.path())).unwrap();
        tokio::time::sleep(std::time::Duration::from_millis(200)).await;
        std::fs::write(dir.path().join("b.txt"), "b").unwrap();
        assert_eq!(
            next(&mut finished).await.expect("no Finished").name,
            "b.txt"
        );
    }

    #[tokio::test]
    async fn a_missing_folder_watches_nothing() {
        let dir = tempfile::tempdir().unwrap();
        let (_config, rx) = watch::channel(config(&dir.path().join("gone")));
        let mut finished = service::spawn(rx, Some(dir.path().to_owned()), dir.path().join("t"));
        tokio::time::sleep(std::time::Duration::from_millis(200)).await;
        std::fs::write(dir.path().join("a.txt"), "a").unwrap();
        tokio::time::sleep(std::time::Duration::from_millis(2000)).await;
        assert!(finished.try_recv().is_err());
    }

    #[test]
    fn only_the_newest_thumbnails_are_kept() {
        let dir = tempfile::tempdir().unwrap();
        let old = std::time::SystemTime::now() - std::time::Duration::from_secs(3600);
        for i in 0..KEEP_THUMBNAILS + 3 {
            let path = dir.path().join(format!("{i:02}.png"));
            std::fs::write(&path, "x").unwrap();
            let file = std::fs::File::options().write(true).open(&path).unwrap();
            file.set_modified(old + std::time::Duration::from_secs(i as u64))
                .unwrap();
        }
        service::prune(dir.path(), KEEP_THUMBNAILS);
        let mut left: Vec<String> = std::fs::read_dir(dir.path())
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        left.sort();
        assert_eq!(left.len(), KEEP_THUMBNAILS);
        assert_eq!(left[0], "03.png");
    }
}
