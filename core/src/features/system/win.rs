//! Reads the counters from Windows: the CPU's times, the physical memory,
//! the network adapters' bytes, and the process with the largest working
//! set. Windows gives the CPU's temperature only to administrators, so it
//! stays unknown. Memory pressure is Windows' low-memory notification.

use std::ffi::c_void;
use std::time::Duration;

use tokio::sync::mpsc;
use windows::core::{BOOL, PWSTR};
use windows::Win32::Foundation::{CloseHandle, FILETIME, HANDLE, WAIT_OBJECT_0};
use windows::Win32::NetworkManagement::IpHelper::{
    FreeMibTable, GetIfTable2, MIB_IF_TABLE2, MIB_IF_TYPE_LOOPBACK,
};
use windows::Win32::NetworkManagement::Ndis::IfOperStatusUp;
use windows::Win32::System::Memory::{
    CreateMemoryResourceNotification, LowMemoryResourceNotification,
    QueryMemoryResourceNotification,
};
use windows::Win32::System::ProcessStatus::{
    EnumProcesses, GetProcessMemoryInfo, PROCESS_MEMORY_COUNTERS,
};
use windows::Win32::System::SystemInformation::{GlobalMemoryStatusEx, MEMORYSTATUSEX};
use windows::Win32::System::Threading::{
    GetSystemTimes, OpenProcess, QueryFullProcessImageNameW, WaitForSingleObject, INFINITE,
    PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION,
};

use super::model::{app_name, largest_rss, windows_cpu_times, windows_net, CpuTimes, Interface};
use super::service::{MemoryLow, Reading, Source};

/// While memory stays low, how often to look whether it recovered.
const LOW_POLL: Duration = Duration::from_secs(30);
/// `MIB_IF_ROW2`'s `HardwareInterface` and `FilterInterface` bits.
const HARDWARE: u8 = 1;
const FILTER: u8 = 1 << 1;

#[derive(Default)]
pub struct Win;

impl Win {
    pub fn new() -> Win {
        Win
    }
}

impl Source for Win {
    fn read(&self) -> Reading {
        Reading {
            cpu: cpu(),
            memory: memory(),
            temperature: None,
            net: net(),
        }
    }

    fn memory_low(&self) -> MemoryLow {
        let (used, total) = memory().unwrap_or_default();
        MemoryLow {
            used,
            total,
            app: largest_rss(apps()).unwrap_or_default(),
        }
    }
}

fn ticks(time: FILETIME) -> u64 {
    (u64::from(time.dwHighDateTime) << 32) | u64::from(time.dwLowDateTime)
}

fn cpu() -> Option<CpuTimes> {
    let (mut idle, mut kernel, mut user) = (
        FILETIME::default(),
        FILETIME::default(),
        FILETIME::default(),
    );
    // SAFETY: each pointer is a FILETIME that outlives the call.
    unsafe {
        GetSystemTimes(
            Some(std::ptr::from_mut(&mut idle)),
            Some(std::ptr::from_mut(&mut kernel)),
            Some(std::ptr::from_mut(&mut user)),
        )
    }
    .ok()?;
    Some(windows_cpu_times(ticks(idle), ticks(kernel), ticks(user)))
}

/// Used and total bytes; used is what is not available.
fn memory() -> Option<(u64, u64)> {
    let mut status = MEMORYSTATUSEX {
        dwLength: std::mem::size_of::<MEMORYSTATUSEX>() as u32,
        ..Default::default()
    };
    // SAFETY: `status` is sized as `dwLength` says.
    unsafe { GlobalMemoryStatusEx(&mut status) }.ok()?;
    Some((
        status.ullTotalPhys.saturating_sub(status.ullAvailPhys),
        status.ullTotalPhys,
    ))
}

