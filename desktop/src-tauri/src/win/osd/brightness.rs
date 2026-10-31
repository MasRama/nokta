//! The built-in display's brightness, from WMI's brightness events. Only
//! built-in panels report it: elsewhere this finds none and stops.

use tokio::sync::mpsc;
use windows::core::{w, Error, Result, BSTR, PCWSTR};
use windows::Win32::Foundation::E_FAIL;
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CoSetProxyBlanket, CLSCTX_INPROC_SERVER,
    COINIT_MULTITHREADED, EOAC_NONE, RPC_C_AUTHN_LEVEL_CALL, RPC_C_IMP_LEVEL_IMPERSONATE,
};
use windows::Win32::System::Rpc::{RPC_C_AUTHN_WINNT, RPC_C_AUTHZ_NONE};
use windows::Win32::System::Variant::{VariantClear, VariantToUInt32, VARIANT};
use windows::Win32::System::Wmi::{
    IEnumWbemClassObject, IWbemLocator, IWbemServices, WbemLocator, WBEM_FLAG_FORWARD_ONLY,
    WBEM_FLAG_RETURN_IMMEDIATELY, WBEM_GENERIC_FLAG_TYPE, WBEM_INFINITE,
};

use crate::osd::{Brightness, Osd};

/// Follows the brightness for good, or until WMI fails.
pub fn run(osd: mpsc::Sender<Osd>) -> Result<()> {
    // SAFETY: called once, first thing on this thread.
    unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) }.ok()?;
    let wmi = connect()?;
    let mut brightness = Brightness::default();
    let now = query(
        &wmi,
        "SELECT CurrentBrightness FROM WmiMonitorBrightness",
        false,
    )?;
    match next(&now, w!("CurrentBrightness"))? {
        Some(level) => brightness.set(level),
        None => return Err(Error::new(E_FAIL, "no built-in display")),
    }
    let events = query(
        &wmi,
        "SELECT Brightness FROM WmiMonitorBrightnessEvent",
        true,
    )?;
    while let Some(level) = next(&events, w!("Brightness"))? {
        if let Some(shown) = brightness.update(level) {
            let _ = osd.try_send(shown);
        }
    }
    Ok(())
}

/// WMI's `ROOT\WMI` namespace, where the display classes are.
fn connect() -> Result<IWbemServices> {
    let none = BSTR::new();
    // SAFETY: plain COM calls on live interfaces.
    unsafe {
        let locator: IWbemLocator = CoCreateInstance(&WbemLocator, None, CLSCTX_INPROC_SERVER)?;
        let wmi = locator.ConnectServer(
            &BSTR::from("ROOT\\WMI"),
            &none,
            &none,
            &none,
            0,
            &none,
            None,
        )?;
        CoSetProxyBlanket(
            &wmi,
            RPC_C_AUTHN_WINNT,
            RPC_C_AUTHZ_NONE,
            PCWSTR::null(),
            RPC_C_AUTHN_LEVEL_CALL,
            RPC_C_IMP_LEVEL_IMPERSONATE,
            None,
            EOAC_NONE,
        )?;
        Ok(wmi)
    }
}

/// Runs a WQL query, or with `events` waits for the events it names.
fn query(wmi: &IWbemServices, wql: &str, events: bool) -> Result<IEnumWbemClassObject> {
    let flags = WBEM_GENERIC_FLAG_TYPE(WBEM_FLAG_FORWARD_ONLY.0 | WBEM_FLAG_RETURN_IMMEDIATELY.0);
    let (language, wql) = (BSTR::from("WQL"), BSTR::from(wql));
    // SAFETY: plain COM calls on a live interface.
    unsafe {
        if events {
            wmi.ExecNotificationQuery(&language, &wql, flags, None)
        } else {
            wmi.ExecQuery(&language, &wql, flags, None)
        }
    }
}

/// Waits for the next object and reads its `property` as a percentage;
/// `None` once there are no more.
fn next(objects: &IEnumWbemClassObject, property: PCWSTR) -> Result<Option<u8>> {
    let mut found = [None];
    let mut returned = 0;
    // SAFETY: room for one object, and for its count.
    unsafe { objects.Next(WBEM_INFINITE, &mut found, &mut returned) }.ok()?;
    let Some(object) = found[0].take().filter(|_| returned == 1) else {
        return Ok(None);
    };
    let mut value = VARIANT::default();
    // SAFETY: `value` takes the property and is cleared after it is read.
    let level = unsafe {
        object.Get(property, 0, &mut value, None, None)?;
        let level = VariantToUInt32(&value);
        let _ = VariantClear(&mut value);
        level?
    };
    Ok(Some(level.min(100) as u8))
}
