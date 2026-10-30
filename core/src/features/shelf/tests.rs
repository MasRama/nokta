use std::path::Path;
use std::time::{Duration, SystemTime};

use super::model::Item;
use super::service::{self, Command};
use super::thumbnails::{self, ThumbnailDirs};

/// These spell out Unix paths; a Windows path needs a drive letter.
#[cfg(unix)]
mod unix_paths {
    use std::path::PathBuf;

    use super::super::model::{path_of, Item, Shelf, MAX_ITEMS};

    fn item(path: &str) -> Item {
        Item::new(&format!("file://{path}"), false).unwrap()
    }

    #[test]
    fn only_local_file_uris_have_a_path() {
        assert_eq!(
            path_of("file:///tmp/a.txt"),
            Some(PathBuf::from("/tmp/a.txt"))
        );
        assert_eq!(
            path_of("file:///tmp/two%20words.png"),
            Some(PathBuf::from("/tmp/two words.png"))
        );
        assert_eq!(
            path_of("file://localhost/tmp/a.txt"),
            Some(PathBuf::from("/tmp/a.txt"))
        );
        for bad in [
            "https://example.com/a.txt",
            "file://otherhost/tmp/a.txt",
            "/tmp/a.txt",
            "",
            "file:relative",
        ] {
            assert_eq!(path_of(bad), None, "{bad:?}");
        }
    }

    #[test]
    fn an_item_has_a_name_an_icon_and_a_clean_uri() {
        let photo = Item::new("file:///home/ren/Pictures/two%20words.PNG", false).unwrap();
        assert_eq!(photo.name, "two words.PNG");
        assert_eq!(photo.icon, "image-x-generic");
        assert_eq!(photo.uri, "file:///home/ren/Pictures/two%20words.PNG");
        let folder = Item::new("file:///home/ren/Music", true).unwrap();
        assert_eq!(folder.icon, "folder");
        assert_eq!(folder.name, "Music");
        assert!(Item::new("https://example.com/a.png", false).is_none());
    }

    #[test]
    fn add_skips_a_file_already_on_the_shelf() {
        let mut shelf = Shelf::default();
        assert!(shelf.add(item("/tmp/a.txt")));
        assert!(!shelf.add(item("/tmp/a.txt")));
        // The same file written another way is still the same file.
        assert!(!shelf.add(Item::new("file://localhost/tmp/a.txt", false).unwrap()));
        assert!(shelf.add(item("/tmp/b.txt")));
        let names: Vec<_> = shelf.items().iter().map(|i| i.name.as_str()).collect();
        assert_eq!(names, ["a.txt", "b.txt"]);
    }

    #[test]
    fn the_shelf_keeps_the_newest_items() {
        let mut shelf = Shelf::default();
        for n in 0..MAX_ITEMS + 2 {
            shelf.add(item(&format!("/tmp/{n}.txt")));
        }
        assert_eq!(MAX_ITEMS, 30);
        assert_eq!(shelf.items().len(), MAX_ITEMS);
        assert_eq!(shelf.items()[0].name, "2.txt");
        assert_eq!(shelf.items()[MAX_ITEMS - 1].name, "31.txt");
    }

    #[test]
    fn remove_and_clear() {
        let mut shelf = Shelf::default();
        shelf.add(item("/tmp/a b.txt"));
        shelf.add(item("/tmp/c.txt"));
        assert!(!shelf.remove("file:///tmp/missing.txt"));
        assert!(!shelf.remove("not a uri"));
        assert!(shelf.remove("file:///tmp/a%20b.txt"));
        assert_eq!(shelf.items().len(), 1);
        assert!(shelf.clear());
        assert!(shelf.items().is_empty());
        assert!(!shelf.clear());
    }

    #[test]
    fn retain_reports_whether_anything_left() {
        let mut shelf = Shelf::default();
        shelf.add(item("/tmp/a.txt"));
        shelf.add(item("/tmp/b.txt"));
        assert!(!shelf.retain(|_| true));
        assert!(shelf.retain(|i| i.name == "b.txt"));
        assert_eq!(shelf.items().len(), 1);
    }
}

