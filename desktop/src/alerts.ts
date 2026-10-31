import { endedAlert } from '@ext/features/activities/logic/activities.js';
import type { EventAlert } from '@ext/features/calendar/logic/events.js';
import { deviceAlert, isBatteryWarning } from '@ext/features/devices/logic/alert.js';
import { batteryLevel } from '@ext/features/devices/logic/battery.js';
import { lockKeyContent, osdContent, type OsdContent } from '@ext/features/osd/logic/content.js';
import type { Behavior, SystemSettings, TimerSettings } from '@ext/features/settings/logic/parse.js';
import { memoryAlert } from '@ext/features/system/logic/format.js';
import { clockColor, clockDoneAlert } from '@ext/features/timer/logic/clocks.js';
import { breakAfterFocus, finishedAlert, phaseColor, type TimerSnapshot } from '@ext/features/timer/logic/timer.js';
import { alertMotion, type AlertMotion } from '@ext/shared/logic/alert-motion.js';
import type { AlertKind } from '@ext/shared/logic/fullscreen.js';
import type { AlertTone } from '@ext/shared/logic/glow.js';
import { TONES } from '@ext/shared/logic/tones.js';

import type { Ended } from './activities.js';
import type { Bridge } from './bridge/bridge.js';

/** What the notch shows for an OSD key or an alert. */
export interface OsdRequest {
    content: OsdContent;
    /** What it is, for whether it shows over a fullscreen app. */
    kind: AlertKind;
    /** Nokta's icon name, or a GNOME one it draws. */
    icon: string;
    /** Replaces osd_duration_ms; alerts take alert_duration_ms. */
    durationMs?: number;
    /** Set for an alert, which kicks the notch and glows; a key does not. */
    tone?: AlertTone;
    motion?: AlertMotion;
}

const KEYBOARD = 'input-keyboard-symbolic';

/** GNOME's volume icon for `level`, as its media keys pick it. */
function volumeIcon(level: number): string {
    if (level <= 0) return 'audio-volume-muted-symbolic';
    if (level < 1 / 3) return 'audio-volume-low-symbolic';
    if (level < 2 / 3) return 'audio-volume-medium-symbolic';
    return 'audio-volume-high-symbolic';
}

/**
 * The OSD for one `Osd1.Show(kind, level, name)`: what the app hears from
 * Windows' keys in place of GNOME's osdWindowManager. `kind` is `volume`,
 * `muted` or `brightness` (`level` 0 to 1), `caps-lock` or `num-lock`
 * (`level` 1 on, 0 off) or `layout` (`name` the new one). Null when the
 * settings leave it to Windows or turn it off, or for a kind not known.
 */
export function osdRequest(kind: string, level: number, name: string, behavior: Behavior): OsdRequest | null {
    const request = (content: OsdContent, icon: string): OsdRequest => ({ content, icon, kind: 'osd' });
    switch (kind) {
        case 'volume':
            return behavior.replaceOsd ? request(osdContent(level, 1, null), volumeIcon(level)) : null;
        case 'muted':
            return behavior.replaceOsd
                ? request(osdContent(null, null, null, ['audio-volume-muted-symbolic']), volumeIcon(0))
                : null;
        case 'brightness':
            return behavior.replaceOsd ? request(osdContent(level, 1, null), 'display-brightness-symbolic') : null;
        case 'caps-lock':
            return behavior.showCapsLock ? request(lockKeyContent('Caps Lock', level > 0), KEYBOARD) : null;
        case 'num-lock':
            return behavior.showNumLock ? request(lockKeyContent('Num Lock', level > 0), KEYBOARD) : null;
        case 'layout':
            return behavior.showInputSource && name ? request({ fraction: null, text: name }, KEYBOARD) : null;
        default:
            return null;
    }
}

/** The alert for one `Devices1.Alert(kind, name, percentage)`, as the extension's. */
export function deviceRequest(
    kind: string,
    name: string,
    percentage: number,
    behavior: Behavior,
    motions: boolean,
): OsdRequest | null {
    const alert = behavior.deviceAlerts ? deviceAlert(kind, name, percentage) : null;
    if (!alert) return null;
    const charged = kind === 'charger-plugged' || kind === 'battery-full';
    return {
        content: {
            fraction: null,
            text: alert.title,
            detail: alert.detail,
            urgent: alert.urgent,
            battery: batteryLevel(percentage),
        },
        icon: alert.icon,
        kind: isBatteryWarning(kind) ? 'battery' : 'device',
        durationMs: behavior.alertDurationMs,
        tone: alert.urgent ? 'urgent' : charged ? 'success' : { color: TONES.device },
        motion: alertMotion(kind, motions),
    };
}

