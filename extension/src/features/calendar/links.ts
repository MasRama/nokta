import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import { CALENDAR1_XML } from '../../generated/contracts.js';
import { PATHS } from '../../shared/contracts.js';
import { makeProxy } from '../../shared/dbus.js';
import { Listeners } from '../../shared/listeners.js';
import { linksToAsk } from './logic/links.js';

/** io.nokta.Calendar1: the meeting links of the shell's events, read by the daemon. */
export class MeetingLinks {
    private proxy: Gio.DBusProxy | null = null;
    private readonly links = new Map<string, string>();
    private readonly askedAt = new Map<string, number>();
    private readonly listeners = new Listeners();

    /** The event's meeting link; null when it has none or it is not known yet. */
    link(id: string): string | null {
        return this.links.get(id) || null;
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

    /** Asks for the links of `ids` not asked about lately; a change comes when one differs. */
    want(ids: readonly string[]): void {
        const proxy = this.proxy;
        if (!proxy) return;
        const now = Date.now();
        for (const id of linksToAsk(ids, this.askedAt, now)) {
            this.askedAt.set(id, now);
            const params = new GLib.Variant('(s)', [id]);
            proxy.call('MeetingLink', params, Gio.DBusCallFlags.NONE, -1, null, (source, result) => {
                let link = '';
                try {
                    link = (source?.call_finish(result).get_child_value(0).unpack() as string) ?? '';
                } catch (error) {
                    console.warn('Nokta: MeetingLink failed', error);
                }
                if (this.proxy !== proxy || (this.links.get(id) ?? '') === link) return;
                this.links.set(id, link);
                this.listeners.emit();
            });
        }
    }

    /** Forgets the daemon and every link. */
    detach(): void {
        this.proxy = null;
        this.askedAt.clear();
        if (this.links.size === 0) return;
        this.links.clear();
        this.listeners.emit();
    }

    destroy(): void {
        this.detach();
        this.listeners.clear();
    }
}
