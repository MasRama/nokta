import {
    appearanceFrom,
    behaviorFrom,
    calendarFrom,
    clipboardFrom,
    downloadsFrom,
    homeFrom,
    lyricsFrom,
    mediaFrom,
    notificationsFrom,
    systemFrom,
    timerFrom,
    weatherFrom,
    type Appearance,
    type Behavior,
    type CalendarSettings,
    type ClipboardSettings,
    type DownloadsSettings,
    type HomeSettings,
    type Lyrics,
    type MediaSettings,
    type NotificationSettings,
    type SystemSettings,
    type TimerSettings,
    type WeatherSettings,
} from '@ext/features/settings/logic/parse.js';

import type { Bridge, Props } from './bridge/bridge.js';

const SETTINGS = 'Settings1';

/** Settings1's PicturePath, PictureColor and PictureTone. */
export interface PreparedPicture {
    path: string;
    color: string;
    tone: string;
}

/**
 * The settings the notch draws with, from Settings1 over the bridge: the
 * Windows twin of the extension's SettingsClient. It holds the defaults
 * until the first answer and tells `onChanged` after each change.
 */
export class Settings {
    appearance!: Appearance;
    behavior!: Behavior;
    media!: MediaSettings;
    lyrics!: Lyrics;
    timer!: TimerSettings;
    notifications!: NotificationSettings;
    calendar!: CalendarSettings;
    clipboard!: ClipboardSettings;
    downloads!: DownloadsSettings;
    system!: SystemSettings;
    weather!: WeatherSettings;
    home!: HomeSettings;
    picture: PreparedPicture = { path: '', color: '', tone: '' };
    private props: Props = {};
    private stop: (() => void) | null = null;

    constructor(
        private readonly bridge: Bridge,
        private readonly onChanged: () => void,
    ) {
        this.read();
    }

    /** Reads the settings and follows their changes. */
    async attach(): Promise<void> {
        this.stop = this.bridge.onChanged(SETTINGS, (changed) => {
            this.props = { ...this.props, ...changed };
            this.read();
            this.onChanged();
        });
        this.props = { ...(await this.bridge.props(SETTINGS)), ...this.props };
        this.read();
        this.onChanged();
    }

    detach(): void {
        this.stop?.();
        this.stop = null;
    }

    /** Sets one key; the new value comes back as a change. */
    async set(table: string, key: string, value: boolean | number | string | string[]): Promise<void> {
        await this.bridge.call(SETTINGS, 'Set', table, key, value);
    }

    private read(): void {
        const p = this.props;
        this.appearance = appearanceFrom(p.Appearance);
        this.behavior = behaviorFrom(p.Behavior);
        this.media = mediaFrom(p.Media);
        this.lyrics = lyricsFrom(p.Lyrics);
        this.timer = timerFrom(p.Timer);
        this.notifications = notificationsFrom(p.Notifications);
        this.calendar = calendarFrom(p.Calendar);
        this.clipboard = clipboardFrom(p.Clipboard);
        this.downloads = downloadsFrom(p.Downloads);
        this.system = systemFrom(p.System);
        this.weather = weatherFrom(p.Weather);
        this.home = homeFrom(p.Home);
        const text = (name: string): string => (typeof p[name] === 'string' ? p[name] : '');
        this.picture = { path: text('PicturePath'), color: text('PictureColor'), tone: text('PictureTone') };
    }
}
