//! Windows' own folders, where the user may have moved them: Downloads
//! and Screenshots (Pictures\Screenshots by default).

use std::path::PathBuf;

use windows::core::GUID;
use windows::Win32::System::Com::CoTaskMemFree;
use windows::Win32::UI::Shell::{
    FOLDERID_Downloads, FOLDERID_Screenshots, SHGetKnownFolderPath, KF_FLAG_DEFAULT,
};

/// The Downloads folder; None if Windows does not say.
pub fn downloads() -> Option<PathBuf> {
    known(&FOLDERID_Downloads)
}

/// The folder Windows saves screenshots to; None if Windows does not say.
pub fn screenshots() -> Option<PathBuf> {
    known(&FOLDERID_Screenshots)
}

fn known(id: &GUID) -> Option<PathBuf> {
    // SAFETY: the path is Windows' and freed once copied.
    unsafe {
        let path = match SHGetKnownFolderPath(id, KF_FLAG_DEFAULT, None) {
            Ok(path) => path,
            Err(err) => {
                tracing::debug!("no known folder {id:?}: {err}");
                return None;
            }
        };
        let copied = path.to_string().ok().map(PathBuf::from);
        CoTaskMemFree(Some(path.0.cast_const().cast()));
        copied
    }
}
