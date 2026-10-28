import type Clutter from 'gi://Clutter';
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
import { AudioOutputs, MediaClient } from './features/media/index.js';
import {
    bannerShape,
    isRecordingBanner,
    isScreenshotBanner,
    notificationCount,
    notificationLines,
    openMessageList,
    screenshotButtons,
    ScreenshotFiles,
    takeOverBanners,
    takesBanner,
    watchScreenshots,
    type ScreenshotButton,
    type TrayNotification,
} from './features/notifications/index.js';
import {
    InputSourceWatcher,
    LockKeysWatcher,
    lockKeyContent,
    osdContent,
    routeOsd,
    takeOverOsd,
    type OsdContent,
    type OsdRequest,
} from './features/osd/index.js';
import {
    Caffeine,
    MAX_PANEL_ACTIVITIES,
    type PanelContent,
    type QuickToggle,
    sessionInhibitor,
} from './features/panel/index.js';
import {
    CallMonitor,
    callDetail,
    msUntilElapsedSecond,
    PrivacyMonitor,
    ScreenRecording,
} from './features/privacy/index.js';
import { SettingsClient } from './features/settings/index.js';
import { ShelfClient, ShelfCoordinator } from './features/shelf/index.js';
import { ClipboardClient, ClipboardWatcher, copyToClipboard } from './features/clipboard/index.js';
import {
    breakAfterFocus,
    clockColor,
    clockDetail,
    clockDoneAlert,
    clockText,
    clockTitle,
    finishedAlert,
    FocusShortcut,
    FocusToggle,
    gnomeBanners,
    msUntilClockChange,
    msUntilNextSecond,
    QuietBanners,
    shortcutAction,
    TimerClient,
    wantsQuiet,
} from './features/timer/index.js';
import { WeatherClient } from './features/weather/index.js';
import { MonitorNotch, type ClipboardSource, type PanelSource, type ShelfSource } from './monitor-notch.js';
import { API_VERSION } from './shared/contracts.js';
import { readApiVersion, unwatchDaemon, watchDaemon } from './shared/dbus.js';
import { formatClock, formatDuration, uses24h } from './shared/logic/format.js';
import { moveDateMenuRight, type Restore } from './shared/topbar.js';

