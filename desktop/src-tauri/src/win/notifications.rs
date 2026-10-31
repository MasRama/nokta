//! Toasts other apps show: Windows keeps each in its notification database
//! (`%LOCALAPPDATA%\Microsoft\Windows\Notifications\wpndatabase.db`), which
//! this reads, never writes, while `[notifications] in_notch` is on. A
//! change to the folder wakes it, and it looks again every 2 s, as Windows
//! may write the database without the folder saying so. Windows still
//! shows its own banner; the user turns those off per app.

use std::collections::{HashMap, VecDeque};
use std::path::{Path, PathBuf};
use std::sync::mpsc::{channel, Receiver, RecvTimeoutError};
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use nokta_core::features::settings::Config;
use rusqlite::types::ValueRef;
use rusqlite::{Connection, OpenFlags};
use tokio::sync::{mpsc, watch};
use windows::core::{Interface, HSTRING, PCWSTR};
use windows::Win32::Foundation::SIZE;
use windows::Win32::Graphics::Gdi::{
    DeleteObject, GetDC, GetDIBits, GetObjectW, ReleaseDC, BITMAP, BITMAPINFO, BITMAPINFOHEADER,
    BI_RGB, DIB_RGB_COLORS, HBITMAP, HGDIOBJ,
};
use windows::Win32::System::Com::{CoInitializeEx, CoTaskMemFree, COINIT_APARTMENTTHREADED};
use windows::Win32::UI::Shell::{
    FOLDERID_AppsFolder, IShellItem, IShellItemImageFactory, SHCreateItemInKnownFolder,
    SHQueryUserNotificationState, KF_FLAG_DEFAULT, SIGDN_NORMALDISPLAY, SIIGBF_ICONONLY,
};

use crate::bridge::notifications::Posted;
use crate::toast::{self, Toast};

/// How often the database is looked at without a word from the folder.
const POLL: Duration = Duration::from_secs(2);
/// A wake comes as Windows starts writing: the toast is in a moment later.
const SETTLE: Duration = Duration::from_millis(150);
/// At most this many new toasts are read at once.
const BATCH: usize = 20;
/// A toast older than this when read is not new: the app was asleep.
const STALE_MS: i64 = 60_000;
/// The toasts a click may still open.
const KEPT: usize = 20;
/// A toast's picture larger than this is not copied.
const MAX_PICTURE_BYTES: u64 = 4 << 20;
/// The app icon's size, in px.
const ICON_PX: i32 = 64;

/// A toast that showed, for a click on it.
struct Kept {
    id: i64,
    aumid: String,
    toast: Toast,
    /// Its picture's copy in the cache, removed with it.
    picture: Option<PathBuf>,
}

static KEPT_TOASTS: Mutex<VecDeque<Kept>> = Mutex::new(VecDeque::new());

/// Reads new toasts while `[notifications] in_notch` is on; their pictures
/// go to `cache_dir`.
pub fn spawn(config: watch::Receiver<Config>, cache_dir: &Path) -> mpsc::Receiver<Posted> {
    let (tx, rx) = mpsc::channel(8);
    let cache = cache_dir.join("notifications");
    let started = std::thread::Builder::new()
        .name("nokta-notifications".into())
        .spawn(move || run(config, cache, tx));
    if let Err(err) = started {
        tracing::warn!("no notifications in the notch: {err}");
    }
    rx
}

/// Opens what a click on toast `id` opens, or on its button at `button`:
/// the URI it launches, else its app.
pub fn activate(id: i64, button: Option<usize>) -> Result<(), String> {
    let target = {
        let kept = KEPT_TOASTS.lock().unwrap_or_else(|e| e.into_inner());
        let kept = kept
            .iter()
            .find(|k| k.id == id)
            .ok_or_else(|| format!("no notification {id}"))?;
        kept.toast.target(button, &kept.aumid)
    };
    super::shell_open(&target)
}

