import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import Pango from 'gi://Pango';
import St from 'gi://St';

import { setVertical } from '../../shared/compat.js';
import { withAlpha } from '../../shared/logic/color.js';
import { type ControlColors, TogglePill, Tile } from './controls.js';
import { notificationBadge } from './logic/labels.js';
import { shownControls, type HomeLayout, type HomeTile, type QuickToggle, type QuickToggles } from './logic/layout.js';
import { SECONDARY } from '../../shared/dim.js';
import { iconFor } from '../../shared/icons.js';

/** A live activity, as one panel row shows it. */
export interface PanelActivity {
    icon: string;
    title: string;
    detail: string;
    /** 0 to 1, or null while the progress is unknown. */
    fraction: number | null;
    /** How long it has run, like `1 min 32 s`. */
    elapsed: string;
}

/** A countdown, stopwatch or alarm, as one panel row shows it. */
export interface PanelClock {
    id: string;
    /** An icon name for iconFor. */
    icon: string;
    color: string;
    title: string;
    /** Shown dimmed after the title, like `Paused · 10 min`. */
    detail: string;
    /** Like `4:59`. */
    time: string;
    running: boolean;
    /** False for an alarm, which only goes off or is removed. */
    canPause: boolean;
}

/** The microphone on for a call, as its panel row shows it. */
export interface PanelCall {
    icon: Gio.Icon;
    title: string;
    /** Like `Microphone · 12:03`. */
    detail: string;
    muted: boolean;
}

/** The weather beside the date. */
export interface PanelWeather {
    icon: string;
    /** Like `31°`. */
    temperature: string;
    /** Shown dimmed, like `Jakarta · 33° / 25°`. */
    detail: string;
}

/** The next calendar event. */
export interface PanelEvent {
    title: string;
    /** Like `10:30 · in 25 min`, shown dimmed. */
    when: string;
}

export type { HomeLayout, HomeTile, QuickToggle, QuickToggles } from './logic/layout.js';

/** What home shows, worked out by the session when it opens. */
export interface PanelContent {
    /** Today, like `Wednesday, 28 October`, in the user's language. */
    date: string;
    /** Null hides the weather. */
    weather: PanelWeather | null;
    /** Null hides the event row. */
    event: PanelEvent | null;
    /** How long the screen has been recorded, like `1:05`; null hides the row. */
    recording: string | null;
    /** Null hides the call row. */
    call: PanelCall | null;
    /** Newest first; the panel shows the first MAX_PANEL_ACTIVITIES. */
    activities: readonly PanelActivity[];
    /** How many wait in GNOME's message list; null when GNOME does not say. */
    notificationCount: number | null;
    /** A focus session or a break is set. */
    focusActive: boolean;
    /** Newest first; the panel shows the first MAX_PANEL_CLOCKS. */
    clocks: readonly PanelClock[];
    toggles: QuickToggles;
    /** A player is open, so home has a way back to it. */
    player: boolean;
    /** The clipboard history is on, so home has its tile. */
    clipboard: boolean;
    layout: HomeLayout;
}

export const MAX_PANEL_ACTIVITIES = 3;
export const MAX_PANEL_CLOCKS = 3;

export interface PanelHandlers {
    openCalendar(): void;
    openNotifications(): void;
    toggleFocus(): void;
    openSettings(): void;
    openScreenshot(): void;
    openClipboard(): void;
    openTimer(): void;
    openPlayer(): void;
    toggle(which: QuickToggle): void;
    pauseClock(id: string, paused: boolean): void;
    removeClock(id: string): void;
    stopRecording(): void;
    toggleCallMute(): void;
    hideCall(): void;
}

/** Each toggle's icon and name. */
const TOGGLES: Array<[QuickToggle, string, string]> = [
    ['do_not_disturb', 'notifications-disabled-symbolic', 'Do Not Disturb'],
    ['caffeine', 'nokta-caffeine', 'Caffeine'],
    ['dark_style', 'dark-mode-symbolic', 'Dark Style'],
    ['night_light', 'night-light-symbolic', 'Night Light'],
];

/** Each tile's icon and name. */
const TILES: Array<[HomeTile, string, string]> = [
    ['notifications', 'preferences-system-notifications-symbolic', 'Notifications'],
    ['focus', 'nokta-focus', 'Focus'],
    ['timer', 'nokta-timer', 'Timer'],
    ['clipboard', 'edit-paste-symbolic', 'Clipboard'],
    ['settings', 'emblem-system-symbolic', 'Settings'],
    ['screenshot', 'camera-photo-symbolic', 'Screenshot'],
];

