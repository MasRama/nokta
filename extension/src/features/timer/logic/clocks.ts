import { formatRemaining } from './timer.js';

export type ClockKind = 'countdown' | 'stopwatch' | 'alarm';

/** One row of io.nokta.Timer1's Clocks: a countdown, a stopwatch or an alarm. */
export interface Clock {
    id: string;
    kind: ClockKind;
    label: string;
    running: boolean;
    /** A countdown's length, else 0. */
    durationUs: number;
    /** Time left for a countdown or an alarm, time elapsed for a stopwatch, at `timestampUs`. */
    valueUs: number;
    /** Monotonic µs. */
    timestampUs: number;
    /** An alarm's time in Unix µs, else 0. */
    alarmUnixUs: number;
}

const S = 1_000_000;
const MIN = 60 * S;
const HOUR = 60 * MIN;
/** An alarm takes the closed notch's spot only this close to ringing. */
const ALARM_SHOWN_US = HOUR;

const KINDS: readonly string[] = ['countdown', 'stopwatch', 'alarm'];
const num = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0);

/** Reads the Clocks property; rows of an unknown shape or kind are left out. */
export function clocksFrom(value: unknown): Clock[] {
    if (!Array.isArray(value)) return [];
    const clocks: Clock[] = [];
    for (const row of value) {
        if (!Array.isArray(row) || row.length !== 8) continue;
        const [id, kind, label, running, durationUs, valueUs, timestampUs, alarmUnixUs] = row as unknown[];
        if (typeof id !== 'string' || typeof kind !== 'string' || !KINDS.includes(kind)) continue;
        clocks.push({
            id,
            kind: kind as ClockKind,
            label: typeof label === 'string' ? label : '',
            running: running === true,
            durationUs: num(durationUs),
            valueUs: num(valueUs),
            timestampUs: num(timestampUs),
            alarmUnixUs: num(alarmUnixUs),
        });
    }
    return clocks;
}

/** The clock's value at monotonic time `nowUs`. */
export function clockValueAt(clock: Clock, nowUs: number): number {
    if (!clock.running) return clock.valueUs;
    const passed = Math.max(0, nowUs - clock.timestampUs);
    return clock.kind === 'stopwatch' ? clock.valueUs + passed : Math.max(0, clock.valueUs - passed);
}

const pad = (n: number): string => String(n).padStart(2, '0');

/** Time left rounded up, like the focus timer; a stopwatch's time rounded down. */
export function clockText(clock: Clock, nowUs: number): string {
    const value = clockValueAt(clock, nowUs);
    if (clock.kind !== 'stopwatch') return formatRemaining(value);
    const total = Math.floor(value / S);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    return h > 0 ? `${h}:${pad(m)}:${pad(total % 60)}` : `${m}:${pad(total % 60)}`;
}

const DEFAULT_TITLES: Record<ClockKind, string> = { countdown: 'Timer', stopwatch: 'Stopwatch', alarm: 'Alarm' };

export const clockTitle = (clock: Clock): string => clock.label || DEFAULT_TITLES[clock.kind];

/** Like `1 h 30 min` or `45 s`. */
function formatLength(us: number): string {
    const total = Math.round(us / S);
    const parts: string[] = [];
    if (total >= 3600) parts.push(`${Math.floor(total / 3600)} h`);
    if (total % 3600 >= 60) parts.push(`${Math.floor((total % 3600) / 60)} min`);
    if (total % 60 > 0) parts.push(`${total % 60} s`);
    return parts.join(' ');
}

/** The dimmed text after the title in home: a countdown's length or an alarm's time, and whether it is paused. */
export function clockDetail(clock: Clock, alarmTime: string): string {
    const what = clock.kind === 'countdown' ? formatLength(clock.durationUs) : clock.kind === 'alarm' ? alarmTime : '';
    return [clock.running ? '' : 'Paused', what].filter(Boolean).join(' · ');
}

const due = (clock: Clock, nowUs: number): boolean =>
    clock.running && (clock.kind === 'countdown' || (clock.kind === 'alarm' && clockValueAt(clock, nowUs) <= ALARM_SHOWN_US));

/**
 * The clock in the closed notch: the running countdown or alarm (in its
 * last hour) that rings first, else the newest running stopwatch, else the
 * newest paused clock.
 */
export function indicatorClock(clocks: readonly Clock[], nowUs: number): Clock | null {
    const soonest = clocks
        .filter((c) => due(c, nowUs))
        .reduce<Clock | null>((best, c) => (best && clockValueAt(best, nowUs) <= clockValueAt(c, nowUs) ? best : c), null);
    return (
        soonest ??
        clocks.find((c) => c.running && c.kind === 'stopwatch') ??
        clocks.find((c) => !c.running) ??
        null
    );
}

/**
 * Milliseconds until the closed notch must redraw: the shown clock's second
 * changes, or an alarm comes into its last hour. Null when nothing will.
 */
export function msUntilClockChange(clocks: readonly Clock[], nowUs: number): number | null {
    const waits: number[] = [];
    const shown = indicatorClock(clocks, nowUs);
    if (shown?.running) {
        const value = clockValueAt(shown, nowUs);
        const toNext = shown.kind === 'stopwatch' ? (Math.floor(value / S) + 1) * S - value : value - (Math.ceil(value / S) - 1) * S;
        if (shown.kind === 'stopwatch' || value > 0) waits.push(toNext);
    }
    for (const c of clocks) {
        const left = clockValueAt(c, nowUs);
        if (c.kind === 'alarm' && left > ALARM_SHOWN_US) waits.push(left - ALARM_SHOWN_US);
    }
    if (waits.length === 0) return null;
    return Math.max(1, Math.round(Math.min(...waits) / 1000));
}

/** The dot and icon color of each kind; the focus timer keeps tomato and green. */
export function clockColor(kind: ClockKind): string {
    if (kind === 'stopwatch') return '#5ac8fa';
    if (kind === 'alarm') return '#bf9cff';
    return '#ffb340';
}

export interface ClockAlert {
    title: string;
    detail: string;
}

/** The notch alert for io.nokta.Timer1.ClockDone; `time` is the local time now. A stopwatch never finishes. */
export function clockDoneAlert(kind: string, label: string, time: string): ClockAlert | null {
    if (kind === 'countdown') return label ? { title: label, detail: 'Timer done' } : { title: 'Timer done', detail: '' };
    if (kind === 'alarm') return label ? { title: label, detail: `Alarm · ${time}` } : { title: 'Alarm', detail: time };
    return null;
}

/** The timer page's buttons, in minutes. */
export const TIMER_PRESETS: readonly number[] = [1, 3, 5, 10, 15, 30];