fn run(config: watch::Receiver<Config>, cache: PathBuf, tx: mpsc::Sender<Posted>) {
    // The shell's app names and icons are COM.
    // SAFETY: once, on this thread, before any COM call.
    if let Err(err) = unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED) }.ok() {
        tracing::warn!("no app names for notifications: {err}");
    }
    let Ok(local) = std::env::var("LOCALAPPDATA") else {
        tracing::warn!("no notifications in the notch: no LOCALAPPDATA");
        return;
    };
    let folder = Path::new(&local).join("Microsoft\\Windows\\Notifications");
    // Pictures of the last run's toasts are no use now.
    let pictures = cache.join("toasts");
    let _ = std::fs::remove_dir_all(&pictures);
    let _ = std::fs::create_dir_all(&pictures);
    let _ = std::fs::create_dir_all(cache.join("apps"));
    let (wake_tx, wake) = channel();
    let _watcher = watch(&folder, wake_tx);
    let mut reader: Option<Reader> = None;
    let mut apps: HashMap<String, (String, Option<String>)> = HashMap::new();
    let mut warned = false;
    while !tx.is_closed() {
        wait(&wake);
        if !config.borrow().notifications.in_notch {
            // Back on, it starts from the toasts that come then.
            reader = None;
            continue;
        }
        let db = match &mut reader {
            Some(db) => db,
            None => match Reader::open(&folder.join("wpndatabase.db")) {
                Ok(db) => reader.insert(db),
                Err(err) => {
                    if !warned {
                        tracing::warn!("cannot read Windows' notifications: {err}");
                        warned = true;
                    }
                    continue;
                }
            },
        };
        let rows = match db.new_toasts() {
            Ok(rows) => rows,
            Err(err) => {
                tracing::warn!("cannot read Windows' notifications: {err}");
                reader = None;
                continue;
            }
        };
        if rows.is_empty() || quiet() {
            continue;
        }
        let now = now_ms();
        for row in rows {
            if now - toast::unix_ms(row.arrival) > STALE_MS {
                continue;
            }
            let Some(toast) = toast::parse(&row.payload) else {
                continue;
            };
            let (app, icon) = apps
                .entry(row.aumid.clone())
                .or_insert_with(|| app_of(&row.aumid, &cache.join("apps")))
                .clone();
            let picture = toast
                .logo
                .as_deref()
                .and_then(|src| toast::picture_path(src, &row.aumid, &local))
                .and_then(|path| copy_picture(Path::new(&path), &pictures, &row));
            let posted = Posted {
                id: row.id,
                app_id: row.aumid.clone(),
                app,
                title: toast.title.clone(),
                body: toast.body.clone(),
                icon: picture.as_ref().map(|p| p.display().to_string()).or(icon),
                round: picture.is_some() && toast.round,
                buttons: toast.buttons.iter().map(|b| b.label.clone()).collect(),
            };
            keep(Kept {
                id: row.id,
                aumid: row.aumid,
                toast,
                picture,
            });
            if tx.blocking_send(posted).is_err() {
                return;
            }
        }
    }
}

/// Waits for a word from the folder, settled, or the next look.
fn wait(wake: &Receiver<()>) {
    match wake.recv_timeout(POLL) {
        Ok(()) => {
            std::thread::sleep(SETTLE);
            while wake.try_recv().is_ok() {}
        }
        Err(RecvTimeoutError::Timeout) => {}
        // No watcher: only the looks.
        Err(RecvTimeoutError::Disconnected) => std::thread::sleep(POLL),
    }
}

/// Wakes `wake` on each change in `folder`; None if it cannot be watched.
fn watch(folder: &Path, wake: std::sync::mpsc::Sender<()>) -> Option<notify::RecommendedWatcher> {
    use notify::Watcher;

    let mut watcher = notify::recommended_watcher(move |event: notify::Result<notify::Event>| {
        if event.is_ok() {
            let _ = wake.send(());
        }
    })
    .map_err(|err| tracing::warn!("notifications are looked at every 2 s: {err}"))
    .ok()?;
    watcher
        .watch(folder, notify::RecursiveMode::NonRecursive)
        .map_err(|err| tracing::warn!("notifications are looked at every 2 s: {err}"))
        .ok()?;
    Some(watcher)
}

/// A new toast's row.
struct Row {
    id: i64,
    arrival: i64,
    payload: Vec<u8>,
    aumid: String,
}

/// The database, opened read only, and how far it was read.
struct Reader {
    db: Connection,
    /// SQLite's count of the changes others made, when last read.
    version: Option<i64>,
    /// The arrival time of the newest toast read.
    last: i64,
}

