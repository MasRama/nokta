import { deviceAlert, isBatteryWarning } from '@ext/features/devices/logic/alert.js';
import { batteryLevel } from '@ext/features/devices/logic/battery.js';
import { lockKeyContent, osdContent, type OsdContent } from '@ext/features/osd/logic/content.js';
import type { Behavior } from '@ext/features/settings/logic/parse.js';
import { alertMotion, type AlertMotion } from '@ext/shared/logic/alert-motion.js';
import type { AlertTone } from '@ext/shared/logic/glow.js';
import { TONES } from '@ext/shared/logic/tones.js';

import type { Bridge } from './bridge/bridge.js';

/** What the notch shows for an OSD key or an alert. */
export interface OsdRequest {
    content: OsdContent;
    /** Nokta's icon name, or a GNOME one it draws. */
    icon: string;
    /** Replaces osd_duration_ms; alerts take alert_duration_ms. */
    durationMs?: number;
    /** Set for an alert, which kicks the notch and glows; a key does not. */
    tone?: AlertTone;
    motion?: AlertMotion;
    /** A battery running out, which may show over a fullscreen app. */
    battery?: boolean;
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
    switch (kind) {
        case 'volume':
            return behavior.replaceOsd ? { content: osdContent(level, 1, null), icon: volumeIcon(level) } : null;
        case 'muted':
            return behavior.replaceOsd
                ? { content: osdContent(null, null, null, ['audio-volume-muted-symbolic']), icon: volumeIcon(0) }
                : null;
        case 'brightness':
            return behavior.replaceOsd
                ? { content: osdContent(level, 1, null), icon: 'display-brightness-symbolic' }
                : null;
        case 'caps-lock':
            return behavior.showCapsLock ? { content: lockKeyContent('Caps Lock', level > 0), icon: KEYBOARD } : null;
        case 'num-lock':
            return behavior.showNumLock ? { content: lockKeyContent('Num Lock', level > 0), icon: KEYBOARD } : null;
        case 'layout':
            return behavior.showInputSource && name ? { content: { fraction: null, text: name }, icon: KEYBOARD } : null;
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
        durationMs: behavior.alertDurationMs,
        tone: alert.urgent ? 'urgent' : charged ? 'success' : { color: TONES.device },
        motion: alertMotion(kind, motions),
        battery: isBatteryWarning(kind),
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
