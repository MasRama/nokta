/** io.nokta.Settings1.Appearance in camelCase, with the defaults. */
export interface Appearance {
    height: number;
    idleWidth: number;
    playingWidth: number;
    expandedWidth: number;
    expandedHeight: number;
    cornerRadius: number;
    earRadius: number;
    background: string;
    foreground: string;
    useAlbumAccent: boolean;
    animationSpeed: number;
    osdWidth: number;
    backgroundOpacity: number;
    accent: string;
    /** One of THEMES in shared/logic/theme.ts; only "custom" uses the colors. */
    theme: string;
    /** A line along the closed notch for the timer, a countdown, an activity or the song. */
    progressLine: boolean;
    /** A glow under the notch in the colour of an alert. */
    alertGlow: boolean;
}

export interface Behavior {
    openDelayMs: number;
    closeDelayMs: number;
    moveClock: boolean;
    showLyrics: boolean;
    replaceOsd: boolean;
    osdDurationMs: number;
    showCapsLock: boolean;
    /** The new keyboard layout when it changes. */
    showInputSource: boolean;
    showNumLock: boolean;
    allMonitors: boolean;
    deviceAlerts: boolean;
    alertDurationMs: number;
    showClock: boolean;
    /** "system", "24h" or "12h"; anything else counts as "system". */
    clockFormat: string;
    /** Dots for the camera, microphone and screen sharing. */
    privacyDots: boolean;
    /** The app on a call and how long the microphone has been on, in the notch and home. */
    callIndicator: boolean;
    /** Live activities from apps and the nokta command. */
    liveActivities: boolean;
    /** Files dropped on the notch stay there until dragged out. */
    fileShelf: boolean;
    /** A preview with buttons in place of the screenshot banner. */
    screenshotPreview: boolean;
}

/** io.nokta.Settings1.Lyrics in camelCase. */
export interface Lyrics {
    enabled: boolean;
}

/** io.nokta.Settings1.Timer in camelCase. */
export interface TimerSettings {
    focusMinutes: number;
    /** 0 means no break after focus. */
    breakMinutes: number;
    longBreakMinutes: number;
    /** 0 means no long breaks. */
    sessionsBeforeLongBreak: number;
    sound: boolean;
    /** No notification banners while a focus session runs. */
    quietNotifications: boolean;
    /** Starts focus or stops the timer, in GNOME's key syntax; empty for none. */
    shortcut: string;
}

export const DEFAULT_APPEARANCE: Readonly<Appearance> = {
    height: 32,
    idleWidth: 180,
    playingWidth: 260,
    expandedWidth: 420,
    expandedHeight: 150,
    cornerRadius: 14,
    earRadius: 8,
    background: '#000000',
    foreground: '#ffffff',
    useAlbumAccent: true,
    animationSpeed: 1.0,
    osdWidth: 300,
    backgroundOpacity: 1.0,
    accent: '#ffffff',
    theme: 'midnight',
    progressLine: true,
    alertGlow: true,
};

export const DEFAULT_BEHAVIOR: Readonly<Behavior> = {
    openDelayMs: 120,
    closeDelayMs: 300,
    moveClock: true,
    showLyrics: true,
    replaceOsd: true,
    osdDurationMs: 1500,
    showCapsLock: true,
    showInputSource: true,
    showNumLock: false,
    allMonitors: true,
    deviceAlerts: true,
    alertDurationMs: 3000,
    showClock: true,
    clockFormat: 'system',
    privacyDots: true,
    callIndicator: true,
    liveActivities: true,
    fileShelf: true,
    screenshotPreview: true,
};

/** io.nokta.Settings1.Notifications in camelCase. */
export interface NotificationSettings {
    /** Banners GNOME would show go to the notch. */
    inNotch: boolean;
    durationMs: number;
    /** Off shows only the title and the app. */
    showBody: boolean;
}

