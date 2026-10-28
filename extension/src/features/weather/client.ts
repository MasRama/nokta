import type Gio from 'gi://Gio';

import { WEATHER1_XML } from '../../generated/contracts.js';
import { PATHS, type WeatherProps } from '../../shared/contracts.js';
import { cached, callMethod, makeProxy } from '../../shared/dbus.js';
import { Listeners } from '../../shared/listeners.js';
import { weatherLine, type WeatherLine } from './logic/weather.js';

const PROPERTIES: readonly (keyof WeatherProps)[] = [
    'Status',
    'Place',
    'Temperature',
    'High',
    'Low',
    'Units',
    'Condition',
    'IsDay',
];

/** io.nokta.Weather1: the weather the daemon last read for the configured place. */
export class WeatherClient {
    private proxy: Gio.DBusProxy | null = null;
    private changedId = 0;
    private current: WeatherLine | null = null;
    private readonly listeners = new Listeners();

    /** Null while there is no ready reading. */
    line(): WeatherLine | null {
        return this.current;
    }

    onChanged(callback: () => void): number {
        return this.listeners.add(callback);
    }

    disconnect(id: number): void {
        this.listeners.remove(id);
    }

    async attach(connection: Gio.DBusConnection, cancellable: Gio.Cancellable): Promise<void> {
        const proxy = await makeProxy(WEATHER1_XML, PATHS.Weather1, connection, cancellable);
        this.detach();
        this.proxy = proxy;
        this.changedId = proxy.connect('g-properties-changed', () => this.read());
        this.read();
    }

    /** Asks the daemon for new weather if its reading is stale; the answer comes as a change. */
    refresh(): void {
        if (this.proxy) callMethod(this.proxy, 'Refresh');
    }

    /** Forgets the daemon; no weather shows. */
    detach(): void {
        if (this.changedId) this.proxy?.disconnect(this.changedId);
        this.changedId = 0;
        this.proxy = null;
        this.current = null;
        this.listeners.emit();
    }

    destroy(): void {
        this.listeners.clear();
        this.detach();
    }

    private read(): void {
        const proxy = this.proxy;
        if (!proxy) return;
        const props: Record<string, unknown> = {};
        for (const name of PROPERTIES) props[name] = cached(proxy, name);
        this.current = weatherLine(props);
        this.listeners.emit();
    }
}
