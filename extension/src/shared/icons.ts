import Gio from 'gi://Gio';

import { noktaIconName } from './logic/icon-names.js';

let iconsDir = '';

/** Where the extension keeps its icons; set once when it is enabled. */
export function setIconsDir(dir: string): void {
    iconsDir = dir;
}

/**
 * The icon for `name`: Nokta's own when it draws one (`nokta-focus`, or a
 * GNOME name such as `media-playback-start-symbolic`), else the theme's.
 */
export function iconFor(name: string): Gio.Icon {
    const own = iconsDir ? noktaIconName(name) : null;
    if (own) return new Gio.FileIcon({ file: Gio.File.new_for_path(`${iconsDir}/nokta-${own}-symbolic.svg`) });
    return new Gio.ThemedIcon({ name });
}

/** An icon from GNOME (an OSD, a notification), with Nokta's in place of a themed one it redraws. */
export function chromeIcon(gicon: Gio.Icon | null): Gio.Icon | null {
    if (!(gicon instanceof Gio.ThemedIcon)) return gicon;
    const name = gicon.get_names().find((n) => noktaIconName(n) !== null);
    return name ? iconFor(name) : gicon;
}
