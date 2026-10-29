/** How an alert moves when it shows. `kick` is the notch's usual bounce. */
export type AlertMotion = 'kick' | 'slide' | 'fill' | 'sweep' | 'pulse' | 'ring' | 'pop' | 'shake';

const MOTIONS: Readonly<Record<string, AlertMotion>> = {
    'bluetooth-connected': 'slide',
    'charger-plugged': 'fill',
    'battery-full': 'sweep',
    'battery-low': 'pulse',
    'battery-critical': 'pulse',
    'timer-done': 'ring',
    'clock-done': 'ring',
    'activity-done': 'pop',
    'activity-failed': 'shake',
};

/**
 * The motion for an alert: a device alert's kind, `timer-done`,
 * `clock-done`, `activity-done`, `activity-failed` or `calendar`. With
 * `[appearance] alert_motion` off, and for any other alert, the kick.
 */
export function alertMotion(event: string, enabled: boolean): AlertMotion {
    return (enabled && MOTIONS[event]) || 'kick';
}

/** Whether the notch also kicks: the pulse and the shake replace the kick. */
export function motionKicks(motion: AlertMotion): boolean {
    return motion !== 'pulse' && motion !== 'shake';
}
