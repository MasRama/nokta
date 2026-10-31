import { clocksFrom, type Clock } from '@ext/features/timer/logic/clocks.js';
import { EMPTY_TIMER, timerSnapshotFrom, type TimerSnapshot } from '@ext/features/timer/logic/timer.js';

import type { Bridge } from './bridge/bridge.js';
import { Follower } from './follower.js';

const MINUTE_US = 60_000_000;

/**
 * Timer1: the focus timer and the clocks beside it, the page's
 * TimerClient. Its timestamps are on the wall clock, as `nowUs()` reads it.
 */
export class Timer extends Follower {
    snapshot: TimerSnapshot = { ...EMPTY_TIMER };
    clocks: Clock[] = [];
    private stops: Array<() => void> = [];

    constructor(
        bridge: Bridge,
        onChanged: () => void,
        private readonly onFinished: (phase: string) => void,
        private readonly onClockDone: (kind: string, label: string) => void,
    ) {
        super(bridge, 'Timer1', onChanged);
    }

    override async attach(): Promise<void> {
        const text = (value: unknown): string => (typeof value === 'string' ? value : '');
        this.stops = [
            this.bridge.onSignal('Timer1', 'Finished', (phase) => this.onFinished(text(phase))),
            this.bridge.onSignal('Timer1', 'ClockDone', (_id, kind, label) => this.onClockDone(text(kind), text(label))),
        ];
        await super.attach();
    }

    override detach(): void {
        this.stops.forEach((stop) => stop());
        this.stops = [];
        super.detach();
    }

    /** Like a click on the Focus tile: starts focus when idle, else stops. */
    toggleFocus(): void {
        if (this.snapshot.state === 'idle') this.call('Start', 'focus');
        else this.call('Stop');
    }

    addCountdown(minutes: number): void {
        this.call('AddCountdown', '', minutes * MINUTE_US);
    }

    addStopwatch(): void {
        this.call('AddStopwatch', '');
    }

    /** Pauses a running clock, or resumes a paused one. */
    pauseClock(id: string, pause: boolean): void {
        this.call(pause ? 'PauseClock' : 'ResumeClock', id);
    }

    removeClock(id: string): void {
        this.call('RemoveClock', id);
    }

    protected override read(): void {
        this.snapshot = timerSnapshotFrom((name) => this.props[name]);
        this.clocks = clocksFrom(this.props.Clocks);
    }
}