/** One live activity: icon, title, detail and elapsed time, and a thin bar. */
class ActivityRow {
    readonly actor: St.BoxLayout;
    private readonly icon: St.Icon;
    private readonly title: St.Label;
    private readonly detail: St.Label;
    private readonly elapsed: St.Label;
    private readonly track: St.Widget;
    private readonly fill: St.Widget;

    constructor() {
        this.icon = new St.Icon({ style_class: 'nokta-panel-activity-icon', y_align: Clutter.ActorAlign.CENTER });
        this.title = new St.Label({ style_class: 'nokta-panel-activity-title', x_expand: true });
        this.detail = new St.Label({ style_class: 'nokta-panel-activity-detail', x_expand: true });
        this.elapsed = new St.Label({ style_class: 'nokta-panel-activity-elapsed' });
        for (const label of [this.title, this.detail]) label.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        const second = new St.BoxLayout({ x_expand: true });
        second.add_child(this.detail);
        second.add_child(this.elapsed);
        this.track = new St.Widget({
            style_class: 'nokta-panel-activity-track',
            layout_manager: new Clutter.BinLayout(),
            x_expand: true,
        });
        // Scaled from the left edge, like the OSD bar.
        this.fill = new St.Widget({ style_class: 'nokta-panel-activity-fill', x_expand: true, y_expand: true });
        this.fill.set_pivot_point(0, 0.5);
        this.track.add_child(this.fill);
        const text = setVertical(new St.BoxLayout({ style_class: 'nokta-panel-activity-text', x_expand: true }));
        text.add_child(this.title);
        text.add_child(second);
        text.add_child(this.track);
        this.actor = new St.BoxLayout({ style_class: 'nokta-panel-activity', visible: false });
        this.actor.add_child(this.icon);
        this.actor.add_child(text);
    }

    show(activity: PanelActivity | undefined): void {
        this.actor.visible = activity !== undefined;
        if (!activity) return;
        this.icon.gicon = iconFor(activity.icon);
        this.title.text = activity.title;
        this.detail.text = activity.detail;
        this.elapsed.text = activity.elapsed;
        this.track.opacity = activity.fraction === null ? 0 : 255;
        this.fill.scale_x = activity.fraction ?? 0;
    }

    setForeground(color: string): void {
        this.track.style = `background-color: ${withAlpha(color, 0.2)};`;
        this.fill.style = `background-color: ${color};`;
    }
}

/** One clock: its icon in the kind's color, title, detail, time, and pause and remove buttons. */
class ClockRow {
    readonly actor: St.BoxLayout;
    private readonly icon: St.Icon;
    private readonly title: St.Label;
    private readonly detail: St.Label;
    private readonly time: St.Label;
    private readonly pause: St.Button;
    private readonly pauseIcon: St.Icon;
    private clock: PanelClock | null = null;

