import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import { deviceAlert, DevicesClient, type AlertSignal } from './features/devices/index.js';
import { LyricsClient } from './features/lyrics/index.js';
import { MediaClient } from './features/media/index.js';
import {
    CapsLockWatcher,
    capsLockContent,
    osdContent,
    routeOsd,
    takeOverOsd,
    type OsdContent,
    type OsdRequest,
} from './features/osd/index.js';
import { SettingsClient } from './features/settings/index.js';
import {
    breakAfterFocus,
    finishedAlert,
    FocusShortcut,
    FocusToggle,
    gnomeBanners,
    msUntilNextSecond,
    QuietBanners,
    shortcutAction,
    TimerClient,
    wantsQuiet,
} from './features/timer/index.js';
import { MonitorNotch } from './monitor-notch.js';
import { API_VERSION } from './shared/contracts.js';
import { readApiVersion, unwatchDaemon, watchDaemon } from './shared/dbus.js';
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
    private readonly focusToggle: FocusToggle;
    private readonly quietBanners = new QuietBanners(gnomeBanners());
    private readonly focusShortcut: FocusShortcut;
    private readonly monitorsId: number;
    private readonly mediaId: number;
    private readonly lyricsId: number;
    private readonly timerId: number;
    private timerTickId = 0;
    private readonly watchId: number;
    private notches: MonitorNotch[] = [];
    private allMonitors: boolean;
    private cancellable = new Gio.Cancellable();
    private restoreClock: Restore | null = null;
    private restoreOsd: Restore | null = null;
    private capsLock: CapsLockWatcher | null = null;

    constructor(extensionSettings: Gio.Settings) {
        this.settings = new SettingsClient(() => this.applySettings());
        this.allMonitors = this.settings.behavior.allMonitors;
        this.monitorsId = Main.layoutManager.connect('monitors-changed', () => this.buildNotches());
        this.mediaId = this.media.onChanged(() => this.notches.forEach((n) => n.onMedia()));
        this.lyricsId = this.lyrics.onChanged(() => this.notches.forEach((n) => n.onLyrics()));
        this.timerId = this.timer.onChanged(() => this.onTimer());
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
        this.onTimer();
        this.watchId = watchDaemon(
            (connection) => this.onDaemonAppeared(connection),
            () => this.onDaemonVanished(),
        );
    }

    destroy(): void {
        unwatchDaemon(this.watchId);
        this.cancellable.cancel();
        this.destroyNotches();
        this.media.disconnect(this.mediaId);
        this.lyrics.disconnect(this.lyricsId);
        this.timer.disconnect(this.timerId);
        this.stopTimerTick();
        this.media.destroy();
        this.lyrics.destroy();
        this.timer.destroy();
        this.focusToggle.destroy();
        this.quietBanners.release();
        this.focusShortcut.destroy();
        this.devices.detach();
        this.settings.detach();
        Main.layoutManager.disconnect(this.monitorsId);
        this.restoreClock?.();
        this.restoreClock = null;
        this.restoreOsd?.();
        this.restoreOsd = null;
        this.capsLock?.destroy();
        this.capsLock = null;
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
        this.devices.detach();
    }

    // Focus timer (focus timer spec, section 6)

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
        const sources = { settings: this.settings, media: this.media, lyrics: this.lyrics, timer: this.timer };
        monitors.forEach((monitor, index) => {
            if (!this.allMonitors && index !== primaryIndex) return;
            const area = { x: monitor.x, y: monitor.y, width: monitor.width };
            this.notches.push(new MonitorNotch(index, area, sources));
        });
    }

    private destroyNotches(): void {
        for (const notch of this.notches) notch.destroy();
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
        this.focusShortcut.set(this.settings.timer.shortcut);
        this.onTimer();
    }

    // OSD (multi-monitor spec, section 3)

    /** Draws in the routed notch; returns the monitor for GNOME's popup when it cannot. */
    private showOsd(
        requested: number,
        content: OsdContent,
        icon: Gio.Icon | null,
        durationMs?: number,
    ): number | null {
        const route = routeOsd({
            requested,
            focused: focusedMonitor(),
            primary: Main.layoutManager.primaryIndex,
            notches: this.notches.map((n) => n.monitorIndex),
        });
        const notch = this.notches.find((n) => n.monitorIndex === route.notch);
        // A fullscreen app hides the notch; the lock screen covers it.
        if (!notch?.visible || Main.sessionMode.isLocked) return route.monitor;
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
        this.session = new Session(this.getSettings());
    }

    override disable(): void {
        this.session?.destroy();
        this.session = null;
    }
}
