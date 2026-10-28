import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {
    activityIcon,
    ActivitiesClient,
    endedAlert,
    formatElapsed,
    type EndedSignal,
} from './features/activities/index.js';
import {
    alarmAlert,
    CalendarAlarms,
    CalendarSource,
    eventTime,
    nextEvent,
    soonLabel,
    type Alarm,
    type CalendarEvent,
} from './features/calendar/index.js';
import { deviceAlert, DevicesClient, type AlertSignal } from './features/devices/index.js';
import { LyricsClient } from './features/lyrics/index.js';
import { MediaClient } from './features/media/index.js';
import {
    notificationCount,
    notificationLines,
    openMessageList,
    takeOverBanners,
    takesBanner,
    type TrayNotification,
} from './features/notifications/index.js';
import {
    CapsLockWatcher,
    capsLockContent,
    osdContent,
    routeOsd,
    takeOverOsd,
    type OsdContent,
    type OsdRequest,
} from './features/osd/index.js';
import { MAX_PANEL_ACTIVITIES, notificationsLabel, type PanelContent } from './features/panel/index.js';
import { PrivacyMonitor } from './features/privacy/index.js';
import { SettingsClient } from './features/settings/index.js';
import { ShelfClient, ShelfCoordinator } from './features/shelf/index.js';
import {
    breakAfterFocus,
    finishedAlert,
    focusButtonLabel,
    FocusShortcut,
    FocusToggle,
    gnomeBanners,
    msUntilNextSecond,
    QuietBanners,
    shortcutAction,
    TimerClient,
    wantsQuiet,
} from './features/timer/index.js';
import { WeatherClient } from './features/weather/index.js';
import { MonitorNotch, type PanelSource, type ShelfSource } from './monitor-notch.js';
import { API_VERSION } from './shared/contracts.js';
import { readApiVersion, unwatchDaemon, watchDaemon } from './shared/dbus.js';
import { formatClock, uses24h } from './shared/logic/format.js';
import { moveDateMenuRight, type Restore } from './shared/topbar.js';

const CAPS_LOCK_ICON = 'input-keyboard-symbolic';
const TIMER_ICON = 'alarm-symbolic';

const isCancelled = (error: unknown): boolean =>
    error instanceof GLib.Error && error.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED);

let warnedApiVersion = false;

/** Monitor of the focused window, else the one under the pointer. */
function focusedMonitor(): number {
    const window = global.display.focus_window as typeof global.display.focus_window | null;
    return window ? window.get_monitor() : global.display.get_current_monitor();
}

/**
 * Everything one enable() creates; destroy() undoes all of it. The clients,
 * the OSD hook and the top bar are shared; each monitor has a MonitorNotch.
 */
class Session {
    private readonly settings: SettingsClient;
    private readonly media = new MediaClient();
    private readonly lyrics = new LyricsClient();
    private readonly devices = new DevicesClient((alert) => this.onDeviceAlert(alert));
    private readonly timer = new TimerClient((phase) => this.onTimerFinished(phase));
    private readonly activities = new ActivitiesClient((ended) => this.onActivityEnded(ended));
    private readonly weather = new WeatherClient();
    private readonly shelf = new ShelfClient();
    private readonly shelfCoordinator: ShelfCoordinator;
    private readonly calendar = new CalendarSource();
    private readonly calendarAlarms = new CalendarAlarms(
        (nowMs) => this.calendarEvents(nowMs),
        () => this.settings.calendar.reminderMinutes,
        (alarm, nowMs) => this.onCalendarAlarm(alarm, nowMs),
    );
    private readonly interfaceSettings = new Gio.Settings({ schema_id: 'org.gnome.desktop.interface' });
    private readonly focusToggle: FocusToggle;
    private readonly quietBanners = new QuietBanners(gnomeBanners());
    private readonly focusShortcut: FocusShortcut;
    private readonly privacy = new PrivacyMonitor(() => this.notches.forEach((n) => n.onPrivacy()));
    private readonly monitorsId: number;
    private readonly mediaId: number;
    private readonly lyricsId: number;
    private readonly timerId: number;
    private readonly activitiesId: number;
    private readonly weatherId: number;
    private readonly calendarId: number;
    private readonly shelfId: number;
    private timerTickId = 0;
    private readonly watchId: number;
    private notches: MonitorNotch[] = [];
    private allMonitors: boolean;
    private cancellable = new Gio.Cancellable();
    private restoreClock: Restore | null = null;
    private restoreOsd: Restore | null = null;
    private capsLock: CapsLockWatcher | null = null;
    private restoreBanners: Restore | null = null;
    /** Puts the calendar back under its own clock, while the notch opened it. */
    private restoreMessageList: Restore | null = null;
    private readonly panel: PanelSource = {
        content: () => this.panelContent(),
        opened: () => this.weather.refresh(),
        openCalendar: () => this.openCalendar(),
        openNotifications: () => {
            this.restoreMessageList?.();
            this.restoreMessageList = openMessageList();
        },
        toggleFocus: () => this.onFocusShortcut(),
    };
    private readonly shelfSource: ShelfSource = {
        items: () => (this.settings.behavior.fileShelf ? this.shelf.items() : []),
        overRow: (notch, rect) => this.shelfCoordinator.overRow(notch, rect),
        rowGone: (notch) => this.shelfCoordinator.rowGone(notch),
    };
    /** The notification in a notch, watched so the notch closes when it goes away. */
    private shownNotification: { notification: TrayNotification; notch: MonitorNotch; destroyId: number } | null =
        null;