    constructor(handlers: Pick<PanelHandlers, 'pauseClock' | 'removeClock'>) {
        this.icon = new St.Icon({ style_class: 'nokta-panel-clock-icon', y_align: Clutter.ActorAlign.CENTER });
        this.title = new St.Label({ style_class: 'nokta-panel-clock-title', y_align: Clutter.ActorAlign.CENTER });
        this.detail = new St.Label({
            style_class: 'nokta-panel-clock-detail',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this.title.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        this.detail.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        this.detail.opacity = SECONDARY;
        this.time = new St.Label({ style_class: 'nokta-panel-clock-time', y_align: Clutter.ActorAlign.CENTER });
        this.pauseIcon = new St.Icon({ style_class: 'nokta-button-icon' });
        this.pause = new St.Button({
            style_class: 'nokta-button nokta-panel-clock-pause',
            child: this.pauseIcon,
            y_align: Clutter.ActorAlign.CENTER,
            can_focus: true,
        });
        this.pause.connect('clicked', () => {
            if (this.clock) handlers.pauseClock(this.clock.id, this.clock.running);
        });
        const remove = new St.Button({
            style_class: 'nokta-button nokta-panel-clock-remove',
            child: new St.Icon({ gicon: iconFor('window-close-symbolic'), style_class: 'nokta-button-icon' }),
            y_align: Clutter.ActorAlign.CENTER,
            can_focus: true,
        });
        remove.connect('clicked', () => {
            if (this.clock) handlers.removeClock(this.clock.id);
        });
        this.actor = new St.BoxLayout({ style_class: 'nokta-panel-clock', visible: false });
        for (const child of [this.icon, this.title, this.detail, this.time, this.pause, remove])
            this.actor.add_child(child);
    }

    show(clock: PanelClock | undefined): void {
        this.clock = clock ?? null;
        this.actor.visible = clock !== undefined;
        if (!clock) return;
        this.icon.gicon = iconFor(clock.icon);
        this.icon.style = `color: ${clock.color};`;
        this.title.text = clock.title;
        this.detail.text = clock.detail;
        this.time.text = clock.time;
        this.time.opacity = clock.running ? 255 : 128;
        this.pause.visible = clock.canPause;
        this.pauseIcon.gicon = iconFor(clock.running ? 'media-playback-pause-symbolic' : 'media-playback-start-symbolic');
    }
}

/** The screen recording: a red dot, how long, and a stop button. */
class RecordingRow {
    readonly actor: St.BoxLayout;
    private readonly time: St.Label;

    constructor(handlers: Pick<PanelHandlers, 'stopRecording'>) {
        const icon = new St.Icon({
            gicon: iconFor('media-record-symbolic'),
            style_class: 'nokta-panel-recording-icon',
            style: 'color: #ff453a;',
            y_align: Clutter.ActorAlign.CENTER,
        });
        const title = new St.Label({
            text: 'Screen recording',
            style_class: 'nokta-panel-recording-title',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this.time = new St.Label({ style_class: 'nokta-panel-recording-time', y_align: Clutter.ActorAlign.CENTER });
        const stop = new St.Button({
            style_class: 'nokta-button nokta-panel-recording-stop',
            child: new St.Icon({ gicon: iconFor('media-playback-stop-symbolic'), style_class: 'nokta-button-icon' }),
            y_align: Clutter.ActorAlign.CENTER,
            can_focus: true,
        });
        stop.connect('clicked', () => handlers.stopRecording());
        this.actor = new St.BoxLayout({ style_class: 'nokta-panel-recording', visible: false });
        for (const child of [icon, title, this.time, stop]) this.actor.add_child(child);
    }

    show(time: string | null): void {
        this.actor.visible = time !== null;
        if (time !== null) this.time.text = time;
    }
}

/** The call: the app's icon and name, the time, and mute and hide buttons. */
class CallRow {
    readonly actor: St.BoxLayout;
    private readonly icon: St.Icon;
    private readonly title: St.Label;
    private readonly detail: St.Label;
    private readonly muteIcon: St.Icon;

    constructor(handlers: Pick<PanelHandlers, 'toggleCallMute' | 'hideCall'>) {
        this.icon = new St.Icon({ style_class: 'nokta-panel-call-icon', y_align: Clutter.ActorAlign.CENTER });
        this.title = new St.Label({ style_class: 'nokta-panel-call-title', y_align: Clutter.ActorAlign.CENTER });
        this.detail = new St.Label({
            style_class: 'nokta-panel-call-detail',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this.title.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        this.detail.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        this.detail.opacity = SECONDARY;
        this.muteIcon = new St.Icon({ style_class: 'nokta-button-icon' });
        const mute = new St.Button({
            style_class: 'nokta-button nokta-panel-call-mute',
            child: this.muteIcon,
            y_align: Clutter.ActorAlign.CENTER,
            can_focus: true,
        });
        mute.connect('clicked', () => handlers.toggleCallMute());
        const hide = new St.Button({
            style_class: 'nokta-button nokta-panel-call-hide',
            child: new St.Icon({ gicon: iconFor('window-close-symbolic'), style_class: 'nokta-button-icon' }),
            y_align: Clutter.ActorAlign.CENTER,
            can_focus: true,
        });
        hide.connect('clicked', () => handlers.hideCall());
        this.actor = new St.BoxLayout({ style_class: 'nokta-panel-call', visible: false });
        for (const child of [this.icon, this.title, this.detail, mute, hide]) this.actor.add_child(child);
    }

    show(call: PanelCall | null): void {
        this.actor.visible = call !== null;
        if (!call) return;
        this.icon.gicon = call.icon;
        this.title.text = call.title;
        this.detail.text = call.detail;
        this.muteIcon.gicon = iconFor(call.muted ? 'microphone-disabled-symbolic' : 'audio-input-microphone-symbolic');
        this.muteIcon.style = call.muted ? 'color: #ff453a;' : '';
    }
}

/** Today's weather at the end of the date line: icon, temperature, then the place and range dimmed. */
class WeatherBox {
    readonly actor: St.BoxLayout;
    private readonly icon: St.Icon;
    private readonly temperature: St.Label;
    private readonly detail: St.Label;

    constructor() {
        this.icon = new St.Icon({ style_class: 'nokta-panel-weather-icon', y_align: Clutter.ActorAlign.CENTER });
        this.temperature = new St.Label({
            style_class: 'nokta-panel-weather-temperature',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this.detail = new St.Label({ style_class: 'nokta-panel-weather-detail', y_align: Clutter.ActorAlign.CENTER });
        this.detail.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        // St CSS ignores opacity.
        this.detail.opacity = SECONDARY;
        this.actor = new St.BoxLayout({ style_class: 'nokta-panel-weather', visible: false });
        this.actor.add_child(this.icon);
        this.actor.add_child(this.temperature);
        this.actor.add_child(this.detail);
    }

    show(weather: PanelWeather | null): void {
        this.actor.visible = weather !== null;
        if (!weather) return;
        this.icon.gicon = iconFor(weather.icon);
        this.temperature.text = weather.temperature;
        this.detail.text = weather.detail;
    }
}

/** The next event in one line: calendar icon, title, then when, dimmed. A click opens the calendar. */
class EventRow {
    readonly actor: St.Button;
    private readonly title: St.Label;
    private readonly when: St.Label;
    private readonly clickId: number;

    constructor(onClick: () => void) {
        const box = new St.BoxLayout({ style_class: 'nokta-panel-event-box', x_expand: true });
        box.add_child(
            new St.Icon({
                style_class: 'nokta-panel-event-icon',
                gicon: iconFor('x-office-calendar-symbolic'),
                y_align: Clutter.ActorAlign.CENTER,
            }),
        );
        this.title = new St.Label({ style_class: 'nokta-panel-event-title', y_align: Clutter.ActorAlign.CENTER });
        this.title.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        this.when = new St.Label({ style_class: 'nokta-panel-event-when', y_align: Clutter.ActorAlign.CENTER });
        // St CSS ignores opacity.
        this.when.opacity = SECONDARY;
        box.add_child(this.title);
        box.add_child(this.when);
        this.actor = new St.Button({ style_class: 'nokta-panel-event', child: box, x_expand: true, visible: false });
        this.clickId = this.actor.connect('clicked', onClick);
    }

    show(event: PanelEvent | null): void {
        this.actor.visible = event !== null;
        if (!event) return;
        this.title.text = event.title;
        this.when.text = event.when;
    }

    destroy(): void {
        this.actor.disconnect(this.clickId);
    }
}

/**
 * Home, the open notch's other page and the only one while nothing plays:
 * the date and weather, the next event, a screen recording, a call, live
 * activities, then the quick toggles and a row of tiles.
 */
export class HomePanel {
    readonly actor: St.BoxLayout;
    private readonly date: St.Label;
    private readonly weather = new WeatherBox();
    private readonly playerButton: St.Button;
    private readonly event: EventRow;
    private readonly recording: RecordingRow;
    private readonly call: CallRow;
    private readonly activities: ActivityRow[] = [];
    private readonly clocks: ClockRow[] = [];
    private readonly toggles = new Map<QuickToggle, TogglePill>();
    private readonly tiles = new Map<HomeTile, Tile>();
    private readonly pills: St.BoxLayout;
    private readonly tileRow: St.BoxLayout;
    private readonly controls: St.BoxLayout;

    constructor(handlers: PanelHandlers) {
        this.actor = setVertical(new St.BoxLayout({ style_class: 'nokta-panel' }));
        this.date = new St.Label({ style_class: 'nokta-panel-date', x_expand: true, y_align: Clutter.ActorAlign.CENTER });
        this.date.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        this.playerButton = new St.Button({
            style_class: 'nokta-button nokta-panel-player',
            child: new St.Icon({ gicon: iconFor('audio-x-generic-symbolic'), style_class: 'nokta-button-icon' }),
            y_align: Clutter.ActorAlign.CENTER,
            can_focus: true,
            visible: false,
        });
        this.playerButton.connect('clicked', () => handlers.openPlayer());
        const heading = new St.BoxLayout({ style_class: 'nokta-panel-heading' });
        heading.add_child(this.date);
        heading.add_child(this.weather.actor);
        heading.add_child(this.playerButton);
        this.event = new EventRow(() => handlers.openCalendar());
        this.recording = new RecordingRow(handlers);
        this.call = new CallRow(handlers);

        this.pills = new St.BoxLayout({ style_class: 'nokta-panel-toggles' });
        for (const [which, icon, label] of TOGGLES) {
            const pill = new TogglePill(iconFor(icon), label, () => handlers.toggle(which));
            this.toggles.set(which, pill);
            this.pills.add_child(pill.actor);
        }
        const actions: Record<HomeTile, () => void> = {
            notifications: () => handlers.openNotifications(),
            focus: () => handlers.toggleFocus(),
            timer: () => handlers.openTimer(),
            clipboard: () => handlers.openClipboard(),
            settings: () => handlers.openSettings(),
            screenshot: () => handlers.openScreenshot(),
        };
        this.tileRow = new St.BoxLayout({ style_class: 'nokta-panel-tiles' });
        for (const [which, icon, label] of TILES) {
            const tile = new Tile(iconFor(icon), label, actions[which]);
            this.tiles.set(which, tile);
            this.tileRow.add_child(tile.actor);
        }
        this.controls = setVertical(new St.BoxLayout({ style_class: 'nokta-panel-controls' }));
        this.controls.add_child(this.pills);
        this.controls.add_child(this.tileRow);

        this.actor.add_child(heading);
        this.actor.add_child(this.event.actor);
        this.actor.add_child(this.recording.actor);
        this.actor.add_child(this.call.actor);
        for (let i = 0; i < MAX_PANEL_ACTIVITIES; i++) {
            const row = new ActivityRow();
            this.activities.push(row);
            this.actor.add_child(row.actor);
        }
        for (let i = 0; i < MAX_PANEL_CLOCKS; i++) {
            const row = new ClockRow(handlers);
            this.clocks.push(row);
            this.actor.add_child(row.actor);
        }
        this.actor.add_child(this.controls);
    }

    /** Puts a row above the toggles. */
    addRow(actor: Clutter.Actor): void {
        this.actor.insert_child_below(actor, this.controls);
    }

    show(content: PanelContent): void {
        this.date.text = content.date;
        this.weather.show(content.weather);
        this.playerButton.visible = content.player;
        this.event.show(content.event);
        this.recording.show(content.recording);
        this.call.show(content.call);
        this.activities.forEach((row, i) => row.show(content.activities[i]));
        this.clocks.forEach((row, i) => row.show(content.clocks[i]));
        for (const [which, pill] of this.toggles) pill.set(content.toggles[which] === true);
        this.tiles.get('notifications')?.set(false, notificationBadge(content.notificationCount));
        this.tiles.get('focus')?.set(content.focusActive);
        this.tiles.get('timer')?.set(content.clocks.length > 0);
        this.arrange(shownControls(content.layout, content.toggles, content.clipboard));
    }

    setColors(colors: ControlColors): void {
        for (const pill of this.toggles.values()) pill.setColors(colors);
        for (const tile of this.tiles.values()) tile.setColors(colors);
        for (const row of this.activities) row.setForeground(colors.foreground);
    }

    destroy(): void {
        this.event.destroy();
        this.actor.destroy();
    }

    /** Shows the layout's toggles and tiles in its order; a row with none goes away. */
    private arrange(layout: HomeLayout): void {
        const place = <T extends string>(
            box: St.BoxLayout,
            controls: Map<T, { actor: St.Button }>,
            shown: readonly T[],
        ) => {
            shown.forEach((name, i) => {
                const actor = controls.get(name)?.actor;
                if (actor) box.set_child_at_index(actor, i);
            });
            for (const [name, { actor }] of controls) actor.visible = shown.includes(name);
            box.visible = shown.length > 0;
        };
        place(this.pills, this.toggles, layout.toggles);
        place(this.tileRow, this.tiles, layout.tiles);
        this.controls.visible = this.pills.visible || this.tileRow.visible;
    }
}
