//! The shelf on Windows: files dropped on a notch go on it, and its files
//! are dragged out to Explorer or an app as Explorer drags them. They are
//! copied there and stay on the shelf, as on GNOME.
//!
//! A drop reaches a notch only over the notch itself: elsewhere the window
//! lets the pointer through (pointer.rs), so Windows offers the drop to the
//! window below.

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};

use tauri::{DragDropEvent, Emitter, Manager, State, WebviewWindow, Window};
use tokio::sync::oneshot;
use windows::core::HSTRING;
use windows::Win32::Foundation::HWND;
use windows::Win32::System::Com::{IBindCtx, IDataObject};
use windows::Win32::System::Ole::{IDropSource, DROPEFFECT_COPY};
use windows::Win32::UI::Shell::Common::ITEMIDLIST;
use windows::Win32::UI::Shell::{
    BHID_DataObject, ILFree, SHCreateShellItemArrayFromIDLists, SHDoDragDrop, SHParseDisplayName,
};

use super::services::Core;

/// The event that tells a notch files are dragged over it (true) or no
/// longer (false).
pub const DROP_EVENT: &str = "nokta://drop";

/// Set while the shelf's own files are dragged out, so they do not land on
/// it again.
static DRAGGING: AtomicBool = AtomicBool::new(false);

/// Follows files dragged over `window`'s notch and keeps those dropped.
pub fn dragged_over(window: &Window, event: &DragDropEvent) {
    if DRAGGING.load(Ordering::Relaxed) {
        return;
    }
    let dropping = |on: bool| {
        let _ = window.emit_to(window.label(), DROP_EVENT, on);
    };
    match event {
        DragDropEvent::Enter { paths, .. } => dropping(!paths.is_empty()),
        DragDropEvent::Drop { paths, .. } => {
            dropping(false);
            if let Some(core) = window.try_state::<Core>() {
                core.keep(crate::files::uris(paths));
            }
        }
        DragDropEvent::Leave => dropping(false),
        _ => {}
    }
}

/// Drags `uris`, files on the shelf, out of the notch that asks; answers
/// when they are dropped or the drag is given up.
#[tauri::command]
pub async fn shelf_drag(
    window: WebviewWindow,
    core: State<'_, Core>,
    uris: Vec<String>,
) -> Result<(), String> {
    let paths = uris
        .iter()
        .map(|uri| {
            core.file_path(uri)
                .ok_or_else(|| format!("Nokta does not drag {uri}"))
        })
        .collect::<Result<Vec<_>, _>>()?;
    if paths.is_empty() {
        return Ok(());
    }
    let (done, finished) = oneshot::channel();
    let source = window.clone();
    // OLE drags run on the window's own thread.
    window
        .run_on_main_thread(move || {
            let dragged = source
                .hwnd()
                .map_err(|err| err.to_string())
                .and_then(|hwnd| drag(hwnd, &paths));
            let _ = done.send(dragged);
        })
        .map_err(|err| err.to_string())?;
    finished
        .await
        .map_err(|_| "the drag did not start".to_owned())?
}

/// Runs Windows' drag of `paths` from `hwnd` until it ends.
fn drag(hwnd: HWND, paths: &[PathBuf]) -> Result<(), String> {
    let mut pidls: Vec<*mut ITEMIDLIST> = Vec::with_capacity(paths.len());
    let dragged = drag_items(hwnd, paths, &mut pidls);
    for pidl in pidls {
        // SAFETY: each came from SHParseDisplayName and is not used again.
        unsafe { ILFree(Some(pidl.cast_const())) };
    }
    dragged.map_err(|err| format!("cannot drag the files: {err}"))
}

/// Finds `paths` in the shell, into `pidls` for the caller to free, and
/// drags them.
fn drag_items(
    hwnd: HWND,
    paths: &[PathBuf],
    pidls: &mut Vec<*mut ITEMIDLIST>,
) -> windows::core::Result<()> {
    for path in paths {
        let name = HSTRING::from(path.as_path());
        let mut pidl = std::ptr::null_mut();
        // SAFETY: `name` outlives the call; the caller frees the item list.
        unsafe { SHParseDisplayName(&name, None::<&IBindCtx>, &mut pidl, 0, None) }?;
        pidls.push(pidl);
    }
    let list: Vec<*const ITEMIDLIST> = pidls.iter().map(|pidl| pidl.cast_const()).collect();
    // SAFETY: each item list came from SHParseDisplayName and is alive.
    let items = unsafe { SHCreateShellItemArrayFromIDLists(&list) }?;
    // SAFETY: asks the items for the data Explorer drags.
    let data: IDataObject = unsafe { items.BindToHandler(None::<&IBindCtx>, &BHID_DataObject) }?;
    DRAGGING.store(true, Ordering::Relaxed);
    // SAFETY: on the window's thread, with Windows' own drop source.
    let ended = unsafe { SHDoDragDrop(Some(hwnd), &data, None::<&IDropSource>, DROPEFFECT_COPY) };
    DRAGGING.store(false, Ordering::Relaxed);
    ended.map(drop)
}
