//! The laptop battery from Windows: charger, low, critical and full alerts.
//! Windows calls back when the power source or the percentage changes; the
//! status is then read again and run through `BatteryRules`.

use std::ffi::c_void;

use tokio::sync::mpsc;
use windows::core::{Error, HRESULT};
use windows::Win32::Foundation::{ERROR_SUCCESS, HANDLE};
use windows::Win32::System::Power::{
    GetSystemPowerStatus, PowerSettingRegisterNotification, DEVICE_NOTIFY_SUBSCRIBE_PARAMETERS,
    SYSTEM_POWER_STATUS,
};
use windows::Win32::System::SystemServices::{
    GUID_ACDC_POWER_SOURCE, GUID_BATTERY_PERCENTAGE_REMAINING,
};
use windows::Win32::UI::WindowsAndMessaging::DEVICE_NOTIFY_CALLBACK;

use super::rules::{windows_battery, Alert, BatteryRules, BatterySample};

/// Follows the battery until the alerts' receiver goes away.
pub async fn run(alerts: mpsc::Sender<Alert>) {
    let (nudge, mut nudges) = mpsc::unbounded_channel();
    if let Err(err) = subscribe(nudge) {
        tracing::warn!("no battery alerts: {err}");
        return;
    }
    let mut rules = BatteryRules::default();
    if let Some(sample) = read() {
        rules.update(sample);
    }
    while nudges.recv().await.is_some() {
        // A burst of callbacks reads the status once.
        while nudges.try_recv().is_ok() {}
        let Some(sample) = read() else { continue };
        for alert in rules.update(sample) {
            if alerts.send(alert).await.is_err() {
                return;
            }
        }
    }
}

fn read() -> Option<BatterySample> {
    let mut status = SYSTEM_POWER_STATUS::default();
    // SAFETY: `status` is a valid place for Windows to write the status to.
    unsafe { GetSystemPowerStatus(&mut status) }.ok()?;
    Some(windows_battery(
        status.ACLineStatus,
        status.BatteryFlag,
        status.BatteryLifePercent,
    ))
}

/// Asks Windows to call `on_power` for the power source and the percentage,
/// with `nudge` to pass it on. Both stay registered while the app runs.
fn subscribe(nudge: mpsc::UnboundedSender<()>) -> windows::core::Result<()> {
    let context: &'static mpsc::UnboundedSender<()> = Box::leak(Box::new(nudge));
    let params: &'static DEVICE_NOTIFY_SUBSCRIBE_PARAMETERS =
        Box::leak(Box::new(DEVICE_NOTIFY_SUBSCRIBE_PARAMETERS {
            Callback: Some(on_power),
            Context: std::ptr::from_ref(context).cast_mut().cast(),
        }));
    for setting in [GUID_ACDC_POWER_SOURCE, GUID_BATTERY_PERCENTAGE_REMAINING] {
        let mut handle = std::ptr::null_mut();
        // SAFETY: `params` and the sender it points to live as long as the
        // app, which is as long as Windows may call back with them.
        let result = unsafe {
            PowerSettingRegisterNotification(
                &setting,
                DEVICE_NOTIFY_CALLBACK,
                HANDLE(std::ptr::from_ref(params).cast_mut().cast()),
                &mut handle,
            )
        };
        if result != ERROR_SUCCESS {
            return Err(Error::from_hresult(HRESULT::from_win32(result.0)));
        }
    }
    Ok(())
}

/// Windows' callback: tells `run` to read the status again.
unsafe extern "system" fn on_power(
    context: *const c_void,
    _kind: u32,
    _setting: *const c_void,
) -> u32 {
    // SAFETY: `context` is the sender `subscribe` leaked for this.
    let nudge = unsafe { &*context.cast::<mpsc::UnboundedSender<()>>() };
    let _ = nudge.send(());
    ERROR_SUCCESS.0
}
