import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import Pango from 'gi://Pango';
import St from 'gi://St';

import { setVertical } from '../../shared/compat.js';
import { TintedButton } from '../../shared/button.js';
import { withAlpha } from '../../shared/logic/color.js';

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

/** What the idle panel shows, worked out by the session when it opens. */
export interface PanelContent {
    /** Today, like `Wednesday, 28 October`, in the user's language. */
    date: string;
    /** Null hides the weather. */
    weather: PanelWeather | null;
    /** Null hides the event row. */
    event: PanelEvent | null;
    /** Newest first; the panel shows the first MAX_PANEL_ACTIVITIES. */
    activities: readonly PanelActivity[];
    notifications: string;
    focus: string;
}

export const MAX_PANEL_ACTIVITIES = 3;

export interface PanelHandlers {
    openCalendar(): void;
    openNotifications(): void;
    toggleFocus(): void;
}

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
        this.icon.gicon = new Gio.ThemedIcon({ name: activity.icon });
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
        this.detail.opacity = 150;
        this.actor = new St.BoxLayout({ style_class: 'nokta-panel-weather', visible: false });
        this.actor.add_child(this.icon);
        this.actor.add_child(this.temperature);
        this.actor.add_child(this.detail);
    }

    show(weather: PanelWeather | null): void {
        this.actor.visible = weather !== null;
        if (!weather) return;
        this.icon.gicon = new Gio.ThemedIcon({ name: weather.icon });
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
                gicon: new Gio.ThemedIcon({ name: 'x-office-calendar-symbolic' }),
                y_align: Clutter.ActorAlign.CENTER,
            }),
        );
        this.title = new St.Label({ style_class: 'nokta-panel-event-title', y_align: Clutter.ActorAlign.CENTER });
        this.title.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        this.when = new St.Label({ style_class: 'nokta-panel-event-when', y_align: Clutter.ActorAlign.CENTER });
        // St CSS ignores opacity.
        this.when.opacity = 150;
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

/** The open notch while nothing plays: the date and weather, the next event, live activities, then notifications and focus. */
export class IdlePanel {
    readonly actor: St.BoxLayout;
    private readonly date: St.Label;
    private readonly weather = new WeatherBox();
    private readonly event: EventRow;
    private readonly activities: ActivityRow[] = [];
    private readonly notifications: TintedButton;
    private readonly focus: TintedButton;

    constructor(handlers: PanelHandlers) {
        this.actor = setVertical(new St.BoxLayout({ style_class: 'nokta-panel' }));
        this.date = new St.Label({ style_class: 'nokta-panel-date', x_expand: true, y_align: Clutter.ActorAlign.CENTER });
        this.date.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        const heading = new St.BoxLayout({ style_class: 'nokta-panel-heading' });
        heading.add_child(this.date);
        heading.add_child(this.weather.actor);
        this.event = new EventRow(() => handlers.openCalendar());
        this.notifications = new TintedButton('nokta-panel-button', 'preferences-system-notifications-symbolic', () =>
            handlers.openNotifications(),
        );
        this.focus = new TintedButton('nokta-panel-button', 'alarm-symbolic', () => handlers.toggleFocus());
        const buttons = new St.BoxLayout({ style_class: 'nokta-panel-buttons' });
        buttons.add_child(this.notifications.actor);
        buttons.add_child(this.focus.actor);
        this.actor.add_child(heading);
        this.actor.add_child(this.event.actor);
        for (let i = 0; i < MAX_PANEL_ACTIVITIES; i++) {
            const row = new ActivityRow();
            this.activities.push(row);
            this.actor.add_child(row.actor);
        }
        this.actor.add_child(buttons);
    }

    show(content: PanelContent): void {
        this.date.text = content.date;
        this.weather.show(content.weather);
        this.event.show(content.event);
        this.activities.forEach((row, i) => row.show(content.activities[i]));
        this.notifications.text = content.notifications;
        this.focus.text = content.focus;
    }

    setForeground(color: string): void {
        this.notifications.setForeground(color);
        this.focus.setForeground(color);
        for (const row of this.activities) row.setForeground(color);
    }

    destroy(): void {
        this.event.destroy();
        this.notifications.destroy();
        this.focus.destroy();
        this.actor.destroy();
    }
}
