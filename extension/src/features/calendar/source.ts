import type GObject from 'gi://GObject';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import { Listeners } from '../../shared/listeners.js';
import { eventsFrom, type CalendarEvent } from './logic/events.js';

/** What Nokta uses of GNOME Shell's `Calendar.DBusEventSource` (ui/calendar.js). */
interface EventSource extends GObject.Object {
    getEvents(begin: Date, end: Date): unknown;
}

const isEventSource = (value: unknown): value is EventSource =>
    value !== null &&
    typeof value === 'object' &&
    typeof (value as Partial<EventSource>).getEvents === 'function' &&
    typeof (value as Partial<EventSource>).connect === 'function';

/** The event source the date menu loads, or null on a shell without one. */
function dateMenuSource(): EventSource | null {
    const dateMenu = Main.panel.statusArea.dateMenu as unknown as { _eventSource?: unknown } | undefined;
    const source = dateMenu?._eventSource;
    return isEventSource(source) ? source : null;
}

/**
 * The calendar events GNOME Shell already loads for its date menu. Nokta
 * never asks for a time range itself: the calendar server keeps one range
 * for all its clients, and the date menu owns it.
 */
export class CalendarSource {
    private source: EventSource | null = null;
    private changedId = 0;
    private readonly listeners = new Listeners();

    constructor() {
        this.bind();
    }

    onChanged(callback: () => void): number {
        return this.listeners.add(callback);
    }

    disconnect(id: number): void {
        this.listeners.remove(id);
    }

    /** Timed events from now to the end of tomorrow, in the source's order. */
    events(nowMs: number): CalendarEvent[] {
        // The date menu makes a new source when the session mode changes.
        if (dateMenuSource() !== this.source) this.bind();
        if (!this.source) return [];
        const end = new Date(nowMs);
        end.setHours(0, 0, 0, 0);
        end.setDate(end.getDate() + 2);
        try {
            return eventsFrom(this.source.getEvents(new Date(nowMs), end));
        } catch (error) {
            console.warn('Nokta: cannot read calendar events', error);
            return [];
        }
    }

    destroy(): void {
        this.listeners.clear();
        this.unbind();
    }

    private bind(): void {
        this.unbind();
        this.source = dateMenuSource();
        this.changedId = this.source?.connect('changed', () => this.listeners.emit()) ?? 0;
    }

    private unbind(): void {
        if (this.changedId) this.source?.disconnect(this.changedId);
        this.changedId = 0;
        this.source = null;
    }
}
