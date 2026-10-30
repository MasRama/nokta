import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import type { Table } from '../features/settings/index.js';
import { SETTINGS1_XML } from '../generated/contracts.js';
import { BUS_NAME, PATHS } from '../shared/contracts.js';
import { newProxy } from '../shared/dbus.js';

export type Tables = Partial<Record<Table, unknown>>;

const PROPERTIES: Record<Table, string> = {
    appearance: 'Appearance',
    behavior: 'Behavior',
    media: 'Media',
    lyrics: 'Lyrics',
    timer: 'Timer',
    notifications: 'Notifications',
    activities: 'Activities',
    weather: 'Weather',
    calendar: 'Calendar',
    clipboard: 'Clipboard',
    downloads: 'Downloads',
    system: 'System',
    updates: 'Updates',
    home: 'Home',
};

/** The daemon's message without the `GDBus.Error:...:` prefix. */
export function errorMessage(error: unknown): string {
    if (error instanceof GLib.Error) {
        Gio.DBusError.strip_remote_error(error);
        return error.message;
    }
    return error instanceof Error ? error.message : String(error);
}

/**
 * io.nokta.Settings1 for the settings window. Unlike the notch it may start
 * the daemon through D-Bus activation. `onChanged` runs whenever the tables
 * or the daemon's presence change.
 */
export class SettingsService {
    tables: Tables = {};
    /** The picture theme's image as the daemon prepared it; empty strings while there is none. */
    picture = { path: '', color: '', tone: '' };
    available = false;
    private proxy: Gio.DBusProxy | null = null;
    private readonly ids: number[] = [];
    private readonly cancellable = new Gio.Cancellable();

    constructor(private readonly onChanged: () => void) {
        newProxy(
            SETTINGS1_XML,
            Gio.DBus.session,
            BUS_NAME,
            PATHS.Settings1,
            (proxy: Gio.DBusProxy | null, error: unknown) => {
                if (error || !proxy) {
                    if (!this.cancellable.is_cancelled()) console.warn('Nokta: no settings service', error);
                    return;
                }
                this.proxy = proxy;
                this.ids.push(proxy.connect('g-properties-changed', () => this.read()));
                this.ids.push(proxy.connect('notify::g-name-owner', () => this.read()));
                this.read();
            },
            this.cancellable,
            Gio.DBusProxyFlags.NONE,
        );
    }

    set(table: Table, key: string, value: GLib.Variant): Promise<void> {
        return this.call('Set', new GLib.Variant('(ssv)', [table, key, value]));
    }

    reset(): Promise<void> {
        return this.call('Reset', null);
    }

    destroy(): void {
        this.cancellable.cancel();
        for (const id of this.ids) this.proxy?.disconnect(id);
        this.ids.length = 0;
        this.proxy = null;
    }

    private read(): void {
        const proxy = this.proxy;
        if (!proxy) return;
        const tables: Tables = {};
        for (const [table, property] of Object.entries(PROPERTIES) as [Table, string][])
            tables[table] = proxy.get_cached_property(property)?.recursiveUnpack();
        this.tables = tables;
        const text = (name: string): string => {
            const value = proxy.get_cached_property(name)?.recursiveUnpack();
            return typeof value === 'string' ? value : '';
        };
        this.picture = { path: text('PicturePath'), color: text('PictureColor'), tone: text('PictureTone') };
        // The cache empties when the daemon leaves the bus.
        this.available = proxy.g_name_owner !== null && tables.appearance !== undefined;
        this.onChanged();
    }

    private call(method: string, params: GLib.Variant | null): Promise<void> {
        const proxy = this.proxy;
        if (!proxy) return Promise.reject(new Error('Nokta is not running'));
        return new Promise((resolve, reject) => {
            proxy.call(method, params, Gio.DBusCallFlags.NONE, -1, null, (source, result) => {
                try {
                    source?.call_finish(result);
                    resolve();
                } catch (error) {
                    reject(error);
                }
            });
        });
    }
}
