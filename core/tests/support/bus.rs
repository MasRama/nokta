use std::io::{BufRead, BufReader};
use std::process::{Child, Command, Stdio};

/// A private `dbus-daemon` session bus, killed on drop.
pub struct TestBus {
    child: Child,
    address: String,
    _dir: tempfile::TempDir,
}

impl TestBus {
    pub fn start() -> TestBus {
        let dir = tempfile::tempdir().unwrap();
        let mut child = Command::new("dbus-daemon")
            .args(["--session", "--nofork", "--print-address=1"])
            .arg(format!("--address=unix:dir={}", dir.path().display()))
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .expect("dbus-daemon must be installed to run D-Bus tests");
        let mut line = String::new();
        BufReader::new(child.stdout.take().unwrap())
            .read_line(&mut line)
            .unwrap();
        TestBus {
            child,
            address: line.trim().to_owned(),
            _dir: dir,
        }
    }

    pub fn address(&self) -> &str {
        &self.address
    }

    pub async fn connect(&self) -> zbus::Connection {
        zbus::connection::Builder::address(self.address())
            .unwrap()
            .build()
            .await
            .unwrap()
    }
}

impl Drop for TestBus {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}
