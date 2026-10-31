//! A toast as Windows keeps it in its notification database: the XML an
//! app gave Windows, read for what the notch shows (the title, the lines
//! under it, the app's logo, the buttons) and for what a click opens. Pure,
//! so it is tested on every system; win/notifications.rs reads the
//! database.

// Only the Windows app uses it; the stub on other systems does not.
#![cfg_attr(not(windows), allow(dead_code))]

#[derive(Debug, Default, PartialEq)]
pub struct Toast {
    pub title: String,
    /// The lines under the title, one per line.
    pub body: String,
    /// The `src` of the picture that stands for the app, as written.
    pub logo: Option<String>,
    /// The logo is cropped to a circle, as a person's picture is.
    pub round: bool,
    /// The URI a click on the toast opens, when it launches by protocol.
    pub launch: Option<String>,
    pub buttons: Vec<Button>,
}

#[derive(Debug, PartialEq)]
pub struct Button {
    pub label: String,
    /// The URI it opens, when it launches by protocol; else it opens the app.
    pub launch: Option<String>,
}

/// One `<binding>` of the toast's `<visual>`.
#[derive(Default)]
struct Binding {
    generic: bool,
    texts: Vec<String>,
    /// `(placement, src, round)` of each `<image>`.
    images: Vec<(String, String, bool)>,
}

/// Reads a toast's XML; None when it is not XML or says nothing.
pub fn parse(xml: &[u8]) -> Option<Toast> {
    use quick_xml::events::Event;

    let mut reader = quick_xml::Reader::from_reader(xml);
    let mut toast = Toast::default();
    let mut bindings: Vec<Binding> = Vec::new();
    let mut in_binding = false;
    // The text being read, unless it is the app's attribution line.
    let mut text: Option<String> = None;
    let mut buf = Vec::new();
    loop {
        let event = reader.read_event_into(&mut buf).ok()?;
        let empty = matches!(event, Event::Empty(_));
        match event {
            Event::Start(e) | Event::Empty(e) => {
                let attrs = attributes(&e);
                let attr = |name: &str| {
                    attrs
                        .iter()
                        .find(|(key, _)| key == name)
                        .map(|(_, value)| value.as_str())
                };
                let protocol = attr("activationType") == Some("protocol");
                match e.name().as_ref() {
                    "toast" if protocol => toast.launch = attr("launch").map(str::to_owned),
                    "binding" => {
                        in_binding = !empty;
                        bindings.push(Binding {
                            generic: attr("template") == Some("ToastGeneric"),
                            ..Binding::default()
                        });
                    }
                    "text" if in_binding && !empty && attr("placement") != Some("attribution") => {
                        text = Some(String::new());
                    }
                    "image" if in_binding => {
                        if let (Some(binding), Some(src)) = (bindings.last_mut(), attr("src")) {
                            binding.images.push((
                                attr("placement").unwrap_or_default().to_owned(),
                                src.to_owned(),
                                attr("hint-crop") == Some("circle"),
                            ));
                        }
                    }
                    "action" => {
                        let label = attr("content").unwrap_or_default().trim();
                        // System buttons (snooze, dismiss) act on Windows'
                        // own toast, background ones in the app unseen: the
                        // notch cannot do either.
                        let opens = matches!(
                            attr("activationType"),
                            None | Some("foreground") | Some("protocol")
                        );
                        if !label.is_empty() && opens && attr("placement") != Some("contextMenu") {
                            toast.buttons.push(Button {
                                label: label.to_owned(),
                                launch: attr("arguments").filter(|_| protocol).map(str::to_owned),
                            });
                        }
                    }
                    _ => {}
                }
            }
            Event::Text(e) => {
                if let Some(text) = &mut text {
                    text.push_str(&e.xml10_content());
                }
            }
            Event::CData(e) => {
                if let Some(text) = &mut text {
                    text.push_str(&e.xml10_content());
                }
            }
            Event::GeneralRef(e) => {
                if let Some(text) = &mut text {
                    let named = match e.xml10_content().as_ref() {
                        "amp" => Some('&'),
                        "lt" => Some('<'),
                        "gt" => Some('>'),
                        "quot" => Some('"'),
                        "apos" => Some('\''),
                        _ => None,
                    };
                    if let Some(c) = e.resolve_char_ref().ok().flatten().or(named) {
                        text.push(c);
                    }
                }
            }
            Event::End(e) => match e.name().as_ref() {
                "text" => {
                    if let (Some(text), Some(binding)) = (text.take(), bindings.last_mut()) {
                        let text = text.trim();
                        if !text.is_empty() {
                            binding.texts.push(text.to_owned());
                        }
                    }
                }
                "binding" => in_binding = false,
                _ => {}
            },
            Event::Eof => break,
            _ => {}
        }
        buf.clear();
    }
    // Windows draws the generic binding where an app gives several.
    let chosen = bindings.iter().position(|b| b.generic).unwrap_or(0);
    let binding = bindings.into_iter().nth(chosen)?;
    let mut texts = binding.texts.into_iter();
    toast.title = texts.next()?;
    toast.body = texts.collect::<Vec<_>>().join("\n");
    // The older templates have no placements: their one picture is the logo.
    let logo = binding.images.into_iter().find(|(placement, _, _)| {
        placement == "appLogoOverride" || (!binding.generic && placement.is_empty())
    });
    if let Some((_, src, round)) = logo {
        toast.logo = Some(src);
        toast.round = round;
    }
    Some(toast)
}

