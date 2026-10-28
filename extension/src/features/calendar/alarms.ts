import GLib from 'gi://GLib';

import { nextAlarm, type Alarm, type CalendarEvent } from './logic/events.js';

/**
 * One exact timeout for the next reminder or start. `reschedule()` sets it
 * again; call it when the events or the reminder setting change. Nothing
 * polls.
 */
export class CalendarAlarms {
    private timeoutId = 0;
    /** The last alarm that fired, so a timeout that wakes a little early never repeats it. */
    private firedAtMs = 0;

    constructor(
        private readonly events: (nowMs: number) => readonly CalendarEvent[],
        private readonly reminderMinutes: () => number | null,
        private readonly onAlarm: (alarm: Alarm, nowMs: number) => void,
    ) {}

    reschedule(): void {
        this.cancel();
        const minutes = this.reminderMinutes();
        if (minutes === null) return;
        const nowMs = Math.max(Date.now(), this.firedAtMs);
        const alarm = nextAlarm(this.events(nowMs), nowMs, minutes);
        if (!alarm) return;
        const delay = Math.max(0, Math.min(alarm.atMs - Date.now(), 2 ** 31 - 1));
        this.timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, delay, () => {
            this.timeoutId = 0;
            this.firedAtMs = alarm.atMs;
            this.onAlarm(alarm, Date.now());
            this.reschedule();
            return GLib.SOURCE_REMOVE;
        });
    }

    destroy(): void {
        this.cancel();
    }

    private cancel(): void {
        if (this.timeoutId) GLib.source_remove(this.timeoutId);
        this.timeoutId = 0;
    }
}
