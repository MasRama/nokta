import type { TimerProps } from '../../../shared/contracts.js';
import type { TimerSettings } from '../../settings/logic/parse.js';
import { TONES } from '../../../shared/logic/tones.js';
import { _, format } from '../../../shared/logic/i18n.js';

export type TimerState = 'idle' | 'running' | 'paused';
export type TimerPhase = 'focus' | 'break' | '';

/** io.nokta.Timer1's properties in camelCase. */
export interface TimerSnapshot {
    state: TimerState;
    phase: TimerPhase;
    durationUs: number;
    remainingUs: number;
    timestampUs: number;
    /** Focus sessions finished since the last long break or stop. */
    sessions: number;
    longBreak: boolean;
}

export const EMPTY_TIMER: Readonly<TimerSnapshot> = {
    state: 'idle',
    phase: '',
    durationUs: 0,
    remainingUs: 0,
    timestampUs: 0,
    sessions: 0,
    longBreak: false,
};

const S = 1_000_000;
const MIN = 60 * S;

const number = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0);

/** Reads the properties through `read`; anything unknown counts as idle. */
export function timerSnapshotFrom(read: (name: keyof TimerProps) => unknown): TimerSnapshot {
    const state = read('State');
    const phase = read('Phase');
    const sessions = number(read('Sessions'));
    if ((state !== 'running' && state !== 'paused') || (phase !== 'focus' && phase !== 'break'))
        return { ...EMPTY_TIMER, sessions };
    return {
        state,
        phase,
        durationUs: number(read('DurationUs')),
        remainingUs: number(read('RemainingUs')),
        timestampUs: number(read('TimestampUs')),
        sessions,
        longBreak: read('LongBreak') === true,
    };
}

/** Time left at monotonic time `nowUs`. */
export function remainingAt(timer: TimerSnapshot, nowUs: number): number {
    if (timer.state === 'paused') return timer.remainingUs;
    if (timer.state !== 'running') return 0;
    return Math.max(0, timer.remainingUs - (nowUs - timer.timestampUs));
}

const seconds = (us: number): number => Math.max(0, Math.ceil(us / S));
const pad = (n: number): string => String(n).padStart(2, '0');

/** `m:ss`, or `h:mm:ss` from an hour, rounded up so 0:00 means done. */
export function formatRemaining(us: number): string {
    const total = seconds(us);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/** Milliseconds until the shown second changes, or null when it will not. */
export function msUntilNextSecond(timer: TimerSnapshot, nowUs: number): number | null {
    if (timer.state !== 'running') return null;
    const left = remainingAt(timer, nowUs);
    if (left <= 0) return null;
    return Math.max(1, Math.round((left - (seconds(left) - 1) * S) / 1000));
}

/** The Quick Settings toggle's subtitle. */
export function toggleSubtitle(timer: TimerSnapshot, nowUs: number, focusMinutes: number): string {
    if (timer.state === 'idle') return format(_('%d min'), focusMinutes);
    const minutes = format(_('%d min left'), Math.max(1, Math.ceil(remainingAt(timer, nowUs) / MIN)));
    if (timer.state === 'paused') return format(_('Paused, %s'), minutes);
    if (timer.phase !== 'break') return minutes;
    return format(timer.longBreak ? _('Long break, %s') : _('Break, %s'), minutes);
}

/** A break's length in minutes and whether it is the long one. */
export interface BreakInfo {
    minutes: number;
    long: boolean;
}

const breakInfo = (long: boolean, settings: TimerSettings): BreakInfo => ({
    minutes: long ? settings.longBreakMinutes : settings.breakMinutes,
    long,
});

/** The break that "Start break" would start now. */
export function nextBreak(timer: TimerSnapshot, settings: TimerSettings): BreakInfo {
    const every = settings.sessionsBeforeLongBreak;
    return breakInfo(every > 0 && timer.sessions >= every, settings);
}

/**
 * The break that follows the focus session that just finished. Finished can
 * arrive before or after the new state, so both are read: a running break
 * says itself; a focus session still shown will count one more session; an
 * idle timer means no break started, so the long one was not due.
 */
export function breakAfterFocus(timer: TimerSnapshot, settings: TimerSettings): BreakInfo {
    if (timer.phase === 'break') return breakInfo(timer.longBreak, settings);
    if (timer.phase === 'focus') return nextBreak({ ...timer, sessions: timer.sessions + 1 }, settings);
    return breakInfo(false, settings);
}

export interface FinishedAlert {
    title: string;
    detail: string;
}

/** The notch alert for io.nokta.Timer1.Finished, or null for an unknown phase. */
export function finishedAlert(phase: string, next: BreakInfo): FinishedAlert | null {
    if (phase === 'focus') {
        const detail = next.long ? _('%d min long break') : _('%d min break');
        return { title: _('Focus done'), detail: next.minutes > 0 ? format(detail, next.minutes) : _('Time for a break') };
    }
    if (phase === 'break') return { title: _('Break over'), detail: _('Ready to focus') };
    return null;
}

/** The dot before the time left: tomato for focus, green for a break. */
export const phaseColor = (phase: TimerPhase): string => (phase === 'break' ? TONES.break : TONES.focus);