/// An element's attributes, their entities resolved.
fn attributes(e: &quick_xml::events::BytesStart) -> Vec<(String, String)> {
    e.attributes()
        .flatten()
        .filter_map(|a| {
            let value = a
                .normalized_value(quick_xml::XmlVersion::Implicit1_0)
                .ok()?;
            Some((a.key.as_ref().to_owned(), value.into_owned()))
        })
        .collect()
}

impl Toast {
    /// What a click opens: the toast's or the button's protocol URI, else
    /// the app `aumid` (its AppUserModelID) through Windows' Apps folder.
    pub fn target(&self, button: Option<usize>, aumid: &str) -> String {
        let launch = match button {
            Some(index) => self.buttons.get(index).and_then(|b| b.launch.as_deref()),
            None => self.launch.as_deref(),
        };
        match launch {
            Some(uri) if may_launch(uri) => uri.to_owned(),
            _ => format!("shell:AppsFolder\\{aumid}"),
        }
    }
}

/// Whether a toast's protocol URI may be opened: a URI with a scheme, never
/// a file, a path or Explorer's shell folders.
pub fn may_launch(uri: &str) -> bool {
    let Some((scheme, _)) = uri.split_once(':') else {
        return false;
    };
    // `C:` is a drive, not a scheme.
    let valid = scheme.len() > 1
        && scheme.starts_with(|c: char| c.is_ascii_alphabetic())
        && scheme
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '+' | '-' | '.'));
    valid && !matches!(scheme.to_ascii_lowercase().as_str(), "file" | "shell")
}

/// The local path of a toast's picture `src`, for a picture file only: a
/// `file:` URI, a path, or an app's own `ms-appdata:` folder, which lives
/// under `local_app_data`. None for a web picture or an app's package file.
pub fn picture_path(src: &str, aumid: &str, local_app_data: &str) -> Option<String> {
    let lower = src.to_ascii_lowercase();
    let path = if let Some(rest) = lower.strip_prefix("file:///").map(|_| &src[8..]) {
        let decoded = percent_encoding::percent_decode_str(rest)
            .decode_utf8()
            .ok()?;
        decoded.replace('/', "\\")
    } else if is_drive_path(src) {
        src.replace('/', "\\")
    } else if lower.starts_with("ms-appdata:///") {
        let (folder, file) = src[14..].split_once('/')?;
        let state = match folder.to_ascii_lowercase().as_str() {
            "local" => "LocalState",
            "roaming" => "RoamingState",
            "temp" => "TempState",
            _ => return None,
        };
        // A packaged app's id is its package family, `!`, its app.
        let (family, _) = aumid.split_once('!')?;
        let file = percent_encoding::percent_decode_str(file)
            .decode_utf8()
            .ok()?;
        format!(
            "{}\\Packages\\{family}\\{state}\\{}",
            local_app_data.trim_end_matches('\\'),
            file.replace('/', "\\")
        )
    } else {
        return None;
    };
    let picture = ["png", "jpg", "jpeg", "gif", "bmp", "webp", "ico"]
        .iter()
        .any(|ext| path.to_ascii_lowercase().ends_with(&format!(".{ext}")));
    (picture && !path.split('\\').any(|part| part == "..")).then_some(path)
}

/// `C:\` or `C:/`.
fn is_drive_path(src: &str) -> bool {
    let bytes = src.as_bytes();
    bytes.len() > 3
        && bytes[0].is_ascii_alphabetic()
        && bytes[1] == b':'
        && matches!(bytes[2], b'\\' | b'/')
}

/// Whether the notch holds a toast back, as Windows holds back its banner:
/// `user_state` is `SHQueryUserNotificationState`'s (1 away or locked, 4
/// presenting, 6 quiet hours; 2 and 3, a fullscreen app, are the page's to
/// decide), `focus` Do not disturb's profile (0 off).
pub fn holds_back(user_state: i32, focus: u32) -> bool {
    matches!(user_state, 1 | 4 | 6) || focus != 0
}

/// A database time (100 ns since 1601) in ms since the Unix epoch.
pub fn unix_ms(filetime: i64) -> i64 {
    const UNIX_EPOCH: i64 = 116_444_736_000_000_000;
    (filetime - UNIX_EPOCH) / 10_000
}

