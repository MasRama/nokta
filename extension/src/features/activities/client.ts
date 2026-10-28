import type Gio from 'gi://Gio';
import type GLib from 'gi://GLib';

import { ACTIVITIES1_XML } from '../../generated/contracts.js';
import { PATHS } from '../../shared/contracts.js';
import { cached, makeProxy } from '../../shared/dbus.js';
import { Listeners } from '../../shared/listeners.js';
import { activitiesFrom, type Activity } from './logic/activities.js';

/** One io.nokta.Activities1.Ended signal. */
export interface EndedSignal {
    id: string;
    title: string;
    success: boolean;
    message: string;
    elapsedUs: number;
}

/** io.nokta.Activities1: the running activities and the ones that end. */
export class ActivitiesClient {
    private proxy: Gio.DBusProxy | null = null;
    private readonly ids: number[] = [];
    private current: Activity[] = [];
    private readonly listeners = new Listeners();

    constructor(private readonly onEnded: (ended: EndedSignal) => void) {}

    /** Newest first. */
    list(): readonly Activity[] {
        return this.current;
    }

    onChanged(callback: () => void): number {
        return this.listeners.add(callback);
    }

    disconnect(id: number): void {
        this.listeners.remove(id);
    }

    async attach(connection: Gio.DBusConnection, cancellable: Gio.Cancellable): Promise<void> {
        const proxy = await makeProxy(ACTIVITIES1_XML, PATHS.Activities1, connection, cancellable);
        this.detach();
        this.proxy = proxy;
        this.ids.push(proxy.connect('g-properties-changed', () => this.read()));
        this.ids.push(
            proxy.connect('g-signal', (_proxy, _sender: string | null, signal: string, parameters: GLib.Variant) => {
                if (signal !== 'Ended') return;
                const [id, title, success, message, elapsedUs] =
                    parameters.deepUnpack<[string, string, boolean, string, number]>();
                this.onEnded({ id, title, success, message, elapsedUs });
            }),
        );
        this.read();
    }

    /** Forgets the daemon; no activities show. */
    detach(): void {
        for (const id of this.ids) this.proxy?.disconnect(id);
        this.ids.length = 0;
        this.proxy = null;
        this.current = [];
        this.listeners.emit();
    }

    destroy(): void {
        this.listeners.clear();
        this.detach();
    }

    private read(): void {
        const proxy = this.proxy;
        if (!proxy) return;
        this.current = activitiesFrom(cached(proxy, 'Activities'));
        this.listeners.emit();
    }
}
