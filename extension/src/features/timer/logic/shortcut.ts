import type { TimerSnapshot } from './timer.js';

/** The `[timer] shortcut` setting as GSettings key list; empty for none. */
export function shortcutKeys(setting: string): string[] {
    const keys = setting.trim();
    return keys ? [keys] : [];
}

/** Like a click on the Focus toggle: start focus when idle, else stop. */
export const shortcutAction = (timer: TimerSnapshot): 'focus' | 'stop' => (timer.state === 'idle' ? 'focus' : 'stop');