fn uri(path: &Path) -> String {
    url::Url::from_file_path(path).unwrap().to_string()
}

async fn wait_for_len(state: &mut tokio::sync::watch::Receiver<Vec<Item>>, len: usize) {
    let waited = tokio::time::timeout(
        Duration::from_secs(5),
        state.wait_for(|items| items.len() == len),
    )
    .await
    .map(|r| r.is_ok());
    assert!(
        waited == Ok(true),
        "the shelf never had {len} items: {:?}",
        state.borrow()
    );
}

#[tokio::test]
async fn the_service_takes_only_files_that_exist() {
    let dir = tempfile::tempdir().unwrap();
    let file = dir.path().join("report.pdf");
    std::fs::write(&file, "x").unwrap();
    let folder = dir.path().join("photos");
    std::fs::create_dir(&folder).unwrap();
    let handle = service::spawn(dirs(dir.path()));
    let mut state = handle.state.clone();
    handle
        .commands
        .send(Command::Add(vec![
            uri(&file),
            uri(&dir.path().join("missing.txt")),
            "https://example.com/a.png".into(),
            uri(&folder),
        ]))
        .await
        .unwrap();
    wait_for_len(&mut state, 2).await;
    let items = state.borrow().clone();
    assert_eq!(items[0].icon, "x-office-document");
    assert_eq!(items[1].icon, "folder");

    handle
        .commands
        .send(Command::Remove(uri(&file)))
        .await
        .unwrap();
    wait_for_len(&mut state, 1).await;
    handle.commands.send(Command::Clear).await.unwrap();
    wait_for_len(&mut state, 0).await;
}

#[tokio::test]
async fn a_deleted_or_moved_file_leaves_the_shelf() {
    let dir = tempfile::tempdir().unwrap();
    let other = tempfile::tempdir().unwrap();
    let doomed = dir.path().join("doomed.txt");
    let moved = dir.path().join("moved.txt");
    let kept = other.path().join("kept.txt");
    for f in [&doomed, &moved, &kept] {
        std::fs::write(f, "x").unwrap();
    }
    let handle = service::spawn(dirs(dir.path()));
    let mut state = handle.state.clone();
    handle
        .commands
        .send(Command::Add(vec![uri(&doomed), uri(&moved), uri(&kept)]))
        .await
        .unwrap();
    wait_for_len(&mut state, 3).await;

    std::fs::remove_file(&doomed).unwrap();
    wait_for_len(&mut state, 2).await;
    std::fs::rename(&moved, other.path().join("elsewhere.txt")).unwrap();
    wait_for_len(&mut state, 1).await;
    assert_eq!(state.borrow()[0].name, "kept.txt");
}

fn dirs(root: &Path) -> ThumbnailDirs {
    ThumbnailDirs {
        system: Some(root.join("cache/thumbnails")),
        own: root.join("cache/nokta/thumbnails"),
    }
}

fn png(path: &Path, width: u32, height: u32) {
    image::RgbImage::new(width, height).save(path).unwrap();
}

/// Moves a file's modification time `ago` into the past.
fn age(path: &Path, ago: Duration) {
    let file = std::fs::File::options().write(true).open(path).unwrap();
    file.set_modified(SystemTime::now() - ago).unwrap();
}

#[test]
fn files_thumbnails_are_named_after_the_md5_of_the_uri() {
    let [large, normal] = thumbnails::system_paths(
        Path::new("/k/thumbnails"),
        "file:///home/jens/photos/me.png",
    );
    let name = "c6ee772d9e49320e97ec29a7eb5b1697.png";
    assert_eq!(large, Path::new("/k/thumbnails/large").join(name));
    assert_eq!(normal, Path::new("/k/thumbnails/normal").join(name));
    assert_eq!(
        thumbnails::own_path(Path::new("/k/nokta/thumbnails"), "file:///tmp/a.png"),
        Path::new("/k/nokta/thumbnails")
            .join("fc6c0ce8c6d06442535075336e0539f3526f008eb3abd418980873a8740a95d4.png")
    );
}

