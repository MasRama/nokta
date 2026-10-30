//! Memory pressure from the kernel's PSI trigger on `/proc/pressure/memory`:
//! a thread blocks in `poll()` and says each time some task stalled on
//! memory for 150 ms within 2 s. No polling of the file.

use std::fs::OpenOptions;
use std::io::Write;
use std::os::fd::AsRawFd;
use std::os::unix::fs::OpenOptionsExt;

use tokio::sync::mpsc;

/// Some task stalled 150 ms in a 2 s window; unprivileged triggers need a
/// window that is a multiple of 2 s.
const TRIGGER: &[u8] = b"some 150000 2000000\0";

/// Each event of the trigger. Where the kernel refuses it (no PSI, or an old
/// kernel that wants root), this is logged once and the receiver ends.
pub fn spawn() -> mpsc::UnboundedReceiver<()> {
    let (tx, rx) = mpsc::unbounded_channel();
    let file = OpenOptions::new()
        .read(true)
        .write(true)
        .custom_flags(libc::O_NONBLOCK)
        .open("/proc/pressure/memory")
        .and_then(|mut file| file.write_all(TRIGGER).map(|()| file));
    let file = match file {
        Ok(file) => file,
        Err(err) => {
            tracing::info!("no memory alert, the kernel has no memory pressure trigger: {err}");
            return rx;
        }
    };
    let spawned = std::thread::Builder::new()
        .name("nokta-pressure".into())
        .spawn(move || {
            let mut fds = libc::pollfd {
                fd: file.as_raw_fd(),
                events: libc::POLLPRI,
                revents: 0,
            };
            loop {
                // SAFETY: one valid pollfd that lives through the call.
                let n = unsafe { libc::poll(&mut fds, 1, -1) };
                if n < 0 {
                    if std::io::Error::last_os_error().kind() == std::io::ErrorKind::Interrupted {
                        continue;
                    }
                    break;
                }
                if fds.revents & libc::POLLERR != 0 {
                    break;
                }
                if fds.revents & libc::POLLPRI != 0 && tx.send(()).is_err() {
                    break;
                }
            }
            tracing::info!("the memory pressure trigger stopped");
        });
    if let Err(err) = spawned {
        tracing::warn!("no memory alert: {err}");
    }
    rx
}