/// A name for the app `aumid` when Windows has none: its package's or
/// program's own name.
pub fn app_name(aumid: &str) -> String {
    // `{folder id}\Path\To\app.exe`: the program's name.
    if let Some(file) = aumid
        .rsplit(['\\', '/'])
        .next()
        .filter(|_| aumid.contains('\\'))
    {
        let stem = file.rsplit_once('.').map_or(file, |(stem, _)| stem);
        return stem.to_owned();
    }
    // `Publisher.App_hash!App`: the package's name, after its publisher.
    let package = aumid.split('!').next().unwrap_or(aumid);
    let name = package.split('_').next().unwrap_or(package);
    name.rsplit('.').next().unwrap_or(name).to_owned()
}

/// An icon Windows drew as 32-bit BGRA rows, top first, as a PNG. An icon
/// without alpha (every pixel 0) is opaque.
pub fn icon_png(width: u32, height: u32, bgra: &[u8]) -> Option<Vec<u8>> {
    if bgra.len() != (width as usize) * (height as usize) * 4 {
        return None;
    }
    let (pixels, _) = bgra.as_chunks::<4>();
    let opaque = pixels.iter().all(|p| p[3] == 0);
    let rgba = pixels
        .iter()
        .flat_map(|p| [p[2], p[1], p[0], if opaque { 255 } else { p[3] }])
        .collect();
    let image = image::RgbaImage::from_raw(width, height, rgba)?;
    let mut png = std::io::Cursor::new(Vec::new());
    image.write_to(&mut png, image::ImageFormat::Png).ok()?;
    Some(png.into_inner())
}

#[cfg(test)]
mod tests {
    use super::*;

    const AUMID: &str = "5319275A.WhatsAppDesktop_cv1g1gvanyjgm!App";

    #[test]
    fn reads_a_generic_toast() {
        let xml = br#"<toast launch="chat?id=7" activationType="foreground">
            <visual><binding template="ToastGeneric">
                <text>Rani</text>
                <text>Sudah sampai &amp; makan &#x1F600;</text>
                <text>Nanti kabari</text>
                <text placement="attribution">via WhatsApp</text>
                <image placement="hero" src="file:///C:/hero.png"/>
                <image placement="appLogoOverride" hint-crop="circle" src="ms-appdata:///local/rani.png"/>
            </binding></visual>
            <actions>
                <input id="reply" type="text"/>
                <action content="Reply" arguments="reply" activationType="foreground"/>
                <action content="Mark as read" arguments="read" activationType="background"/>
                <action content="" arguments="dismiss" activationType="system"/>
                <action content="Open site" arguments="https://example.com/x" activationType="protocol"/>
                <action content="Copy" arguments="copy" placement="contextMenu"/>
            </actions>
        </toast>"#;
        let toast = parse(xml).unwrap();
        assert_eq!(toast.title, "Rani");
        assert_eq!(toast.body, "Sudah sampai & makan 😀\nNanti kabari");
        assert_eq!(toast.logo.as_deref(), Some("ms-appdata:///local/rani.png"));
        assert!(toast.round);
        assert_eq!(toast.launch, None);
        assert_eq!(
            toast.buttons,
            vec![
                Button {
                    label: "Reply".into(),
                    launch: None
                },
                Button {
                    label: "Open site".into(),
                    launch: Some("https://example.com/x".into())
                },
            ]
        );
    }

    #[test]
    fn reads_the_spike_toast_and_the_older_templates() {
        // What CI's PowerShell toast left in the database.
        let spike = br#"<toast><visual><binding template="ToastGeneric"><text>Nokta spike</text><text>Hello from CI</text></binding></visual><actions><action content="Reply" arguments="reply"/></actions></toast>"#;
        let toast = parse(spike).unwrap();
        assert_eq!(
            (toast.title.as_str(), toast.body.as_str()),
            ("Nokta spike", "Hello from CI")
        );
        assert_eq!(toast.buttons.len(), 1);
        let old = br#"<toast><visual>
            <binding template="ToastImageAndText02"><image id="1" src="C:\pics\a.png"/><text id="1">Build done</text><text id="2"/></binding>
        </visual></toast>"#;
        let toast = parse(old).unwrap();
        assert_eq!(
            (toast.title.as_str(), toast.body.as_str()),
            ("Build done", "")
        );
        assert_eq!(toast.logo.as_deref(), Some("C:\\pics\\a.png"));
        assert!(!toast.round);
    }

    #[test]
    fn says_nothing_for_an_empty_or_broken_toast() {
        assert_eq!(
            parse(b"<toast><visual><binding template=\"ToastGeneric\"/></visual></toast>"),
            None
        );
        assert_eq!(parse(b"<toast><visual><binding template=\"ToastGeneric\"><text>  </text></binding></visual></toast>"), None);
        assert_eq!(
            parse(b"<toast><visual><binding><text>a</binding></toast>"),
            None
        );
        assert_eq!(parse(b"not xml"), None);
    }

