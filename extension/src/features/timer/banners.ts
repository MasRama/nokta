import Gio from 'gi://Gio';

import type { BannerSetting } from './logic/quiet.js';

/** GNOME's notification banner switch, the one Do Not Disturb turns off. */
export function gnomeBanners(): BannerSetting {
    const settings = new Gio.Settings({ schema_id: 'org.gnome.desktop.notifications' });
    return {
        get: () => settings.get_boolean('show-banners'),
        set: (value) => settings.set_boolean('show-banners', value),
    };
}
