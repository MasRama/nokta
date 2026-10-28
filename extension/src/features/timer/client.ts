import type Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import { TIMER1_XML } from '../../generated/contracts.js';
import { PATHS } from '../../shared/contracts.js';
import { cached, callMethod, makeProxy } from '../../shared/dbus.js';
import { Listeners } from '../../shared/listeners.js';
import { clocksFrom, type Clock } from './logic/clocks.js';
import { EMPTY_TIMER, timerSnapshotFrom, type TimerSnapshot } from './logic/timer.js';

/**
 * io.nokta.Timer1: the focus timer in noktad, its controls and Finished;
 * and the countdowns, stopwatches and alarms beside it, with ClockDone.
 */
export class TimerClient {
    private proxy: Gio.DBusProxy | null = null;
    private readonly ids: number[] = [];
    private current: TimerSnapshot = { ...EMPTY_TIMER };
    private currentClocks: readonly Clock[] = [];
    private readonly listeners = new Listeners();

    constructor(
        private readonly onFinished: (phase: string) => void,
        private readonly onClockDone: (kind: string, label: string) => void,
    ) {}

    snapshot(): TimerSnapshot {
        return this.current;
    }

    /** Newest first. */
    clocks(): readonly Clock[] {
        return this.currentClocks;
    }

    onChanged(callback: () => void): number {
        return this.listeners.add(callback);
    }

    disconnect(id: number): void {
        this.listeners.remove(id);
    }

    async attach(connection: Gio.DBusConnection, cancellable: Gio.Cancellable): Promise<void> {
        const proxy = await makeProxy(TIMER1_XML, PATHS.Timer1, connection, cancellable);
        this.detach();
        this.proxy = proxy;
        this.ids.push(proxy.connect('g-properties-changed', () => this.read()));
        this.ids.push(
            proxy.connect('g-signal', (_proxy, _sender: string | null, signal: string, parameters: GLib.Variant) => {
                if (signal === 'Finished') this.onFinished(parameters.deepUnpack<[string]>()[0]);
                if (signal === 'ClockDone') {
                    const [, kind, label] = parameters.deepUnpack<[string, string, string]>();
                    this.onClockDone(kind, label);
                }
            }),
        );
        this.read();
    }

    /** Forgets the daemon; the timer shows as idle. */
    detach(): void {
        for (const id of this.ids) this.proxy?.disconnect(id);
        this.ids.length = 0;
        this.proxy = null;
        this.current = { ...EMPTY_TIMER };
        this.currentClocks = [];
        this.listeners.emit();
    }

    start(phase: 'focus' | 'break'): void {
        this.call('Start', new GLib.Variant('(s)', [phase]));
    }

    pause(): void {
        this.call('Pause');
    }

    resume(): void {
        this.call('Resume');
    }

    stop(): void {
        this.call('Stop');
    }

    addCountdown(minutes: number): void {
        this.call('AddCountdown', new GLib.Variant('(sx)', ['', minutes * 60_000_000]));
    }

    addStopwatch(): void {
        this.call('AddStopwatch', new GLib.Variant('(s)', ['']));
    }

    pauseClock(id: string): void {
        this.call('PauseClock', new GLib.Variant('(s)', [id]));
    }

    resumeClock(id: string): void {
        this.call('ResumeClock', new GLib.Variant('(s)', [id]));
    }

    removeClock(id: string): void {
        this.call('RemoveClock', new GLib.Variant('(s)', [id]));
    }

    destroy(): void {
        this.listeners.clear();
        this.detach();
    }

    private call(method: string, params: GLib.Variant | null = null): void {
        if (this.proxy) callMethod(this.proxy, method, params);
    }

    private read(): void {
        const proxy = this.proxy;
        if (!proxy) return;
        this.current = timerSnapshotFrom((name) => cached(proxy, name));
        this.currentClocks = clocksFrom(cached(proxy, 'Clocks'));
        this.listeners.emit();
    }
}