const KEYBOARD_ICON = 'input-keyboard-symbolic';
const TIMER_ICON = 'alarm-symbolic';
/** The icon beside a countdown or stopwatch in home and its alert; an alarm has TIMER_ICON. */
const CLOCK_ICON = 'nokta-timer-symbolic.svg';
/** A finished countdown or alarm stays up this many times the alert duration. */
const CLOCK_ALERT_FACTOR = 2;

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
    private readonly outputs = new AudioOutputs();
    private readonly lyrics = new LyricsClient();
    private readonly devices = new DevicesClient((alert) => this.onDeviceAlert(alert));
    private readonly timer = new TimerClient(
        (phase) => this.onTimerFinished(phase),
        (kind, label) => this.onClockDone(kind, label),
    );
    private readonly activities = new ActivitiesClient((ended) => this.onActivityEnded(ended));
    private readonly weather = new WeatherClient();
    private readonly shelf = new ShelfClient();
    private readonly shelfCoordinator: ShelfCoordinator;
    private readonly clipboard = new ClipboardClient();
    private readonly clipboardWatcher: ClipboardWatcher;
    private readonly calendar = new CalendarSource();
    private readonly calendarAlarms = new CalendarAlarms(
        (nowMs) => this.calendarEvents(nowMs),
        () => this.settings.calendar.reminderMinutes,
        (alarm, nowMs) => this.onCalendarAlarm(alarm, nowMs),
    );
    private readonly interfaceSettings = new Gio.Settings({ schema_id: 'org.gnome.desktop.interface' });
    /** Watched for the Do Not Disturb toggle; QuietBanners writes it. */
    private readonly notificationSettings = new Gio.Settings({ schema_id: 'org.gnome.desktop.notifications' });
    private readonly togglesIds: Array<[Gio.Settings, number]>;
    private readonly caffeine = new Caffeine(sessionInhibitor(), () => this.notches.forEach((n) => n.onPanelContent()));
    private readonly focusToggle: FocusToggle;
    private readonly quietBanners = new QuietBanners(gnomeBanners());
    private readonly focusShortcut: FocusShortcut;
    private readonly call = new CallMonitor();
    private readonly recording = new ScreenRecording();
    private readonly privacy = new PrivacyMonitor(() => this.onPrivacy());
    private readonly monitorsId: number;
    private readonly mediaId: number;
    private readonly outputsId: number;
    private readonly lyricsId: number;
    private readonly timerId: number;
    private readonly activitiesId: number;
    private readonly weatherId: number;
    private readonly calendarId: number;
    private readonly shelfId: number;
    private readonly clipboardId: number;
    private readonly callId: number;
    private readonly recordingId: number;
    private timerTickId = 0;
    private liveTickId = 0;
    private readonly watchId: number;
    private notches: MonitorNotch[] = [];
    private allMonitors: boolean;
    private cancellable = new Gio.Cancellable();
    private restoreClock: Restore | null = null;
    private restoreOsd: Restore | null = null;
    private lockKeys: LockKeysWatcher | null = null;
    private inputSources: InputSourceWatcher | null = null;
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
        openSettings: () => this.openPreferences(),
        toggle: (which) => this.toggle(which),
        setDoNotDisturb: (on) => this.quietBanners.setDoNotDisturb(on),
        iconsDir: '',
    };
    private readonly shelfSource: ShelfSource = {
        items: () => (this.settings.behavior.fileShelf ? this.shelf.items() : []),
        overRow: (notch, rect) => this.shelfCoordinator.overRow(notch, rect),
        rowGone: (notch) => this.shelfCoordinator.rowGone(notch),
        clear: () => this.shelf.clear(),
    };
    private readonly clipboardSource: ClipboardSource = {
        enabled: () => this.settings.clipboard.enabled && this.clipboard.connected,
        entries: () => (this.settings.clipboard.enabled ? this.clipboard.entries() : []),
        paused: () => this.clipboard.paused,
        copy: (id) => {
            this.clipboard
                .get(id)
                .then((content) => content && copyToClipboard(content))
                .catch((error: unknown) => console.error('Nokta: cannot copy from the clipboard history', error));
        },
        pin: (id, pinned) => this.clipboard.pin(id, pinned),
        remove: (id) => this.clipboard.remove(id),
        clear: () => this.clipboard.clear(),
        setPaused: (paused) => this.clipboard.setPaused(paused),
    };
    /**
     * The notification in a notch, watched so the notch closes when it goes
     * away, and the file of a screenshot preview once it is known.
     */
    private shownNotification: {
        notification: TrayNotification;
        notch: MonitorNotch;
        destroyId: number;
        file: string | null;
    } | null = null;
    private readonly screenshotFiles = new ScreenshotFiles();
    private readonly unwatchScreenshots: Restore | null;

    constructor(
        extensionSettings: Gio.Settings,
        extensionPath: string,
        private readonly openPreferences: () => void,
    ) {
        this.panel.iconsDir = `${extensionPath}/icons`;
        const refreshPanel = () => this.notches.forEach((n) => n.onPanelContent());
        this.togglesIds = [
            [this.notificationSettings, this.notificationSettings.connect('changed::show-banners', refreshPanel)],
            [this.interfaceSettings, this.interfaceSettings.connect('changed::color-scheme', refreshPanel)],
        ];
        this.shelfCoordinator = new ShelfCoordinator(`${extensionPath}/shelf-helper/main.js`, () => this.notches);
        this.settings = new SettingsClient(() => this.applySettings());
        this.allMonitors = this.settings.behavior.allMonitors;
        this.monitorsId = Main.layoutManager.connect('monitors-changed', () => this.buildNotches());
        this.mediaId = this.media.onChanged(() => this.notches.forEach((n) => n.onMedia()));
        this.outputsId = this.outputs.onChanged(() => this.notches.forEach((n) => n.onOutputs()));
        this.lyricsId = this.lyrics.onChanged(() => this.notches.forEach((n) => n.onLyrics()));
        this.timerId = this.timer.onChanged(() => this.onTimer());
        this.activitiesId = this.activities.onChanged(() => this.notches.forEach((n) => n.onActivities()));
        this.weatherId = this.weather.onChanged(() => this.notches.forEach((n) => n.onPanelContent()));
        this.calendarId = this.calendar.onChanged(() => this.onCalendar());
        this.shelfId = this.shelf.onChanged(() => this.notches.forEach((n) => n.onShelf()));
        this.clipboardId = this.clipboard.onChanged(() => this.notches.forEach((n) => n.onClipboard()));
        this.callId = this.call.onChanged(() => this.onLive());
        this.recordingId = this.recording.onChanged(() => this.onLive());
        this.call.setMicrophone(this.privacy.state().microphone);
        this.clipboardWatcher = new ClipboardWatcher(this.clipboard, () => this.settings.clipboard.enabled);
        this.unwatchScreenshots = watchScreenshots((uri) => this.onScreenshotSaved(uri));
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
        this.onLive();
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
        this.outputs.disconnect(this.outputsId);
        this.outputs.destroy();
        this.lyrics.disconnect(this.lyricsId);
        this.timer.disconnect(this.timerId);
        this.activities.disconnect(this.activitiesId);
        this.weather.disconnect(this.weatherId);
        this.calendar.disconnect(this.calendarId);
        this.shelf.disconnect(this.shelfId);
        this.clipboard.disconnect(this.clipboardId);
        this.clipboardWatcher.destroy();
        this.calendarAlarms.destroy();
        this.calendar.destroy();
        this.stopTimerTick();
        this.media.destroy();
        this.lyrics.destroy();
        this.timer.destroy();
        this.activities.destroy();
        this.weather.destroy();
        this.shelf.destroy();
        this.clipboard.destroy();
        this.focusToggle.destroy();
        this.quietBanners.release();
        this.caffeine.release();
        for (const [settings, id] of this.togglesIds) settings.disconnect(id);
        this.focusShortcut.destroy();
        this.privacy.destroy();
        this.stopLiveTick();
        this.call.disconnect(this.callId);
        this.call.destroy();
        this.recording.disconnect(this.recordingId);
        this.recording.destroy();
        this.devices.detach();
        this.settings.detach();
        Main.layoutManager.disconnect(this.monitorsId);
        this.restoreClock?.();
        this.restoreClock = null;
        this.restoreOsd?.();
        this.restoreOsd = null;
        this.lockKeys?.destroy();
        this.lockKeys = null;
        this.inputSources?.destroy();
        this.inputSources = null;
        this.restoreBanners?.();
        this.restoreBanners = null;
        this.unwatchScreenshots?.();
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
            this.clipboard.attach(connection, cancellable),
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
        this.clipboard.detach();
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
        const delays = [msUntilNextSecond(snapshot, now), msUntilClockChange(this.timer.clocks(), now)];
        const waits = delays.filter((d): d is number => d !== null);
        if (waits.length === 0) return;
        const delay = Math.min(...waits);
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

    // Calls and screen recordings

    private onPrivacy(): void {
        this.call.setMicrophone(this.privacy.state().microphone);
        this.notches.forEach((n) => n.onPrivacy());
    }

    /** Redraws the call and the screen recording, and again when a shown second changes. */
    private onLive(): void {
        this.stopLiveTick();
        this.notches.forEach((n) => {
            n.onCall();
            n.onRecording();
        });
        const now = GLib.get_monotonic_time();
        const starts = [this.shownCall()?.startedUs, this.recording.since()];
        const delays = starts.filter((s): s is number => typeof s === 'number').map((s) => msUntilElapsedSecond(s, now));
        if (delays.length === 0) return;
        const delay = Math.min(...delays);
        this.liveTickId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, delay, () => {
            this.liveTickId = 0;
            this.onLive();
            return GLib.SOURCE_REMOVE;
        });
    }

    private stopLiveTick(): void {
        if (this.liveTickId) GLib.source_remove(this.liveTickId);
        this.liveTickId = 0;
    }

    private shownCall(): ReturnType<CallMonitor['call']> {
        return this.settings.behavior.callIndicator ? this.call.call() : null;
    }

    private panelRecording(): PanelContent['recording'] {
        const since = this.recording.since();
        return since === null ? null : formatDuration(GLib.get_monotonic_time() - since);
    }

    private panelCall(): PanelContent['call'] {
        const call = this.shownCall();
        if (!call) return null;
        const detail = callDetail(call.startedUs, GLib.get_monotonic_time(), call.muted);
        return { icon: call.icon, title: call.title, detail, muted: call.muted };
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

    /** A countdown ran out or an alarm went off. */
    private onClockDone(kind: string, label: string): void {
        const alert = clockDoneAlert(kind, label, this.formatTime(Date.now()));
        if (!alert) return;
        const content = { fraction: null, text: alert.title, detail: alert.detail, urgent: false };
        const icon = kind === 'alarm' ? new Gio.ThemedIcon({ name: TIMER_ICON }) : this.extensionIcon(CLOCK_ICON);
        this.showOsd(-1, content, icon, CLOCK_ALERT_FACTOR * this.settings.behavior.alertDurationMs);
        if (this.settings.timer.sound)
            global.display.get_sound_player().play_from_theme('alarm-clock-elapsed', alert.title, null);
    }

    /** An icon from the extension's icons folder. */
    private extensionIcon(name: string): Gio.Icon {
        return new Gio.FileIcon({ file: Gio.File.new_for_path(`${this.panel.iconsDir}/${name}`) });
    }

    // Notches

    /** One notch per monitor, or only on the primary; called again when monitors change. */
    private buildNotches(): void {
        this.destroyNotches();
        const { monitors, primaryIndex } = Main.layoutManager;
        const sources = {
            settings: this.settings,
            media: this.media,
            outputs: this.outputs,
            lyrics: this.lyrics,
            timer: this.timer,
            activities: this.activities,
            privacy: this.privacy,
            call: this.call,
            recording: this.recording,
            panel: this.panel,
            shelf: this.shelfSource,
            clipboard: this.clipboardSource,
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
        this.onLive();
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
        const iconNames = request.icon instanceof Gio.ThemedIcon ? request.icon.get_names() : [];
        return this.showOsd(
            request.monitorIndex,
            osdContent(request.level, request.maxLevel, request.label, iconNames),
            request.icon,
        );
    }

    private applyOsdSettings(): void {
        const { replaceOsd, showCapsLock, showNumLock, showInputSource } = this.settings.behavior;
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
        const lockKeys = showCapsLock || showNumLock;
        if (lockKeys && !this.lockKeys) {
            // GNOME has no Caps Lock or Num Lock popup to fall back to.
            this.lockKeys = new LockKeysWatcher((key, on) => {
                const { showCapsLock: caps, showNumLock: num } = this.settings.behavior;
                if (key === 'Caps Lock' ? !caps : !num) return;
                this.showOsd(-1, lockKeyContent(key, on), new Gio.ThemedIcon({ name: KEYBOARD_ICON }));
            });
        } else if (!lockKeys && this.lockKeys) {
            this.lockKeys.destroy();
            this.lockKeys = null;
        }
        if (showInputSource && !this.inputSources) {
            // GNOME's own switcher shows only while Super is held, so the notch shows every switch.
            this.inputSources = new InputSourceWatcher((name) => {
                this.showOsd(-1, { fraction: null, text: name }, new Gio.ThemedIcon({ name: KEYBOARD_ICON }));
            });
        } else if (!showInputSource && this.inputSources) {
            this.inputSources.destroy();
            this.inputSources = null;
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
            recording: this.panelRecording(),
            call: this.panelCall(),
            activities: this.panelActivities(),
            notificationCount: notificationCount(),
            focusActive: this.timer.snapshot().state !== 'idle',
            clocks: this.panelClocks(),
            toggles: {
                doNotDisturb: this.quietBanners.doNotDisturb,
                caffeine: this.caffeine.on,
                dark: this.interfaceSettings.get_string('color-scheme') === 'prefer-dark',
            },
            player: this.media.snapshot().available,
            clipboard: this.clipboardSource.enabled(),
        };
    }

    /** A quick toggle in home was clicked. */
    private toggle(which: QuickToggle): void {
        const { toggles } = this.panelContent();
        if (which === 'doNotDisturb') this.quietBanners.setDoNotDisturb(!toggles.doNotDisturb);
        else if (which === 'caffeine') this.caffeine.set(!toggles.caffeine);
        else this.interfaceSettings.set_string('color-scheme', toggles.dark ? 'default' : 'prefer-dark');
    }

    private panelClocks(): PanelContent['clocks'] {
        const now = GLib.get_monotonic_time();
        return this.timer.clocks().map((clock) => ({
            id: clock.id,
            icon: clock.kind === 'alarm' ? TIMER_ICON : `file:${CLOCK_ICON}`,
            color: clockColor(clock.kind),
            title: clockTitle(clock),
            detail: clockDetail(clock, clock.alarmUnixUs ? this.formatTime(clock.alarmUnixUs / 1000) : ''),
            time: clockText(clock, now),
            running: clock.running,
            canPause: clock.kind !== 'alarm',
        }));
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
        const { screenshotPreview } = this.settings.behavior;
        const shape = bannerShape(notification);
        const screenshot = screenshotPreview && isScreenshotBanner(shape);
        const recording = screenshotPreview && isRecordingBanner(shape, (notification.actions?.length ?? 0) > 0);
        if (!this.shownNotification) {
            const destroyId = notification.connect('destroy', () => {
                notch.hideNotification();
                this.releaseNotification();
            });
            let file: string | null = null;
            if (screenshot) file = this.screenshotFiles.previewed(Date.now());
            else if (recording) file = this.recording.fileUri();
            this.shownNotification = { notification, notch, destroyId, file };
        }
        if (screenshot || recording) {
            // The image GNOME made for the notification is a Clutter.Content.
            const image = screenshot ? (notification.gicon as unknown as Clutter.Content) : null;
            const press = (button: ScreenshotButton) => this.onScreenshotPress(notification, button);
            notch.showScreenshot(image, title, this.screenshotButtons(), durationMs, press);
        } else {
            notch.showNotification(title, detail, icon, durationMs, () => notification.activate());
        }
        return true;
    }

    /** The buttons of the screenshot preview that shows. */
    private screenshotButtons(): ScreenshotButton[] {
        const shown = this.shownNotification;
        return screenshotButtons({
            saved: (shown?.notification.actions?.length ?? 0) > 0,
            file: !!shown?.file,
            shelf: this.settings.behavior.fileShelf,
        });
    }

    /** GNOME's screenshot UI saved a file: the preview of it can now keep it on the shelf. */
    private onScreenshotSaved(uri: string): void {
        const shown = this.shownNotification;
        if (!this.screenshotFiles.saved(uri, Date.now()) || !shown) return;
        shown.file = uri;
        shown.notch.setScreenshotButtons(this.screenshotButtons());
    }

    private onScreenshotPress(notification: TrayNotification, button: ScreenshotButton): void {
        const file = this.shownNotification?.notification === notification ? this.shownNotification.file : null;
        // GNOME opens the file and shows it in Files, and then removes its notification.
        if (button === 'open') notification.activate();
        else if (button === 'files') notification.actions?.[0]?.activate();
        else if (file) this.shelf.add([file]);
    }

    private releaseNotification(): void {
        const shown = this.shownNotification;
        if (!shown) return;
        this.shownNotification = null;
        this.screenshotFiles.ended();
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
        this.session = new Session(this.getSettings(), this.path, () => this.openPreferences());
    }

    override disable(): void {
        this.session?.destroy();
        this.session = null;
    }
}