    constructor(extensionSettings: Gio.Settings, extensionPath: string) {
        this.shelfCoordinator = new ShelfCoordinator(`${extensionPath}/shelf-helper/main.js`, () => this.notches);
        this.settings = new SettingsClient(() => this.applySettings());
        this.allMonitors = this.settings.behavior.allMonitors;
        this.monitorsId = Main.layoutManager.connect('monitors-changed', () => this.buildNotches());
        this.mediaId = this.media.onChanged(() => this.notches.forEach((n) => n.onMedia()));
        this.lyricsId = this.lyrics.onChanged(() => this.notches.forEach((n) => n.onLyrics()));
        this.timerId = this.timer.onChanged(() => this.onTimer());
        this.activitiesId = this.activities.onChanged(() => this.notches.forEach((n) => n.onActivities()));
        this.weatherId = this.weather.onChanged(() => this.notches.forEach((n) => n.onPanelContent()));
        this.calendarId = this.calendar.onChanged(() => this.onCalendar());
        this.shelfId = this.shelf.onChanged(() => this.notches.forEach((n) => n.onShelf()));
        this.focusToggle = new FocusToggle({
            start: (phase) => this.timer.start(phase),
            pause: () => this.timer.pause(),
            resume: () => this.timer.resume(),
            stop: () => this.timer.stop(),
        });
        this.focusShortcut = new FocusShortcut(extensionSettings, () => this.onFocusShortcut());
        this.focusShortcut.set(this.settings.timer.shortcut);
        this.buildNotches();
        this.applyClockPosition();
        this.applyOsdSettings();
        this.applyNotificationSettings();
        this.onTimer();
        this.calendarAlarms.reschedule();
        this.shelfCoordinator.setEnabled(this.settings.behavior.fileShelf);
        this.watchId = watchDaemon(
            (connection) => this.onDaemonAppeared(connection),
            () => this.onDaemonVanished(),
        );
    }

    destroy(): void {
        unwatchDaemon(this.watchId);
        this.cancellable.cancel();
        this.shelfCoordinator.destroy();
        this.destroyNotches();
        this.media.disconnect(this.mediaId);
        this.lyrics.disconnect(this.lyricsId);
        this.timer.disconnect(this.timerId);
        this.activities.disconnect(this.activitiesId);
        this.weather.disconnect(this.weatherId);
        this.calendar.disconnect(this.calendarId);
        this.shelf.disconnect(this.shelfId);
        this.calendarAlarms.destroy();
        this.calendar.destroy();
        this.stopTimerTick();
        this.media.destroy();
        this.lyrics.destroy();
        this.timer.destroy();
        this.activities.destroy();
        this.weather.destroy();
        this.shelf.destroy();
        this.focusToggle.destroy();
        this.quietBanners.release();
        this.focusShortcut.destroy();
        this.privacy.destroy();
        this.devices.detach();
        this.settings.detach();
        Main.layoutManager.disconnect(this.monitorsId);
        this.restoreClock?.();
        this.restoreClock = null;
        this.restoreOsd?.();
        this.restoreOsd = null;
        this.capsLock?.destroy();
        this.capsLock = null;
        this.restoreBanners?.();
        this.restoreBanners = null;
        this.releaseNotification();
        this.restoreMessageList?.();
        this.restoreMessageList = null;
    }

