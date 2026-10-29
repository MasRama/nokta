import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import { PATHS } from '../../shared/contracts.js';
import { cached, makeProxy } from '../../shared/dbus.js';
import { SETTINGS1_XML } from '../../generated/contracts.js';
import {
    appearanceFrom,
    behaviorFrom,
    calendarFrom,
    clipboardFrom,
    DEFAULT_APPEARANCE,
    DEFAULT_BEHAVIOR,
    DEFAULT_CALENDAR,
    DEFAULT_CLIPBOARD,
    DEFAULT_LYRICS,
    DEFAULT_MEDIA,
    homeFrom,
    DEFAULT_NOTIFICATIONS,
    DEFAULT_TIMER,
    notificationsFrom,
    lyricsFrom,
    mediaFrom,
    timerFrom,
    type Appearance,
    type Behavior,
    type CalendarSettings,
    type ClipboardSettings,
    type HomeSettings,
    type Lyrics,
    type MediaSettings,
    type NotificationSettings,
    type TimerSettings,
} from './logic/parse.js';

/** Settings1's PicturePath, PictureColor and PictureTone. */
export interface PreparedPicture {
    path: string;
    color: string;
    tone: string;
}

/**
 * The notch's appearance, behavior, media, lyrics, timer, notification, calendar, clipboard and home settings from io.nokta.Settings1. Until the
 * daemon answers it holds the defaults; when the daemon goes away it
 * keeps the last values it saw, so a daemon restart does not flicker.
 */
export class SettingsClient {
    appearance: Appearance = { ...DEFAULT_APPEARANCE };
    behavior: Behavior = { ...DEFAULT_BEHAVIOR };
    media: MediaSettings = { ...DEFAULT_MEDIA };
    lyrics: Lyrics = { ...DEFAULT_LYRICS };
    timer: TimerSettings = { ...DEFAULT_TIMER };
    notifications: NotificationSettings = { ...DEFAULT_NOTIFICATIONS };
    calendar: CalendarSettings = { ...DEFAULT_CALENDAR };
    clipboard: ClipboardSettings = { ...DEFAULT_CLIPBOARD };
    home: HomeSettings = homeFrom(undefined);
    /** The picture theme's image as the daemon prepared it; empty strings while there is none. */
    picture: PreparedPicture = { path: '', color: '', tone: '' };
    private proxy: Gio.DBusProxy | null = null;
    private changedId = 0;

    constructor(private readonly onChanged: () => void) {}

    async attach(connection: Gio.DBusConnection, cancellable: Gio.Cancellable): Promise<void> {
        const proxy = await makeProxy(SETTINGS1_XML, PATHS.Settings1, connection, cancellable);
        this.detach();
        this.proxy = proxy;
        this.changedId = proxy.connect('g-properties-changed', () => this.read());
        this.read();
    }

    /**
     * Sets one key through io.nokta.Settings1.Set; the new value comes back
     * as a property change. Rejects while the daemon is away or refuses it.
     */
    set(table: string, key: string, value: GLib.Variant): Promise<void> {
        const proxy = this.proxy;
        if (!proxy) return Promise.reject(new Error('noktad is not running'));
        const params = new GLib.Variant('(ssv)', [table, key, value]);
        return new Promise((resolve, reject) => {
            proxy.call('Set', params, Gio.DBusCallFlags.NONE, -1, null, (source, result) => {
                try {
                    source?.call_finish(result);
                    resolve();
                } catch (error) {
                    reject(error as Error);
                }
            });
        });
    }

    detach(): void {
        if (!this.proxy) return;
        this.proxy.disconnect(this.changedId);
        this.proxy = null;
        this.changedId = 0;
    }

    private read(): void {
        if (!this.proxy) return;
        this.appearance = appearanceFrom(cached(this.proxy, 'Appearance'));
        this.behavior = behaviorFrom(cached(this.proxy, 'Behavior'));
        this.media = mediaFrom(cached(this.proxy, 'Media'));
        this.lyrics = lyricsFrom(cached(this.proxy, 'Lyrics'));
        this.timer = timerFrom(cached(this.proxy, 'Timer'));
        this.notifications = notificationsFrom(cached(this.proxy, 'Notifications'));
        this.calendar = calendarFrom(cached(this.proxy, 'Calendar'));
        this.clipboard = clipboardFrom(cached(this.proxy, 'Clipboard'));
        this.home = homeFrom(cached(this.proxy, 'Home'));
        const text = (name: string): string => {
            const value = cached(this.proxy!, name);
            return typeof value === 'string' ? value : '';
        };
        this.picture = { path: text('PicturePath'), color: text('PictureColor'), tone: text('PictureTone') };
        this.onChanged();
    }
}