/** io.nokta.Settings1.Activities in camelCase. */
export interface ActivitiesSettings {
    /** An activity with no update for this long ends. */
    staleMinutes: number;
}

export const DEFAULT_ACTIVITIES: Readonly<ActivitiesSettings> = {
    staleMinutes: 30,
};

/** io.nokta.Settings1.Weather in camelCase. */
export interface WeatherSettings {
    enabled: boolean;
    /** A place name or `latitude,longitude`; empty for no weather. */
    location: string;
    /** `celsius` or `fahrenheit`. */
    units: string;
}

export const DEFAULT_WEATHER: Readonly<WeatherSettings> = {
    enabled: true,
    location: '',
    units: 'celsius',
};

/** io.nokta.Settings1.Calendar in camelCase. */
export interface CalendarSettings {
    /** The next event in the open notch, and its reminders. */
    enabled: boolean;
    /** Minutes before an event to show it; 0 for no reminder. */
    reminderMinutes: number;
}

export const DEFAULT_CALENDAR: Readonly<CalendarSettings> = {
    enabled: true,
    reminderMinutes: 5,
};

/** io.nokta.Settings1.Clipboard in camelCase. */
export interface ClipboardSettings {
    /** Keep a history of what is copied. */
    enabled: boolean;
    /** Entries kept besides the pinned ones. */
    maxItems: number;
}

export const DEFAULT_CLIPBOARD: Readonly<ClipboardSettings> = {
    enabled: true,
    maxItems: 25,
};

export const DEFAULT_LYRICS: Readonly<Lyrics> = {
    enabled: true,
};

export const DEFAULT_TIMER: Readonly<TimerSettings> = {
    focusMinutes: 25,
    breakMinutes: 5,
    longBreakMinutes: 15,
    sessionsBeforeLongBreak: 4,
    sound: true,
    quietNotifications: true,
    shortcut: '<Super><Alt>f',
};

export const DEFAULT_NOTIFICATIONS: Readonly<NotificationSettings> = {
    inNotch: true,
    durationMs: 5000,
    showBody: true,
};

const isColor = (value: unknown): boolean => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);

const snakeCase = (key: string): string => key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

/**
 * Reads an a{sv} table from the daemon. Each key that is missing or has the
 * wrong type keeps its default, so an older or newer daemon never breaks the UI.
 */
function fromTable<T extends object>(raw: unknown, defaults: Readonly<T>): T {
    const table = raw !== null && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
    const out = { ...defaults } as Record<string, unknown>;
    for (const [key, fallback] of Object.entries(defaults)) {
        const value = table[snakeCase(key)];
        const valid =
            typeof value === typeof fallback &&
            (typeof value !== 'number' || Number.isFinite(value)) &&
            (typeof value !== 'string' || !isColor(fallback) || isColor(value));
        if (valid) out[key] = value;
    }
    return out as T;
}

export const appearanceFrom = (raw: unknown): Appearance => fromTable(raw, DEFAULT_APPEARANCE);
export const behaviorFrom = (raw: unknown): Behavior => fromTable(raw, DEFAULT_BEHAVIOR);
export const lyricsFrom = (raw: unknown): Lyrics => fromTable(raw, DEFAULT_LYRICS);
export const timerFrom = (raw: unknown): TimerSettings => fromTable(raw, DEFAULT_TIMER);
export const notificationsFrom = (raw: unknown): NotificationSettings => fromTable(raw, DEFAULT_NOTIFICATIONS);
export const activitiesFrom = (raw: unknown): ActivitiesSettings => fromTable(raw, DEFAULT_ACTIVITIES);
export const weatherFrom = (raw: unknown): WeatherSettings => fromTable(raw, DEFAULT_WEATHER);
export const calendarFrom = (raw: unknown): CalendarSettings => fromTable(raw, DEFAULT_CALENDAR);
export const clipboardFrom = (raw: unknown): ClipboardSettings => fromTable(raw, DEFAULT_CLIPBOARD);
