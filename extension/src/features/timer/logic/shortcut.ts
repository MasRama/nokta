import type { TimerSnapshot } from './timer.js';

/** Like a click on the Focus toggle: start focus when idle, else stop. */
export const shortcutAction = (timer: TimerSnapshot): 'focus' | 'stop' => (timer.state === 'idle' ? 'focus' : 'stop');