    // Daemon

    private onDaemonAppeared(connection: Gio.DBusConnection): void {
        this.connect(connection, this.cancellable).catch((error: unknown) => {
            if (!isCancelled(error)) console.error('Nokta: cannot talk to noktad', error);
        });
    }

    private async connect(connection: Gio.DBusConnection, cancellable: Gio.Cancellable): Promise<void> {
        const version = await readApiVersion(connection, cancellable);
        if (version !== API_VERSION) {
            if (!warnedApiVersion) {
                console.warn(
                    `Nokta: noktad speaks API version ${version}, this extension needs ${API_VERSION}. ` +
                        'Update Nokta so the daemon and the extension match.',
                );
                warnedApiVersion = true;
            }
            return;
        }
        await Promise.all([
            this.settings.attach(connection, cancellable),
            this.media.attach(connection, cancellable),
            this.lyrics.attach(connection, cancellable),
            this.timer.attach(connection, cancellable),
            this.activities.attach(connection, cancellable),
            this.weather.attach(connection, cancellable),
            this.shelf.attach(connection, cancellable),
        ]);
        if (!cancellable.is_cancelled()) this.devices.attach(connection);
    }

    private onDaemonVanished(): void {
        this.cancellable.cancel();
        this.cancellable = new Gio.Cancellable();
        this.settings.detach();
        this.media.detach();
        this.lyrics.detach();
        this.timer.detach();
        this.activities.detach();
        this.weather.detach();
        this.shelf.detach();
        this.devices.detach();
    }

    // Focus timer

