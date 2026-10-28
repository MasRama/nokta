use std::path::{Path, PathBuf};
use std::time::Duration;

use super::model::{icon_for, path_of, Item, Shelf, MAX_ITEMS};
use super::service::{self, Command};

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
fn icons_follow_the_file_kind() {
    let cases = [
        ("a.jpg", "image-x-generic"),
        ("a.webp", "image-x-generic"),
        ("a.mp4", "video-x-generic"),
        ("a.mkv", "video-x-generic"),
        ("a.mp3", "audio-x-generic"),
        ("a.flac", "audio-x-generic"),
        ("a.pdf", "x-office-document"),
        ("a.docx", "x-office-document"),
        ("a.odt", "x-office-document"),
        ("a.xlsx", "x-office-spreadsheet"),
        ("a.csv", "x-office-spreadsheet"),
        ("a.pptx", "x-office-presentation"),
        ("a.zip", "package-x-generic"),
        ("a.tar.gz", "package-x-generic"),
        ("a.txt", "text-x-generic"),
        ("a.md", "text-x-generic"),
        ("a.bin", "application-x-generic"),
        ("no-extension", "application-x-generic"),
    ];
    for (name, icon) in cases {
        assert_eq!(icon_for(Path::new(name), false), icon, "{name}");
    }
    assert_eq!(icon_for(Path::new("photos.jpg"), true), "folder");
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
    let handle = service::spawn();
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
    let handle = service::spawn();
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
