import type { TimerSnapshot } from './timer.js';

/** The `[timer] shortcut` setting as GSettings key list; empty for none. */
export function shortcutKeys(setting: string): string[] {
    const keys = setting.trim();
    return keys ? [keys] : [];
}

/** Like a click on the Focus toggle: start focus when idle, else stop. */
export const shortcutAction = (timer: TimerSnapshot): 'focus' | 'stop' => (timer.state === 'idle' ? 'focus' : 'stop');

/** The focus button in the idle panel says what a click does, like the shortcut. */
export const focusButtonLabel = (timer: TimerSnapshot, focusMinutes: number): string => {
    if (shortcutAction(timer) === 'focus') return `Focus · ${focusMinutes} min`;
    return timer.phase === 'break' ? 'Stop break' : 'Stop focus';
};