    /** Redraws the timer, and again when the shown second changes. */
    private onTimer(): void {
        this.stopTimerTick();
        const snapshot = this.timer.snapshot();
        const now = GLib.get_monotonic_time();
        this.focusToggle.update(snapshot, now, this.settings.timer);
        this.quietBanners.update(wantsQuiet(snapshot, this.settings.timer.quietNotifications));
        this.notches.forEach((n) => n.onTimer());
        const delay = msUntilNextSecond(snapshot, now);
        if (delay === null) return;
        this.timerTickId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, delay, () => {
            this.timerTickId = 0;
            this.onTimer();
            return GLib.SOURCE_REMOVE;
        });
    }

    private stopTimerTick(): void {
        if (this.timerTickId) GLib.source_remove(this.timerTickId);
        this.timerTickId = 0;
    }

    private onFocusShortcut(): void {
        if (shortcutAction(this.timer.snapshot()) === 'focus') this.timer.start('focus');
        else this.timer.stop();
    }

    private onTimerFinished(phase: string): void {
        const settings = this.settings.timer;
        const alert = finishedAlert(phase, breakAfterFocus(this.timer.snapshot(), settings));
        if (!alert) return;
        const content = { fraction: null, text: alert.title, detail: alert.detail, urgent: false };
        this.showOsd(-1, content, new Gio.ThemedIcon({ name: TIMER_ICON }), this.settings.behavior.alertDurationMs);
        if (settings.sound) global.display.get_sound_player().play_from_theme('complete', alert.title, null);
    }

    // Notches

    /** One notch per monitor, or only on the primary; called again when monitors change. */
    private buildNotches(): void {
        this.destroyNotches();
        const { monitors, primaryIndex } = Main.layoutManager;
        const sources = {
            settings: this.settings,
            media: this.media,
            lyrics: this.lyrics,
            timer: this.timer,
            activities: this.activities,
            privacy: this.privacy,
            panel: this.panel,
            shelf: this.shelfSource,
        };
        monitors.forEach((monitor, index) => {
            if (!this.allMonitors && index !== primaryIndex) return;
            const area = { x: monitor.x, y: monitor.y, width: monitor.width };
            this.notches.push(new MonitorNotch(index, area, sources));
        });
    }

    private destroyNotches(): void {
        for (const notch of this.notches) {
            this.shelfCoordinator.forget(notch);
            notch.destroy();
        }
        this.notches = [];
    }

    private applySettings(): void {
        if (this.settings.behavior.allMonitors !== this.allMonitors) {
            this.allMonitors = this.settings.behavior.allMonitors;
            this.buildNotches();
        } else {
            for (const notch of this.notches) notch.applySettings();
        }
        this.applyClockPosition();
        this.applyOsdSettings();
        this.applyNotificationSettings();
        this.focusShortcut.set(this.settings.timer.shortcut);
        this.onTimer();
        this.onCalendar();
        this.shelfCoordinator.setEnabled(this.settings.behavior.fileShelf);
    }

    // OSD

    /** The notch for a message, or null and the monitor for GNOME's popup when none can show it. */
    private routeMessage(requested: number): { notch: MonitorNotch | null; monitor: number } {
        const route = routeOsd({
            requested,
            focused: focusedMonitor(),
            primary: Main.layoutManager.primaryIndex,
            notches: this.notches.map((n) => n.monitorIndex),
        });
        const notch = this.notches.find((n) => n.monitorIndex === route.notch);
        // A fullscreen app hides the notch; the lock screen covers it.
        const shown = notch?.visible && !Main.sessionMode.isLocked;
        return { notch: shown ? notch : null, monitor: route.monitor };
    }

    /** Draws in the routed notch; returns the monitor for GNOME's popup when it cannot. */
    private showOsd(
        requested: number,
        content: OsdContent,
        icon: Gio.Icon | null,
        durationMs?: number,
    ): number | null {
        const { notch, monitor } = this.routeMessage(requested);
        if (!notch) return monitor;
        notch.showOsd(content, icon, durationMs);
        return null;
    }

    /** A device alert in the focused notch; skipped when that notch cannot show it. */
    private onDeviceAlert({ kind, name, percentage }: AlertSignal): void {
        const { deviceAlerts, alertDurationMs } = this.settings.behavior;
        const alert = deviceAlerts ? deviceAlert(kind, name, percentage) : null;
        if (!alert) return;
        const content = { fraction: null, text: alert.title, detail: alert.detail, urgent: alert.urgent };
        this.showOsd(-1, content, new Gio.ThemedIcon({ name: alert.icon }), alertDurationMs);
    }

    /** An activity ended: a check mark or a red cross in the focused notch. */
    private onActivityEnded({ title, success, message, elapsedUs }: EndedSignal): void {
        const { liveActivities, alertDurationMs } = this.settings.behavior;
        if (!liveActivities) return;
        const alert = endedAlert(title, success, message, elapsedUs);
        const content = { fraction: null, text: alert.title, detail: alert.detail, urgent: alert.urgent };
        this.showOsd(-1, content, new Gio.ThemedIcon({ name: alert.icon }), alertDurationMs);
    }

    private onOsdRequest(request: OsdRequest): number | null {
        return this.showOsd(
            request.monitorIndex,
            osdContent(request.level, request.maxLevel, request.label),
            request.icon,
        );
    }

    private applyOsdSettings(): void {
        const { replaceOsd, showCapsLock } = this.settings.behavior;
        if (replaceOsd && !this.restoreOsd) {
            this.restoreOsd = takeOverOsd({
                show: (request) => this.onOsdRequest(request),
                hideAll: () => this.notches.forEach((n) => n.hideOsd()),
                focusedMonitor,
            });
        } else if (!replaceOsd && this.restoreOsd) {
            this.restoreOsd();
            this.restoreOsd = null;
        }
        if (showCapsLock && !this.capsLock) {
            // GNOME has no Caps Lock popup to fall back to.
            this.capsLock = new CapsLockWatcher((on) => {
                this.showOsd(-1, capsLockContent(on), new Gio.ThemedIcon({ name: CAPS_LOCK_ICON }));
            });
        } else if (!showCapsLock && this.capsLock) {
            this.capsLock.destroy();
            this.capsLock = null;
        }
    }

    // Calendar

    /** The events changed, or the calendar settings. */
    private onCalendar(): void {
        this.notches.forEach((n) => n.onPanelContent());
        this.calendarAlarms.reschedule();
    }

    /** Timed events from now to the end of tomorrow; none while the calendar is off. */
    private calendarEvents(nowMs: number): CalendarEvent[] {
        return this.settings.calendar.enabled ? this.calendar.events(nowMs) : [];
    }

    private onCalendarAlarm(alarm: Alarm, nowMs: number): void {
        const alert = alarmAlert(alarm, nowMs, (ms) => this.formatTime(ms));
        if (!alert) return;
        const content = { fraction: null, text: alert.title, detail: alert.detail, urgent: alert.urgent };
        this.showOsd(-1, content, new Gio.ThemedIcon({ name: alert.icon }), this.settings.behavior.alertDurationMs);
    }

    /** A time like the notch's clock shows it. */
    private formatTime(ms: number): string {
        const use24h = uses24h(this.settings.behavior.clockFormat, this.interfaceSettings.get_string('clock-format'));
        return formatClock(new Date(ms), use24h);
    }

    /** The default calendar app, like GNOME's own event list opens it; else the date menu. */
    private openCalendar(): void {
        const apps = Gio.AppInfo.get_recommended_for_type('text/calendar');
        const preferred = Gio.AppInfo.get_default_for_type('text/calendar', false);
        const app = apps.find((a) => preferred && a.equal(preferred)) ?? apps[0];
        if (!app) {
            this.panel.openNotifications();
            return;
        }
        const context = global.create_app_launch_context(0, -1);
        if (app.get_id() === 'org.gnome.Evolution.desktop' && app instanceof Gio.DesktopAppInfo)
            app.launch_action('calendar', context);
        else app.launch([], context);
    }

    private panelEvent(): PanelContent['event'] {
        const now = Date.now();
        const event = nextEvent(this.calendarEvents(now), now);
        if (!event) return null;
        const time = eventTime(event.startMs, now, (ms) => this.formatTime(ms));
        return { title: event.title, when: `${time} · ${soonLabel(event.startMs, now)}` };
    }

    // The idle panel

    private panelContent(): PanelContent {
        return {
            date: GLib.DateTime.new_now_local().format('%A, %-d %B') ?? '',
            weather: this.weather.line(),
            event: this.panelEvent(),
            activities: this.panelActivities(),
            notifications: notificationsLabel(notificationCount()),
            focus: focusButtonLabel(this.timer.snapshot(), this.settings.timer.focusMinutes),
        };
    }

    private panelActivities(): PanelContent['activities'] {
        if (!this.settings.behavior.liveActivities) return [];
        const now = GLib.get_monotonic_time();
        return this.activities
            .list()
            .slice(0, MAX_PANEL_ACTIVITIES)
            .map((activity) => ({
                icon: activityIcon(activity.icon),
                title: activity.title,
                detail: activity.detail,
                fraction: activity.progress < 0 ? null : Math.min(activity.progress, 1),
                elapsed: formatElapsed(now - activity.startedUs),
            }));
    }

    // Notifications

    private applyNotificationSettings(): void {
        const { inNotch } = this.settings.notifications;
        if (inNotch && !this.restoreBanners) {
            this.restoreBanners = takeOverBanners((notification) => this.onBanner(notification));
        } else if (!inNotch && this.restoreBanners) {
            this.restoreBanners();
            this.restoreBanners = null;
        }
    }

    /** Shows a banner GNOME was about to show in the focused notch; false leaves it to GNOME. */
    private onBanner(notification: TrayNotification): boolean {
        const { inNotch, durationMs, showBody } = this.settings.notifications;
        const { notch } = this.routeMessage(-1);
        if (!notch || !takesBanner({ inNotch, urgency: notification.urgency, notchShown: true })) return false;
        const text = {
            title: notification.title ?? '',
            body: notification.body ?? '',
            app: notification.source?.title ?? '',
        };
        const { title, detail } = notificationLines(text, showBody);
        const icon = notification.gicon ?? notification.source?.icon ?? null;
        const shown = this.shownNotification;
        if (shown && (shown.notification !== notification || shown.notch !== notch)) {
            if (shown.notch !== notch) shown.notch.hideNotification();
            this.releaseNotification();
        }
        if (!this.shownNotification) {
            const destroyId = notification.connect('destroy', () => {
                notch.hideNotification();
                this.releaseNotification();
            });
            this.shownNotification = { notification, notch, destroyId };
        }
        notch.showNotification(title, detail, icon, durationMs, () => notification.activate());
        return true;
    }

    private releaseNotification(): void {
        const shown = this.shownNotification;
        if (!shown) return;
        this.shownNotification = null;
        shown.notification.disconnect(shown.destroyId);
    }

    // Shell

    private applyClockPosition(): void {
        const wanted = this.settings.behavior.moveClock;
        if (wanted && !this.restoreClock) {
            this.restoreClock = moveDateMenuRight();
        } else if (!wanted && this.restoreClock) {
            this.restoreClock();
            this.restoreClock = null;
        }
    }
}

export default class NoktaExtension extends Extension {
    private session: Session | null = null;

    override enable(): void {
        this.session = new Session(this.getSettings(), this.path);
    }

    override disable(): void {
        this.session?.destroy();
        this.session = null;
    }
}
