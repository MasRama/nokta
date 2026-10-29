import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import { CALENDAR1_XML } from '../../generated/contracts.js';
import { PATHS } from '../../shared/contracts.js';
import { makeProxy } from '../../shared/dbus.js';
import { Listeners } from '../../shared/listeners.js';
import { idsToAsk } from './logic/answers.js';

/** An io.nokta.Calendar1 method that answers a string for an event id. */
export type EventQuestion = 'MeetingLink' | 'EventColor';

/** io.nokta.Calendar1: one thing about each of the shell's events, read by the daemon. */
export class EventAnswers {
    private proxy: Gio.DBusProxy | null = null;
    private readonly answers = new Map<string, string>();
    private readonly askedAt = new Map<string, number>();
    private readonly listeners = new Listeners();

    constructor(private readonly method: EventQuestion) {}

    /** The daemon's answer for the event; null when it has none or it is not known yet. */
    get(id: string): string | null {
        return this.answers.get(id) || null;
    }

    onChanged(callback: () => void): number {
        return this.listeners.add(callback);
    }

    disconnect(id: number): void {
        this.listeners.remove(id);
    }

    async attach(connection: Gio.DBusConnection, cancellable: Gio.Cancellable): Promise<void> {
        const proxy = await makeProxy(CALENDAR1_XML, PATHS.Calendar1, connection, cancellable);
        this.detach();
        this.proxy = proxy;
    }

    /** Asks about the `ids` not asked about lately; a change comes when an answer differs. */
    want(ids: readonly string[]): void {
        const proxy = this.proxy;
        if (!proxy) return;
        const now = Date.now();
        for (const id of idsToAsk(ids, this.askedAt, now)) {
            this.askedAt.set(id, now);
            const params = new GLib.Variant('(s)', [id]);
            proxy.call(this.method, params, Gio.DBusCallFlags.NONE, -1, null, (source, result) => {
                let answer = '';
                try {
                    answer = (source?.call_finish(result).get_child_value(0).unpack() as string) ?? '';
                } catch (error) {
                    console.warn(`Nokta: ${this.method} failed`, error);
                }
                if (this.proxy !== proxy || (this.answers.get(id) ?? '') === answer) return;
                this.answers.set(id, answer);
                this.listeners.emit();
            });
        }
    }

    /** Forgets the daemon and every answer. */
    detach(): void {
        this.proxy = null;
        this.askedAt.clear();
        if (this.answers.size === 0) return;
        this.answers.clear();
        this.listeners.emit();
    }

    destroy(): void {
        this.detach();
        this.listeners.clear();
    }
}
