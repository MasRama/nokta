//! The camera and the microphone in use, from Windows' consent store (what
//! its privacy settings show as "currently in use"), and the default
//! microphone's mute. One thread waits on Windows' events: a change under
//! either device's key, the microphone's mute, a new default microphone;
//! and reads it all again on each.

use std::ffi::c_void;

use tokio::sync::watch;
use windows::core::{implement, w, Error, Result, HSTRING, PCWSTR, PWSTR};
use windows::Win32::Foundation::{HANDLE, PROPERTYKEY, WAIT_OBJECT_0};
use windows::Win32::Media::Audio::Endpoints::{
    IAudioEndpointVolume, IAudioEndpointVolumeCallback, IAudioEndpointVolumeCallback_Impl,
};
use windows::Win32::Media::Audio::{
    eCapture, eConsole, EDataFlow, ERole, IMMDeviceEnumerator, IMMNotificationClient,
    IMMNotificationClient_Impl, MMDeviceEnumerator, AUDIO_VOLUME_NOTIFICATION_DATA, DEVICE_STATE,
};
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CLSCTX_ALL, COINIT_MULTITHREADED,
};
use windows::Win32::System::Registry::{
    RegCloseKey, RegEnumKeyExW, RegGetValueW, RegNotifyChangeKeyValue, RegOpenKeyExW, HKEY,
    HKEY_CURRENT_USER, KEY_NOTIFY, KEY_READ, REG_NOTIFY_CHANGE_LAST_SET, REG_NOTIFY_CHANGE_NAME,
    REG_NOTIFY_FILTER, REG_SAM_FLAGS, RRF_RT_REG_QWORD,
};
use windows::Win32::System::Threading::{CreateEventW, SetEvent, WaitForMultipleObjects, INFINITE};

use crate::privacy::{in_use, Entry, PrivacyState};

const STORE: &str =
    r"Software\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore";

/// The events the thread waits on, by their place.
const MICROPHONE: usize = 0;
const CAMERA: usize = 1;
const MUTE: usize = 2;
const DEFAULT_MICROPHONE: usize = 3;

/// Starts following the camera and the microphone.
pub fn spawn() -> watch::Receiver<PrivacyState> {
    let (tx, rx) = watch::channel(PrivacyState::default());
    let spawned = std::thread::Builder::new()
        .name("nokta-privacy".into())
        .spawn(move || {
            if let Err(err) = run(&tx) {
                tracing::warn!("no privacy dots: {err}");
            }
        });
    if let Err(err) = spawned {
        tracing::warn!("cannot follow the camera and the microphone: {err}");
    }
    rx
}

/// Mutes the default microphone, or unmutes it, on a thread of its own.
pub fn toggle_mute() {
    std::thread::spawn(|| {
        // SAFETY: plain COM calls on this new thread.
        let toggled = unsafe {
            CoInitializeEx(None, COINIT_MULTITHREADED)
                .ok()
                .and_then(|()| default_microphone(&enumerator()?))
                .and_then(|mic| mic.SetMute(!mic.GetMute()?.as_bool(), std::ptr::null()))
        };
        if let Err(err) = toggled {
            tracing::warn!("cannot mute the microphone: {err}");
        }
    });
}

