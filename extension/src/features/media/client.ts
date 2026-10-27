import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import { MEDIA1_XML } from '../../generated/contracts.js';
import { PATHS } from '../../shared/contracts.js';
import { cached, callMethod, makeProxy } from '../../shared/dbus.js';
import { Listeners } from '../../shared/listeners.js';
import { EMPTY_SNAPSHOT, snapshotFrom, type MediaSnapshot } from './logic/snapshot.js';

/** io.nokta.Media1: the active player's state and its controls. */
export class MediaClient {
    private proxy: Gio.DBusProxy | null = null;
    private changedId = 0;
    private current: MediaSnapshot = { ...EMPTY_SNAPSHOT };
    private readonly listeners = new Listeners();

    snapshot(): MediaSnapshot {
        return this.current;
    }

    onChanged(callback: () => void): number {
        return this.listeners.add(callback);
    }

    disconnect(id: number): void {
        this.listeners.remove(id);
    }

    async attach(connection: Gio.DBusConnection, cancellable: Gio.Cancellable): Promise<void> {
        const proxy = await makeProxy(MEDIA1_XML, PATHS.Media1, connection, cancellable);
        this.detach();
        this.proxy = proxy;
        this.changedId = proxy.connect('g-properties-changed', () => this.read());
        this.read();
    }

    /** Forgets the daemon; the snapshot becomes empty (no player). */
    detach(): void {
        if (this.proxy) {
            this.proxy.disconnect(this.changedId);
            this.proxy = null;
            this.changedId = 0;
        }
        this.current = { ...EMPTY_SNAPSHOT };
        this.listeners.emit();
    }

    playPause(): void {
        this.call('PlayPause');
    }

    next(): void {
        this.call('Next');
    }

    previous(): void {
        this.call('Previous');
    }

    setPosition(us: number): void {
        this.call('SetPosition', new GLib.Variant('(x)', [Math.round(us)]));
    }

    refreshPosition(): void {
        this.call('RefreshPosition');
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
        this.current = snapshotFrom((name) => cached(proxy, name));
        this.listeners.emit();
    }
}
