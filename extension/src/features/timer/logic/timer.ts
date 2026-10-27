import type { TimerProps } from '../../../shared/contracts.js';

export type TimerState = 'idle' | 'running' | 'paused';
export type TimerPhase = 'focus' | 'break' | '';

/** io.nokta.Timer1's properties in camelCase. */
export interface TimerSnapshot {
    state: TimerState;
    phase: TimerPhase;
    durationUs: number;
    remainingUs: number;
    timestampUs: number;
}

export const EMPTY_TIMER: Readonly<TimerSnapshot> = {
    state: 'idle',
    phase: '',
    durationUs: 0,
    remainingUs: 0,
    timestampUs: 0,
};

const S = 1_000_000;
const MIN = 60 * S;

const number = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0);

/** Reads the properties through `read`; anything unknown counts as idle. */
export function timerSnapshotFrom(read: (name: keyof TimerProps) => unknown): TimerSnapshot {
    const state = read('State');
    const phase = read('Phase');
    if ((state !== 'running' && state !== 'paused') || (phase !== 'focus' && phase !== 'break'))
        return { ...EMPTY_TIMER };
    return {
        state,
        phase,
        durationUs: number(read('DurationUs')),
        remainingUs: number(read('RemainingUs')),
        timestampUs: number(read('TimestampUs')),
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
    if (timer.state === 'idle') return `${focusMinutes} min`;
    const minutes = `${Math.max(1, Math.ceil(remainingAt(timer, nowUs) / MIN))} min left`;
    if (timer.state === 'paused') return `Paused, ${minutes}`;
    return timer.phase === 'break' ? `Break, ${minutes}` : minutes;
}

export interface FinishedAlert {
    title: string;
    detail: string;
}

/** The notch alert for io.nokta.Timer1.Finished, or null for an unknown phase. */
export function finishedAlert(phase: string, breakMinutes: number): FinishedAlert | null {
    if (phase === 'focus')
        return { title: 'Focus done', detail: breakMinutes > 0 ? `${breakMinutes} min break` : 'Time for a break' };
    if (phase === 'break') return { title: 'Break over', detail: 'Ready to focus' };
    return null;
}

/** The dot before the time left: tomato for focus, green for a break. */
export const phaseColor = (phase: TimerPhase): string => (phase === 'break' ? '#57e389' : '#ff7b63');
