//! Reads an event's iCalendar text, and its calendar's source, from
//! Evolution Data Server.

use zbus::Connection;

use super::color::source_color;
use super::link::{meeting_link, split_event_id};

const SOURCES_SERVICE: &str = "org.gnome.evolution.dataserver.Sources5";
const SOURCES_PATH: &str = "/org/gnome/evolution/dataserver/SourceManager";
const SOURCE_INTERFACE: &str = "org.gnome.evolution.dataserver.Source";

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

/// The color of the calendar source `source_uid`; `None` when it has none.
pub async fn read_color(conn: &Connection, source_uid: &str) -> zbus::Result<Option<String>> {
    let manager = zbus::fdo::ObjectManagerProxy::builder(conn)
        .destination(SOURCES_SERVICE)?
        .path(SOURCES_PATH)?
        .build()
        .await?;
    let objects = manager.get_managed_objects().await?;
    let data = objects
        .values()
        .flat_map(|interfaces| interfaces.iter())
        .filter(|(name, _)| name.as_str() == SOURCE_INTERFACE)
        .map(|(_, properties)| properties)
        .find(|properties| text(properties, "UID") == Some(source_uid))
        .and_then(|properties| text(properties, "Data"));
    Ok(data.and_then(source_color))
}

fn text<'a>(
    properties: &'a std::collections::HashMap<String, zbus::zvariant::OwnedValue>,
    name: &str,
) -> Option<&'a str> {
    properties.get(name)?.downcast_ref::<&str>().ok()
}