impl Reader {
    /// Opens the database; what it holds already is not new.
    fn open(path: &Path) -> rusqlite::Result<Reader> {
        let flags = OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX;
        let db = Connection::open_with_flags(path, flags)?;
        db.busy_timeout(Duration::from_millis(250))?;
        let last = db.query_row(
            "select coalesce(max(ArrivalTime), 0) from Notification",
            [],
            |row| row.get(0),
        )?;
        Ok(Reader {
            db,
            version: None,
            last,
        })
    }

    /// The toasts that came since the last read, oldest first.
    fn new_toasts(&mut self) -> rusqlite::Result<Vec<Row>> {
        let version: i64 = self
            .db
            .query_row("pragma data_version", [], |row| row.get(0))?;
        if self.version == Some(version) {
            return Ok(Vec::new());
        }
        let mut statement = self.db.prepare_cached(
            "select n.Id, n.ArrivalTime, n.Payload, h.PrimaryId \
             from Notification n join NotificationHandler h on h.RecordId = n.HandlerId \
             where n.Type = 'toast' and n.ArrivalTime > ?1 \
             order by n.ArrivalTime limit ?2",
        )?;
        let rows = statement
            .query_map([self.last, BATCH as i64], |row| {
                let payload = match row.get_ref(2)? {
                    ValueRef::Blob(bytes) | ValueRef::Text(bytes) => bytes.to_vec(),
                    _ => Vec::new(),
                };
                Ok(Row {
                    id: row.get(0)?,
                    arrival: row.get(1)?,
                    payload,
                    aumid: row.get(3)?,
                })
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        // A full batch leaves more to read next time.
        self.version = (rows.len() < BATCH).then_some(version);
        if let Some(row) = rows.last() {
            self.last = row.arrival;
        }
        Ok(rows)
    }
}

/// Keeps a toast that showed, for a click, and lets the oldest go.
fn keep(toast: Kept) {
    let mut kept = KEPT_TOASTS.lock().unwrap_or_else(|e| e.into_inner());
    // The same id again is the toast updated.
    if let Some(at) = kept.iter().position(|k| k.id == toast.id) {
        if let Some(old) = kept.remove(at) {
            forget(old);
        }
    }
    kept.push_back(toast);
    while kept.len() > KEPT {
        if let Some(old) = kept.pop_front() {
            forget(old);
        }
    }
}

fn forget(toast: Kept) {
    if let Some(picture) = toast.picture {
        let _ = std::fs::remove_file(picture);
    }
}

/// A copy of a toast's picture in the cache, where the page may load it.
fn copy_picture(path: &Path, pictures: &Path, row: &Row) -> Option<PathBuf> {
    let size = std::fs::metadata(path).ok()?.len();
    if size > MAX_PICTURE_BYTES {
        return None;
    }
    let ext = path.extension()?.to_string_lossy().to_ascii_lowercase();
    // Named by its arrival too: an updated toast's new picture is a new URL.
    let copy = pictures.join(format!("{}-{}.{ext}", row.id, row.arrival));
    std::fs::copy(path, &copy)
        .map_err(|err| tracing::debug!("no picture for a notification: {err}"))
        .ok()?;
    Some(copy)
}

/// The app's name and its icon in `icons`, as Windows' Apps folder shows
/// them; its id's own name and no icon if the folder has no such app.
fn app_of(aumid: &str, icons: &Path) -> (String, Option<String>) {
    let wide = HSTRING::from(aumid);
    // SAFETY: `wide` is a NUL-ended string that outlives the call.
    let item: Option<IShellItem> = unsafe {
        SHCreateItemInKnownFolder(&FOLDERID_AppsFolder, KF_FLAG_DEFAULT, PCWSTR(wide.as_ptr()))
    }
    .ok();
    let Some(item) = item else {
        return (toast::app_name(aumid), None);
    };
    let name = display_name(&item).unwrap_or_else(|| toast::app_name(aumid));
    let icon = icon_png(&item).and_then(|png| {
        // One file per app, for this run.
        use std::hash::{Hash, Hasher};
        let mut hasher = std::collections::hash_map::DefaultHasher::new();
        aumid.hash(&mut hasher);
        let path = icons.join(format!("{:016x}.png", hasher.finish()));
        std::fs::write(&path, png).ok()?;
        Some(path.display().to_string())
    });
    (name, icon)
}

fn display_name(item: &IShellItem) -> Option<String> {
    // SAFETY: the name is Windows' and freed once copied.
    unsafe {
        let name = item.GetDisplayName(SIGDN_NORMALDISPLAY).ok()?;
        let copied = name.to_string().ok();
        CoTaskMemFree(Some(name.0.cast_const().cast()));
        copied.filter(|name| !name.is_empty())
    }
}

/// The app's icon, as the Start menu draws it, as a PNG.
fn icon_png(item: &IShellItem) -> Option<Vec<u8>> {
    let factory: IShellItemImageFactory = item.cast().ok()?;
    let size = SIZE {
        cx: ICON_PX,
        cy: ICON_PX,
    };
    // SAFETY: the bitmap is ours, read and then deleted.
    unsafe {
        let bitmap = factory.GetImage(size, SIIGBF_ICONONLY).ok()?;
        let png = bitmap_png(bitmap);
        let _ = DeleteObject(HGDIOBJ(bitmap.0));
        png
    }
}

/// A bitmap's pixels, top row first, as a PNG.
///
/// # Safety
/// `bitmap` must be a live bitmap.
unsafe fn bitmap_png(bitmap: HBITMAP) -> Option<Vec<u8>> {
    let mut info = BITMAP::default();
    let read = unsafe {
        GetObjectW(
            HGDIOBJ(bitmap.0),
            size_of::<BITMAP>() as i32,
            Some((&raw mut info).cast()),
        )
    };
    if read == 0 || info.bmWidth <= 0 || info.bmHeight == 0 {
        return None;
    }
    let (width, height) = (info.bmWidth, info.bmHeight.abs());
    let mut header = BITMAPINFO {
        bmiHeader: BITMAPINFOHEADER {
            biSize: size_of::<BITMAPINFOHEADER>() as u32,
            biWidth: width,
            // Negative: the top row first.
            biHeight: -height,
            biPlanes: 1,
            biBitCount: 32,
            biCompression: BI_RGB.0,
            ..Default::default()
        },
        ..Default::default()
    };
    let mut pixels = vec![0u8; width as usize * height as usize * 4];
    let lines = unsafe {
        let dc = GetDC(None);
        let lines = GetDIBits(
            dc,
            bitmap,
            0,
            height as u32,
            Some(pixels.as_mut_ptr().cast()),
            &mut header,
            DIB_RGB_COLORS,
        );
        ReleaseDC(None, dc);
        lines
    };
    if lines != height {
        return None;
    }
    toast::icon_png(width as u32, height as u32, &pixels)
}

/// Whether Windows holds its banners back now: the user is away or
/// presenting, or Do not disturb is on.
fn quiet() -> bool {
    // SAFETY: plain queries.
    let state = unsafe { SHQueryUserNotificationState() }.map_or(5, |s| s.0);
    toast::holds_back(state, focus_profile())
}

/// Do not disturb's profile, 0 when off. Windows has no public call for it;
/// this is the state its quick settings follow (WNF
/// `SHEL_QUIETHOURS_ACTIVE_PROFILE_CHANGED`). 0 when it cannot be read.
fn focus_profile() -> u32 {
    #[link(name = "ntdll")]
    extern "system" {
        fn NtQueryWnfStateData(
            state_name: *const u64,
            type_id: *const core::ffi::c_void,
            explicit_scope: *const core::ffi::c_void,
            change_stamp: *mut u32,
            buffer: *mut core::ffi::c_void,
            buffer_size: *mut u32,
        ) -> i32;
    }
    const QUIET_HOURS_PROFILE: u64 = 0x0D83_063E_A3BF_1C75;
    let mut profile = 0u32;
    let mut stamp = 0u32;
    let mut size = size_of::<u32>() as u32;
    // SAFETY: the buffers are ours and as large as said.
    let status = unsafe {
        NtQueryWnfStateData(
            &QUIET_HOURS_PROFILE,
            std::ptr::null(),
            std::ptr::null(),
            &mut stamp,
            (&raw mut profile).cast(),
            &mut size,
        )
    };
    if status < 0 || size != size_of::<u32>() as u32 {
        return 0;
    }
    profile
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_millis() as i64)
}