    #[test]
    fn a_click_opens_a_protocol_uri_or_else_the_app() {
        let toast = parse(br#"<toast launch="https://mail.example/inbox" activationType="protocol"><visual><binding template="ToastGeneric"><text>Mail</text></binding></visual>
            <actions><action content="Open" arguments="ms-settings:privacy" activationType="protocol"/><action content="Run" arguments="file:///C:/x.exe" activationType="protocol"/><action content="Reply" arguments="r"/></actions></toast>"#).unwrap();
        assert_eq!(toast.target(None, AUMID), "https://mail.example/inbox");
        assert_eq!(toast.target(Some(0), AUMID), "ms-settings:privacy");
        let app = format!("shell:AppsFolder\\{AUMID}");
        assert_eq!(toast.target(Some(1), AUMID), app);
        assert_eq!(toast.target(Some(2), AUMID), app);
        assert_eq!(toast.target(Some(9), AUMID), app);
    }

    #[test]
    fn launches_only_uris() {
        assert!(may_launch("https://example.com"));
        assert!(may_launch("spotify:track:1"));
        assert!(may_launch("ms-teams.v2:chat"));
        assert!(!may_launch("C:\\Windows\\System32\\cmd.exe"));
        assert!(!may_launch("FILE:///C:/x.exe"));
        assert!(!may_launch("shell:startup"));
        assert!(!may_launch("no scheme"));
        assert!(!may_launch("1abc:x"));
    }

    #[test]
    fn finds_a_picture_on_disk() {
        let local = "C:\\Users\\rani\\AppData\\Local";
        assert_eq!(
            picture_path("file:///C:/Users/rani/Temp/My%20Pic.png", AUMID, local).as_deref(),
            Some("C:\\Users\\rani\\Temp\\My Pic.png")
        );
        assert_eq!(
            picture_path("C:/a/b.JPG", AUMID, local).as_deref(),
            Some("C:\\a\\b.JPG")
        );
        assert_eq!(
            picture_path("ms-appdata:///local/avatars/rani.png", AUMID, local).as_deref(),
            Some("C:\\Users\\rani\\AppData\\Local\\Packages\\5319275A.WhatsAppDesktop_cv1g1gvanyjgm\\LocalState\\avatars\\rani.png")
        );
        assert_eq!(
            picture_path("ms-appdata:///temp/a.png", "Chrome", local),
            None
        );
        assert_eq!(
            picture_path("ms-appx:///Assets/logo.png", AUMID, local),
            None
        );
        assert_eq!(
            picture_path("https://example.com/a.png", AUMID, local),
            None
        );
        assert_eq!(
            picture_path("file:///C:/Windows/win.ini", AUMID, local),
            None
        );
        assert_eq!(picture_path("C:\\a\\..\\..\\b.png", AUMID, local), None);
    }

    #[test]
    fn holds_back_while_away_presenting_or_quiet() {
        assert!(!holds_back(5, 0));
        assert!(!holds_back(2, 0));
        assert!(!holds_back(3, 0));
        assert!(holds_back(1, 0));
        assert!(holds_back(4, 0));
        assert!(holds_back(6, 0));
        assert!(holds_back(5, 1));
        assert!(holds_back(5, 2));
    }

    #[test]
    fn reads_the_database_times() {
        // The spike's toast arrived on 2026-10-31 at 10:25 UTC.
        assert_eq!(unix_ms(134_379_159_038_417_780), 1_793_442_303_841);
        assert_eq!(unix_ms(116_444_736_000_000_000), 0);
    }

    #[test]
    fn names_an_app_by_its_id() {
        assert_eq!(app_name(AUMID), "WhatsAppDesktop");
        assert_eq!(
            app_name(
                "{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe"
            ),
            "powershell"
        );
        assert_eq!(app_name("Chrome"), "Chrome");
        assert_eq!(app_name("com.squirrel.slack.slack"), "slack");
    }

    #[test]
    fn makes_a_png_of_an_icon() {
        // One blue pixel at half alpha, then one with no alpha anywhere.
        let png = icon_png(1, 1, &[255, 0, 0, 128]).unwrap();
        let image = image::load_from_memory(&png).unwrap().to_rgba8();
        assert_eq!(image.get_pixel(0, 0).0, [0, 0, 255, 128]);
        let png = icon_png(1, 1, &[0, 255, 0, 0]).unwrap();
        let image = image::load_from_memory(&png).unwrap().to_rgba8();
        assert_eq!(image.get_pixel(0, 0).0, [0, 255, 0, 255]);
        assert_eq!(icon_png(2, 2, &[0; 4]), None);
    }
}
