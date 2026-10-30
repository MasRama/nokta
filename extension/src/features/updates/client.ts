import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import { UPDATES1_XML } from '../../generated/contracts.js';
import { PATHS } from '../../shared/contracts.js';
import { cached, makeProxy } from '../../shared/dbus.js';
import { Listeners } from '../../shared/listeners.js';

/** io.nokta.Updates1: the newer release the daemon found, and installing it. */
export class UpdatesClient {
    private proxy: Gio.DBusProxy | null = null;
    private changedId = 0;
    private readonly listeners = new Listeners();

    /** The newer release's version, empty when there is none or no daemon. */
    latest(): string {
        const latest = this.proxy ? cached(this.proxy, 'Latest') : '';
        return typeof latest === 'string' ? latest : '';
    }

    /** That release's web page, empty with latest(). */
    releaseUrl(): string {
        const url = this.proxy ? cached(this.proxy, 'ReleaseUrl') : '';
        return typeof url === 'string' ? url : '';
    }

    onChanged(callback: () => void): number {
        return this.listeners.add(callback);
    }

    disconnect(id: number): void {
        this.listeners.remove(id);
    }

    async attach(connection: Gio.DBusConnection, cancellable: Gio.Cancellable): Promise<void> {
        const proxy = await makeProxy(UPDATES1_XML, PATHS.Updates1, connection, cancellable);
        this.detach();
        this.proxy = proxy;
        this.changedId = proxy.connect('g-properties-changed', () => this.listeners.emit());
        this.listeners.emit();
    }

    /** Asks the daemon to start `nokta update --yes`; `onError` gets its message when it cannot. */
    install(onError: (message: string) => void): void {
        if (!this.proxy) {
            onError('noktad is not running');
            return;
        }
        this.proxy.call('Install', null, Gio.DBusCallFlags.NONE, -1, null, (source, result) => {
            try {
                source?.call_finish(result);
            } catch (error) {
                if (error instanceof GLib.Error) Gio.DBusError.strip_remote_error(error);
                onError(error instanceof Error ? error.message : String(error));
            }
        });
    }

    detach(): void {
        if (this.changedId) this.proxy?.disconnect(this.changedId);
        this.changedId = 0;
        this.proxy = null;
        this.listeners.emit();
    }

    destroy(): void {
        this.listeners.clear();
        this.detach();
    }
}