fn run(tx: &watch::Sender<PrivacyState>) -> Result<()> {
    // SAFETY: called once, first thing on this thread.
    unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) }.ok()?;
    let own_exe = std::env::current_exe()
        .ok()
        .and_then(|p| p.file_name().map(|n| n.to_string_lossy().into_owned()))
        .unwrap_or_default();
    let devices = [
        Key::open(HKEY_CURRENT_USER, &format!(r"{STORE}\microphone"))?,
        Key::open(HKEY_CURRENT_USER, &format!(r"{STORE}\webcam"))?,
    ];
    let events = [event()?, event()?, event()?, event()?];
    devices[MICROPHONE].notify(events[MICROPHONE])?;
    devices[CAMERA].notify(events[CAMERA])?;
    // The callbacks stay registered while this thread runs, which is for good.
    let enumerator = enumerator()?;
    let client: IMMNotificationClient = DefaultMicrophone {
        changed: events[DEFAULT_MICROPHONE].0 as isize,
    }
    .into();
    // SAFETY: a plain COM call on a live interface.
    unsafe { enumerator.RegisterEndpointNotificationCallback(&client) }?;
    let callback: IAudioEndpointVolumeCallback = MuteChanged {
        changed: events[MUTE].0 as isize,
    }
    .into();
    let mut microphone = watch_mute(&enumerator, &callback);
    loop {
        // SAFETY: a plain COM call on a live interface.
        let muted = microphone
            .as_ref()
            .is_some_and(|mic| unsafe { mic.GetMute() }.is_ok_and(|m| m.as_bool()));
        let state = PrivacyState {
            camera: in_use(&devices[CAMERA].entries(), &own_exe),
            microphone: in_use(&devices[MICROPHONE].entries(), &own_exe),
            muted,
        };
        tx.send_if_modified(|shown| {
            let changed = *shown != state;
            *shown = state;
            changed
        });
        // SAFETY: the events are this thread's and open.
        let woke = unsafe { WaitForMultipleObjects(&events, false, INFINITE) };
        match woke.0.wrapping_sub(WAIT_OBJECT_0.0) as usize {
            // Windows signals a key once: it is asked again for the next change.
            device @ (MICROPHONE | CAMERA) => devices[device].notify(events[device])?,
            MUTE => {}
            DEFAULT_MICROPHONE => {
                if let Some(old) = microphone.take() {
                    // SAFETY: a plain COM call on a live interface.
                    let _ = unsafe { old.UnregisterControlChangeNotify(&callback) };
                }
                microphone = watch_mute(&enumerator, &callback);
            }
            _ => return Err(Error::from_thread()),
        }
    }
}

fn enumerator() -> Result<IMMDeviceEnumerator> {
    // SAFETY: a plain COM call.
    unsafe { CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL) }
}

fn default_microphone(enumerator: &IMMDeviceEnumerator) -> Result<IAudioEndpointVolume> {
    // SAFETY: plain COM calls on live interfaces.
    unsafe {
        enumerator
            .GetDefaultAudioEndpoint(eCapture, eConsole)?
            .Activate(CLSCTX_ALL, None)
    }
}

/// The default microphone with `callback` on its mute; none while there is
/// no microphone.
fn watch_mute(
    enumerator: &IMMDeviceEnumerator,
    callback: &IAudioEndpointVolumeCallback,
) -> Option<IAudioEndpointVolume> {
    let mic = default_microphone(enumerator)
        .inspect_err(|err| tracing::debug!("no default microphone: {err}"))
        .ok()?;
    // SAFETY: a plain COM call on a live interface.
    if let Err(err) = unsafe { mic.RegisterControlChangeNotify(callback) } {
        tracing::debug!("cannot follow the microphone's mute: {err}");
    }
    Some(mic)
}

/// An auto-reset event, unset.
fn event() -> Result<HANDLE> {
    // SAFETY: makes a new, unnamed event.
    unsafe { CreateEventW(None, false, false, PCWSTR::null()) }
}

/// Sets an event `event()` made, from Windows' callback thread.
fn signal(event: isize) -> Result<()> {
    // SAFETY: the event lives as long as the thread that waits on it.
    unsafe { SetEvent(HANDLE(event as *mut c_void)) }
}

/// An open registry key, closed when dropped.
struct Key(HKEY);

impl Key {
    fn open(parent: HKEY, path: &str) -> Result<Key> {
        let path = HSTRING::from(path);
        let mut key = HKEY(std::ptr::null_mut());
        let access = REG_SAM_FLAGS(KEY_READ.0 | KEY_NOTIFY.0);
        // SAFETY: `path` is a NUL-ended string that outlives the call, and
        // `key` takes the handle.
        unsafe { RegOpenKeyExW(parent, PCWSTR(path.as_ptr()), Some(0), access, &mut key) }.ok()?;
        Ok(Key(key))
    }