/** The timer's icon, and a countdown's, as the extension's. */
export const TIMER_ICON = 'alarm-symbolic';
export const CLOCK_ICON = 'nokta-timer';
/** A countdown or an alarm stays this many times an alert's time. */
const CLOCK_ALERT_FACTOR = 2;

/** The alert for `Timer1.Finished(phase)`, with the break that follows a focus session. */
export function finishedRequest(
    phase: string,
    timer: TimerSnapshot,
    settings: TimerSettings,
    behavior: Behavior,
    motions: boolean,
): OsdRequest | null {
    const alert = finishedAlert(phase, breakAfterFocus(timer, settings));
    if (!alert) return null;
    return {
        content: { fraction: null, text: alert.title, detail: alert.detail, urgent: false },
        icon: TIMER_ICON,
        kind: 'focus',
        durationMs: behavior.alertDurationMs,
        tone: { color: phaseColor(phase === 'break' ? 'break' : 'focus') },
        motion: alertMotion('timer-done', motions),
    };
}

/** The alert for `Timer1.ClockDone(id, kind, label)`; `time` is the local time now. */
export function clockDoneRequest(
    kind: string,
    label: string,
    time: string,
    behavior: Behavior,
    motions: boolean,
): OsdRequest | null {
    const alert = clockDoneAlert(kind, label, time);
    if (!alert) return null;
    return {
        content: { fraction: null, text: alert.title, detail: alert.detail, urgent: false },
        icon: kind === 'alarm' ? TIMER_ICON : CLOCK_ICON,
        kind: 'clock',
        durationMs: CLOCK_ALERT_FACTOR * behavior.alertDurationMs,
        tone: { color: clockColor(kind === 'alarm' ? 'alarm' : 'countdown') },
        motion: alertMotion('clock-done', motions),
    };
}

/** A calendar reminder or start, in the calendar's tone, as the extension shows one without a meeting link. */
export function calendarRequest(alert: EventAlert, behavior: Behavior, motions: boolean): OsdRequest {
    return {
        content: { fraction: null, text: alert.title, detail: alert.detail, urgent: alert.urgent },
        icon: alert.icon,
        kind: 'calendar',
        durationMs: behavior.alertDurationMs,
        tone: alert.urgent ? 'urgent' : { color: TONES.calendar },
        motion: alertMotion('calendar', motions),
    };
}

/** The alert for `Activities1.Ended`: a check mark, or a red cross that shakes the notch. */
export function endedRequest(ended: Ended, behavior: Behavior, motions: boolean): OsdRequest | null {
    if (!behavior.liveActivities) return null;
    const { success } = ended;
    const alert = endedAlert(ended.title, success, ended.message, ended.elapsedUs);
    return {
        content: { fraction: null, text: alert.title, detail: alert.detail, urgent: alert.urgent },
        icon: alert.icon,
        kind: 'activity',
        durationMs: behavior.alertDurationMs,
        tone: success ? 'success' : 'urgent',
        motion: alertMotion(success ? 'activity-done' : 'activity-failed', motions),
    };
}

/** Follows `Osd1.Show` and `Devices1.Alert` and hands what to show to `show`. */
export class Alerts {
    private stops: Array<() => void> = [];

    constructor(
        private readonly bridge: Bridge,
        private readonly settings: () => { behavior: Behavior; motions: boolean },
        private readonly show: (request: OsdRequest) => void,
    ) {}

    attach(): void {
        this.detach();
        const number = (value: unknown): number => (typeof value === 'number' ? value : -1);
        const text = (value: unknown): string => (typeof value === 'string' ? value : '');
        this.stops = [
            this.bridge.onSignal('Osd1', 'Show', (kind, level, name) => {
                const request = osdRequest(text(kind), number(level), text(name), this.settings().behavior);
                if (request) this.show(request);
            }),
            this.bridge.onSignal('Devices1', 'Alert', (kind, name, percentage) => {
                const { behavior, motions } = this.settings();
                const request = deviceRequest(text(kind), text(name), number(percentage), behavior, motions);
                if (request) this.show(request);
            }),
        ];
    }

    detach(): void {
        this.stops.forEach((stop) => stop());
        this.stops = [];
    }
}

/** The alert for `System1.MemoryLow`, under `[system] memory_alert`. */
export function memoryLowRequest(
    used: number,
    total: number,
    app: string,
    system: SystemSettings,
    behavior: Behavior,
    motions: boolean,
): OsdRequest | null {
    if (!system.memoryAlert || total <= 0) return null;
    const { title, detail } = memoryAlert(used, total, app);
    return {
        content: { fraction: null, text: title, detail, urgent: true },
        icon: 'nokta-system',
        kind: 'memory',
        durationMs: behavior.alertDurationMs,
        tone: 'urgent',
        motion: alertMotion('memory-low', motions),
    };
}
