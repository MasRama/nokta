//! Finds a calendar's color in its EDS source.

/// The `Color` of the `[Calendar]` group in a source's key file, as
/// `#rrggbb`. Evolution writes `#rrggbb` (older versions `#rrrrggggbbbb`),
/// GNOME Calendar `rgb(r,g,b)`; anything else counts as none.
pub fn source_color(data: &str) -> Option<String> {
    let mut group = "";
    for line in data.lines().map(str::trim) {
        if let Some(name) = line.strip_prefix('[').and_then(|l| l.strip_suffix(']')) {
            group = name;
            continue;
        }
        if group != "Calendar" || line.starts_with('#') {
            continue;
        }
        if let Some((key, value)) = line.split_once('=') {
            if key.trim() == "Color" {
                return normalize(value.trim());
            }
        }
    }
    None
}

fn normalize(color: &str) -> Option<String> {
    let channels = match color.strip_prefix('#') {
        Some(hex) => from_hex(hex)?,
        None => from_rgb(color)?,
    };
    Some(format!(
        "#{:02x}{:02x}{:02x}",
        channels[0], channels[1], channels[2]
    ))
}

/// `rgb`, `rrggbb` or `rrrrggggbbbb`; of 4 digits per channel the first 2 count.
fn from_hex(hex: &str) -> Option<[u8; 3]> {
    if !hex.bytes().all(|b| b.is_ascii_hexdigit()) {
        return None;
    }
    let width = match hex.len() {
        3 => 1,
        6 => 2,
        12 => 4,
        _ => return None,
    };
    let mut channels = [0; 3];
    for (i, channel) in channels.iter_mut().enumerate() {
        let digits = &hex[i * width..i * width + width.min(2)];
        let value = u8::from_str_radix(digits, 16).ok()?;
        *channel = if width == 1 { value * 17 } else { value };
    }
    Some(channels)
}

/// `rgb(r,g,b)` or `rgba(r,g,b,a)`, channels 0 to 255.
fn from_rgb(color: &str) -> Option<[u8; 3]> {
    let inner = color
        .strip_prefix("rgba(")
        .or_else(|| color.strip_prefix("rgb("))?
        .strip_suffix(')')?;
    let mut parts = inner.split(',').map(str::trim);
    let mut channels = [0; 3];
    for channel in &mut channels {
        *channel = parts.next()?.parse().ok()?;
    }
    Some(channels)
}