fn net() -> Option<(u64, u64)> {
    let mut table: *mut MIB_IF_TABLE2 = std::ptr::null_mut();
    // SAFETY: Windows allocates the table; it is freed below.
    unsafe { GetIfTable2(&mut table) }.ok().ok()?;
    if table.is_null() {
        return None;
    }
    // SAFETY: the table holds `NumEntries` rows from `Table` on.
    let rows = unsafe {
        let count = (*table).NumEntries as usize;
        std::slice::from_raw_parts((*table).Table.as_ptr(), count)
    };
    let interfaces: Vec<Interface> = rows
        .iter()
        .map(|row| {
            let flags = row.InterfaceAndOperStatusFlags._bitfield;
            Interface {
                hardware: flags & HARDWARE != 0,
                filter: flags & FILTER != 0,
                loopback: row.Type == MIB_IF_TYPE_LOOPBACK,
                up: row.OperStatus == IfOperStatusUp,
                received: row.InOctets,
                sent: row.OutOctets,
            }
        })
        .collect();
    // SAFETY: the table came from GetIfTable2 and is not used again.
    unsafe { FreeMibTable(table as *const c_void) };
    Some(windows_net(interfaces))
}

/// Each process this user may look at: its name and working set in bytes.
fn apps() -> Vec<(String, u64)> {
    let mut ids = vec![0u32; 4096];
    let mut needed = 0u32;
    let size = (ids.len() * std::mem::size_of::<u32>()) as u32;
    // SAFETY: `ids` holds `size` bytes.
    if unsafe { EnumProcesses(ids.as_mut_ptr(), size, &mut needed) }.is_err() {
        return Vec::new();
    }
    ids.truncate(needed as usize / std::mem::size_of::<u32>());
    ids.into_iter().filter_map(app).collect()
}

fn app(id: u32) -> Option<(String, u64)> {
    // SAFETY: opens the process for reading its name and memory only.
    let process = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, id) }.ok()?;
    let found = name_and_memory(process);
    // SAFETY: the handle is open and not used after.
    let _ = unsafe { CloseHandle(process) };
    found
}

fn name_and_memory(process: HANDLE) -> Option<(String, u64)> {
    let cb = std::mem::size_of::<PROCESS_MEMORY_COUNTERS>() as u32;
    let mut counters = PROCESS_MEMORY_COUNTERS {
        cb,
        ..Default::default()
    };
    // SAFETY: `counters` is sized as `cb` says.
    unsafe { GetProcessMemoryInfo(process, &mut counters, cb) }.ok()?;
    let mut path = [0u16; 1024];
    let mut len = path.len() as u32;
    // SAFETY: `path` holds `len` UTF-16 units.
    unsafe {
        QueryFullProcessImageNameW(
            process,
            PROCESS_NAME_WIN32,
            PWSTR(path.as_mut_ptr()),
            &mut len,
        )
    }
    .ok()?;
    let path = String::from_utf16_lossy(&path[..len as usize]);
    Some((app_name(&path), counters.WorkingSetSize as u64))
}

/// Says each time Windows reports physical memory running low; once more
/// only after it recovered.
pub fn pressure() -> mpsc::UnboundedReceiver<()> {
    let (tx, rx) = mpsc::unbounded_channel();
    let spawned = std::thread::Builder::new()
        .name("nokta-memory".into())
        .spawn(move || {
            // SAFETY: makes Windows' own low-memory event, open for the thread's life.
            let low =
                match unsafe { CreateMemoryResourceNotification(LowMemoryResourceNotification) } {
                    Ok(low) => low,
                    Err(err) => {
                        tracing::warn!("cannot follow low memory: {err}");
                        return;
                    }
                };
            loop {
                // SAFETY: the event is open.
                if unsafe { WaitForSingleObject(low, INFINITE) } != WAIT_OBJECT_0 {
                    break;
                }
                if tx.send(()).is_err() {
                    break;
                }
                // The event stays set while memory is low.
                while still_low(low) {
                    std::thread::sleep(LOW_POLL);
                }
            }
        });
    if let Err(err) = spawned {
        tracing::warn!("cannot follow low memory: {err}");
    }
    rx
}

fn still_low(low: HANDLE) -> bool {
    let mut state = BOOL::default();
    // SAFETY: the event is open and `state` takes its answer.
    unsafe { QueryMemoryResourceNotification(low, &mut state) }.is_ok() && state.as_bool()
}
