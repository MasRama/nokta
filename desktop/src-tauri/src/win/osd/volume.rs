//! The volume of Windows' default output, shown when a volume key changed
//! it. This thread keeps the output's volume callback, and moves it to the
//! new default output when that changes.

use std::sync::mpsc as std_mpsc;

use tokio::sync::mpsc;
use windows::core::{implement, Result, PCWSTR};
use windows::Win32::Foundation::PROPERTYKEY;
use windows::Win32::Media::Audio::Endpoints::{
    IAudioEndpointVolume, IAudioEndpointVolumeCallback, IAudioEndpointVolumeCallback_Impl,
};
use windows::Win32::Media::Audio::{
    eMultimedia, eRender, EDataFlow, ERole, IMMDeviceEnumerator, IMMNotificationClient,
    IMMNotificationClient_Impl, MMDeviceEnumerator, AUDIO_VOLUME_NOTIFICATION_DATA, DEVICE_STATE,
};
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CLSCTX_ALL, COINIT_MULTITHREADED,
};

use super::keys;
use crate::osd::{after_volume_key, volume, Osd};

/// Follows the default output's volume for good.
pub fn run(osd: mpsc::Sender<Osd>) -> Result<()> {
    // SAFETY: called once, first thing on this thread.
    unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) }.ok()?;
    // SAFETY: plain COM calls; the callbacks live on this thread's stack
    // for as long as they are registered, which is for good.
    unsafe {
        let devices: IMMDeviceEnumerator = CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)?;
        let (rebind, rebinds) = std_mpsc::channel();
        let client: IMMNotificationClient = DefaultOutput { rebind }.into();
        devices.RegisterEndpointNotificationCallback(&client)?;
        let callback: IAudioEndpointVolumeCallback = VolumeChanged { osd }.into();
        loop {
            let output = bind(&devices, &callback)
                .inspect_err(|err| tracing::debug!("no default output: {err}"))
                .ok();
            if rebinds.recv().is_err() {
                return Ok(());
            }
            // A burst of changes binds once.
            while rebinds.try_recv().is_ok() {}
            if let Some(output) = output {
                let _ = output.UnregisterControlChangeNotify(&callback);
            }
        }
    }
}

/// Puts `callback` on the default output's volume.
fn bind(
    devices: &IMMDeviceEnumerator,
    callback: &IAudioEndpointVolumeCallback,
) -> Result<IAudioEndpointVolume> {
    // SAFETY: plain COM calls on live interfaces.
    unsafe {
        let device = devices.GetDefaultAudioEndpoint(eRender, eMultimedia)?;
        let output: IAudioEndpointVolume = device.Activate(CLSCTX_ALL, None)?;
        output.RegisterControlChangeNotify(callback)?;
        Ok(output)
    }
}

/// Sends the volume when a key just changed it: apps and the mixer change
/// it too, and Windows shows its OSD only for the keys.
#[implement(IAudioEndpointVolumeCallback)]
struct VolumeChanged {
    osd: mpsc::Sender<Osd>,
}

impl IAudioEndpointVolumeCallback_Impl for VolumeChanged_Impl {
    fn OnNotify(&self, data: *mut AUDIO_VOLUME_NOTIFICATION_DATA) -> Result<()> {
        if !after_volume_key(keys::volume_key_at(), keys::now_ms()) {
            return Ok(());
        }
        // SAFETY: Windows passes the change's data for this call.
        if let Some(data) = unsafe { data.as_ref() } {
            let _ = self
                .osd
                .try_send(volume(data.fMasterVolume, data.bMuted.as_bool()));
        }
        Ok(())
    }
}

/// Asks for the volume callback to move when the default output changes.
#[implement(IMMNotificationClient)]
struct DefaultOutput {
    rebind: std_mpsc::Sender<()>,
}

impl IMMNotificationClient_Impl for DefaultOutput_Impl {
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
        // Windows calls this on its own thread, where binding must not
        // happen: the volume thread does it.
        if flow == eRender && role == eMultimedia {
            let _ = self.rebind.send(());
        }
        Ok(())
    }

    fn OnPropertyValueChanged(&self, _: &PCWSTR, _: &PROPERTYKEY) -> Result<()> {
        Ok(())
    }
}