    /// Asks Windows to set `event` once on a change under this key.
    fn notify(&self, event: HANDLE) -> Result<()> {
        let filter = REG_NOTIFY_FILTER(REG_NOTIFY_CHANGE_NAME.0 | REG_NOTIFY_CHANGE_LAST_SET.0);
        // SAFETY: the key and the event are open.
        unsafe { RegNotifyChangeKeyValue(self.0, true, filter, Some(event), true) }.ok()
    }

    /// Every app's entry: the packages' right here, the desktop apps' under
    /// `NonPackaged`.
    fn entries(&self) -> Vec<Entry> {
        let mut entries = Vec::new();
        for name in self.subkeys() {
            if name.eq_ignore_ascii_case("NonPackaged") {
                if let Ok(desktop) = Key::open(self.0, &name) {
                    for path in desktop.subkeys() {
                        entries.push(desktop.entry(path, false));
                    }
                }
            } else {
                entries.push(self.entry(name, true));
            }
        }
        entries
    }

    fn entry(&self, key: String, packaged: bool) -> Entry {
        Entry {
            started: self.qword(&key, w!("LastUsedTimeStart")),
            stopped: self.qword(&key, w!("LastUsedTimeStop")),
            key,
            packaged,
        }
    }

    fn subkeys(&self) -> Vec<String> {
        let mut names = Vec::new();
        let mut name = [0u16; 512];
        for index in 0.. {
            let mut len = name.len() as u32;
            // SAFETY: `name` holds `len` characters.
            let found = unsafe {
                RegEnumKeyExW(
                    self.0,
                    index,
                    Some(PWSTR(name.as_mut_ptr())),
                    &mut len,
                    None,
                    None,
                    None,
                    None,
                )
            };
            if found.is_err() {
                break;
            }
            names.push(String::from_utf16_lossy(&name[..len as usize]));
        }
        names
    }

    /// A QWORD value of a subkey; 0 when there is none.
    fn qword(&self, subkey: &str, value: PCWSTR) -> u64 {
        let subkey = HSTRING::from(subkey);
        let mut data = 0u64;
        let mut size = std::mem::size_of::<u64>() as u32;
        // SAFETY: `data` has room for the `size` bytes asked for.
        let read = unsafe {
            RegGetValueW(
                self.0,
                PCWSTR(subkey.as_ptr()),
                value,
                RRF_RT_REG_QWORD,
                None,
                Some(std::ptr::from_mut(&mut data).cast::<c_void>()),
                Some(&mut size),
            )
        };
        if read.is_ok() {
            data
        } else {
            0
        }
    }
}

impl Drop for Key {
    fn drop(&mut self) {
        // SAFETY: the key is open and closed only here.
        let _ = unsafe { RegCloseKey(self.0) };
    }
}

/// Wakes the thread when the microphone's mute or level changes.
#[implement(IAudioEndpointVolumeCallback)]
struct MuteChanged {
    changed: isize,
}

impl IAudioEndpointVolumeCallback_Impl for MuteChanged_Impl {
    fn OnNotify(&self, _: *mut AUDIO_VOLUME_NOTIFICATION_DATA) -> Result<()> {
        signal(self.changed)
    }
}

/// Wakes the thread when another microphone becomes the default.
#[implement(IMMNotificationClient)]
struct DefaultMicrophone {
    changed: isize,
}

impl IMMNotificationClient_Impl for DefaultMicrophone_Impl {
    fn OnDeviceStateChanged(&self, _: &PCWSTR, _: DEVICE_STATE) -> Result<()> {
        Ok(())
    }

    fn OnDeviceAdded(&self, _: &PCWSTR) -> Result<()> {
        Ok(())
    }

    fn OnDeviceRemoved(&self, _: &PCWSTR) -> Result<()> {
        Ok(())
    }

    fn OnDefaultDeviceChanged(&self, flow: EDataFlow, role: ERole, _: &PCWSTR) -> Result<()> {
        if flow == eCapture && role == eConsole {
            signal(self.changed)?;
        }
        Ok(())
    }

    fn OnPropertyValueChanged(&self, _: &PCWSTR, _: &PROPERTYKEY) -> Result<()> {
        Ok(())
    }
}
