//! A fake PackageKit on the test bus, standing in for the system bus: one
//! transaction at a time, driven by the test.

use zbus::object_server::SignalEmitter;
use zbus::zvariant::OwnedObjectPath;
use zbus::Connection;

use super::bus::TestBus;

const PATH: &str = "/org/freedesktop/PackageKit";

struct Manager {
    transactions: Vec<OwnedObjectPath>,
}

#[zbus::interface(name = "org.freedesktop.PackageKit")]
impl Manager {
    fn get_transaction_list(&self) -> Vec<OwnedObjectPath> {
        self.transactions.clone()
    }

    #[zbus(signal)]
    async fn transaction_list_changed(
        emitter: &SignalEmitter<'_>,
        transactions: Vec<String>,
    ) -> zbus::Result<()>;
}

#[derive(Default)]
struct Transaction {
    role: u32,
    status: u32,
    percentage: u32,
    flags: u64,
}

#[zbus::interface(name = "org.freedesktop.PackageKit.Transaction")]
impl Transaction {
    #[zbus(property)]
    fn role(&self) -> u32 {
        self.role
    }

    #[zbus(property)]
    fn status(&self) -> u32 {
        self.status
    }

    #[zbus(property)]
    fn percentage(&self) -> u32 {
        self.percentage
    }

    #[zbus(property)]
    fn transaction_flags(&self) -> u64 {
        self.flags
    }

    #[zbus(signal)]
    async fn finished(emitter: &SignalEmitter<'_>, exit: u32, runtime: u32) -> zbus::Result<()>;
}

/// Owns `org.freedesktop.PackageKit` on the test bus.
pub struct FakePackageKit {
    conn: Connection,
}

impl FakePackageKit {
    pub async fn start(bus: &TestBus) -> FakePackageKit {
        let conn = bus.connect().await;
        conn.object_server()
            .at(
                PATH,
                Manager {
                    transactions: vec![],
                },
            )
            .await
            .unwrap();
        conn.request_name("org.freedesktop.PackageKit")
            .await
            .unwrap();
        FakePackageKit { conn }
    }

    async fn list(&self) {
        let manager = self
            .conn
            .object_server()
            .interface::<_, Manager>(PATH)
            .await
            .unwrap();
        let paths = manager.get().await.transactions.clone();
        let names = paths.iter().map(|p| p.to_string()).collect();
        Manager::transaction_list_changed(manager.signal_emitter(), names)
            .await
            .unwrap();
    }

    /// A new transaction at `path`, then its role and flags, as PackageKit sets them.
    pub async fn begin(&self, path: &str, role: u32, flags: u64) {
        let server = self.conn.object_server();
        server.at(path, Transaction::default()).await.unwrap();
        let manager = server.interface::<_, Manager>(PATH).await.unwrap();
        manager
            .get_mut()
            .await
            .transactions
            .push(OwnedObjectPath::try_from(path).unwrap());
        self.list().await;
        let t = server.interface::<_, Transaction>(path).await.unwrap();
        {
            let mut t = t.get_mut().await;
            t.role = role;
            t.flags = flags;
        }
        t.get()
            .await
            .role_changed(t.signal_emitter())
            .await
            .unwrap();
    }

    pub async fn step(&self, path: &str, status: u32, percentage: u32) {
        let server = self.conn.object_server();
        let t = server.interface::<_, Transaction>(path).await.unwrap();
        {
            let mut t = t.get_mut().await;
            t.status = status;
            t.percentage = percentage;
        }
        let emitter = t.signal_emitter();
        t.get().await.status_changed(emitter).await.unwrap();
        t.get().await.percentage_changed(emitter).await.unwrap();
    }

    /// `Finished(exit)`, then the transaction leaves the list.
    pub async fn finish(&self, path: &str, exit: u32) {
        let server = self.conn.object_server();
        let t = server.interface::<_, Transaction>(path).await.unwrap();
        Transaction::finished(t.signal_emitter(), exit, 1000)
            .await
            .unwrap();
        server.remove::<Transaction, _>(path).await.unwrap();
        let manager = server.interface::<_, Manager>(PATH).await.unwrap();
        manager
            .get_mut()
            .await
            .transactions
            .retain(|p| p.as_str() != path);
        self.list().await;
    }
}