#[test]
fn a_fresh_thumbnail_from_files_comes_first() {
    let root = tempfile::tempdir().unwrap();
    let dirs = dirs(root.path());
    let file = root.path().join("report.pdf");
    std::fs::write(&file, "x").unwrap();
    age(&file, Duration::from_secs(60));
    let uri = uri(&file);
    let [large, normal] = thumbnails::system_paths(dirs.system.as_deref().unwrap(), &uri);
    for dir in [&large, &normal] {
        std::fs::create_dir_all(dir.parent().unwrap()).unwrap();
    }
    png(&normal, 128, 96);
    assert_eq!(thumbnails::find(&dirs, &uri, &file), Some(normal.clone()));
    png(&large, 256, 192);
    assert_eq!(thumbnails::find(&dirs, &uri, &file), Some(large));
}

#[test]
fn a_thumbnail_older_than_its_file_is_not_used() {
    let root = tempfile::tempdir().unwrap();
    let dirs = dirs(root.path());
    let file = root.path().join("report.pdf");
    std::fs::write(&file, "x").unwrap();
    let uri = uri(&file);
    let [_, normal] = thumbnails::system_paths(dirs.system.as_deref().unwrap(), &uri);
    std::fs::create_dir_all(normal.parent().unwrap()).unwrap();
    png(&normal, 128, 96);
    age(&normal, Duration::from_secs(60));
    assert_eq!(thumbnails::find(&dirs, &uri, &file), None);
}

#[test]
fn an_image_gets_its_own_thumbnail_once() {
    let root = tempfile::tempdir().unwrap();
    let dirs = dirs(root.path());
    let photo = root.path().join("photo.png");
    png(&photo, 512, 256);
    let uri = uri(&photo);
    let made = thumbnails::find(&dirs, &uri, &photo).expect("a thumbnail");
    assert_eq!(made, thumbnails::own_path(&dirs.own, &uri));
    assert_eq!(image::image_dimensions(&made).unwrap(), (128, 64));
    let written = std::fs::metadata(&made).unwrap().modified().unwrap();
    assert_eq!(thumbnails::find(&dirs, &uri, &photo), Some(made.clone()));
    assert_eq!(
        std::fs::metadata(&made).unwrap().modified().unwrap(),
        written
    );
}

#[test]
fn other_files_and_broken_images_have_none() {
    let root = tempfile::tempdir().unwrap();
    let dirs = dirs(root.path());
    let notes = root.path().join("notes.txt");
    let broken = root.path().join("broken.jpg");
    for file in [&notes, &broken] {
        std::fs::write(file, "not an image").unwrap();
        assert_eq!(thumbnails::find(&dirs, &uri(file), file), None);
    }
    assert!(!thumbnails::own_path(&dirs.own, &uri(&broken)).exists());
}

async fn wait_for_thumbnails(
    state: &mut tokio::sync::watch::Receiver<std::collections::BTreeMap<String, String>>,
    want: impl Fn(&std::collections::BTreeMap<String, String>) -> bool,
) {
    let waited = tokio::time::timeout(Duration::from_secs(5), state.wait_for(want))
        .await
        .map(|r| r.is_ok());
    assert!(waited == Ok(true), "thumbnails: {:?}", state.borrow());
}

#[tokio::test]
async fn the_service_publishes_each_items_thumbnail() {
    let dir = tempfile::tempdir().unwrap();
    let photo = dir.path().join("photo.png");
    png(&photo, 300, 300);
    let notes = dir.path().join("notes.txt");
    std::fs::write(&notes, "x").unwrap();
    let handle = service::spawn(dirs(dir.path()));
    let mut thumbs = handle.thumbnails.clone();
    handle
        .commands
        .send(Command::Add(vec![uri(&photo), uri(&notes)]))
        .await
        .unwrap();
    let own = thumbnails::own_path(&dirs(dir.path()).own, &uri(&photo))
        .to_string_lossy()
        .into_owned();
    wait_for_thumbnails(&mut thumbs, |t| {
        t.get(&uri(&photo)) == Some(&own) && t.len() == 1
    })
    .await;

    handle.commands.send(Command::Clear).await.unwrap();
    wait_for_thumbnails(&mut thumbs, |t| t.is_empty()).await;
}
