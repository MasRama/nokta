//! Reads an event's iCalendar text from Evolution Data Server.

use zbus::Connection;

use super::link::{meeting_link, split_event_id};

#[zbus::proxy(
    interface = "org.gnome.evolution.dataserver.CalendarFactory",
    default_service = "org.gnome.evolution.dataserver.Calendar8",
    default_path = "/org/gnome/evolution/dataserver/CalendarFactory",
    gen_blocking = false
)]
trait CalendarFactory {
    /// The calendar's object path and the bus name that serves it.
    fn open_calendar(&self, source_uid: &str) -> zbus::Result<(String, String)>;
}

#[zbus::proxy(
    interface = "org.gnome.evolution.dataserver.Calendar",
    gen_blocking = false
)]
trait Calendar {
    fn open(&self) -> zbus::Result<Vec<String>>;
    fn get_object(&self, uid: &str, rid: &str) -> zbus::Result<String>;
}

/// The meeting link of the shell's event `event_id`; `None` when it has none.
pub async fn read_link(conn: &Connection, event_id: &str) -> zbus::Result<Option<String>> {
    let Some((source, uid, rid)) = split_event_id(event_id) else {
        return Ok(None);
    };
    let factory = CalendarFactoryProxy::new(conn).await?;
    let (path, service) = factory.open_calendar(&source).await?;
    let calendar = CalendarProxy::builder(conn)
        .destination(service)?
        .path(path)?
        .cache_properties(zbus::proxy::CacheProperties::No)
        .build()
        .await?;
    calendar.open().await?;
    let ics = calendar.get_object(&uid, &rid).await?;
    Ok(meeting_link(&ics))
}
