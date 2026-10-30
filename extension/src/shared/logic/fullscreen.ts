/**
 * Alerts over a fullscreen app. The notch hides while its monitor shows a
 * fullscreen window and comes back only for an alert that
 * `[behavior] fullscreen_alerts` lets through, until that alert ends.
 */

/** The values of `[behavior] fullscreen_alerts`. */
export const FULLSCREEN_ALERTS = ['none', 'important', 'all'] as const;
export type FullscreenAlerts = (typeof FULLSCREEN_ALERTS)[number];

/**
 * What the notch is about to show. `battery` is an urgent device alert
 * (battery low or critical), `device` every other one; `focus` a focus
 * session or break ending; `clock` a countdown or alarm done; `calendar` a
 * reminder or an event starting; `activity` a live activity ending;
 * `download` a finished download; `memory` memory almost full; `osd` volume, brightness, the lock keys
 * and the keyboard layout.
 */
export type AlertKind = 'battery' | 'device' | 'focus' | 'clock' | 'calendar' | 'activity' | 'download' | 'memory' | 'osd';

const IMPORTANT: readonly AlertKind[] = ['battery', 'focus', 'clock', 'calendar'];

/** Whether an alert of `kind` shows in a notch whose monitor is fullscreen. */
export function showsOverFullscreen(kind: AlertKind, setting: FullscreenAlerts): boolean {
    if (setting === 'all') return true;
    if (setting === 'important') return IMPORTANT.includes(kind);
    return false;
}

export interface FullscreenView {
    /** The notch is on screen. */
    visible: boolean;
    /** It shows over a fullscreen window, so unredirection must be off. */
    overFullscreen: boolean;
    /** The pointer may open it. */
    hover: boolean;
}

/**
 * The notch on a monitor that is `fullscreen` or not, with an alert that
 * was let through over it showing (`alert`) or not.
 */
export function fullscreenView(fullscreen: boolean, alert: boolean): FullscreenView {
    if (!fullscreen) return { visible: true, overFullscreen: false, hover: true };
    return { visible: alert, overFullscreen: alert, hover: false };
}

/**
 * Holds unredirection off: `disable` once when held, `enable` once when let
 * go, so the two always come in pairs however often `set` is called.
 */
export class UnredirectHold {
    private on = false;

    constructor(
        private readonly disable: () => void,
        private readonly enable: () => void,
    ) {}

    get held(): boolean {
        return this.on;
    }

    set(held: boolean): void {
        if (held === this.on) return;
        this.on = held;
        if (held) this.disable();
        else this.enable();
    }

    /** Lets go, if held; for destroy(). */
    release(): void {
        this.set(false);
    }
}
