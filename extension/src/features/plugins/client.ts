import type Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import { PLUGINS1_XML } from '../../generated/contracts.js';
import { PATHS } from '../../shared/contracts.js';
import { cached, callMethod, makeProxy } from '../../shared/dbus.js';
import { Listeners } from '../../shared/listeners.js';
import { cardsFrom, pluginAlert, pluginsFrom, type Plugin, type PluginAlert, type PluginCard } from './logic/plugins.js';

/** io.nokta.Plugins1 for the notch: the running plugins' cards and their alerts. */
export class PluginsClient {
    private proxy: Gio.DBusProxy | null = null;
    private readonly ids: number[] = [];
    private plugins: Plugin[] = [];
    private current: PluginCard[] = [];
    private readonly listeners = new Listeners();

    constructor(private readonly onAlert: (alert: PluginAlert) => void) {}

    /** In the order of the plugins' names. */
    cards(): readonly PluginCard[] {
        return this.current;
    }

    onChanged(callback: () => void): number {
        return this.listeners.add(callback);
    }

    disconnect(id: number): void {
        this.listeners.remove(id);
    }

    /** Runs the plugin `id` with `action`, from one of its card's buttons. */
    run(id: string, action: string): void {
        if (this.proxy) callMethod(this.proxy, 'Run', new GLib.Variant('(ss)', [id, action]));
    }

    async attach(connection: Gio.DBusConnection, cancellable: Gio.Cancellable): Promise<void> {
        const proxy = await makeProxy(PLUGINS1_XML, PATHS.Plugins1, connection, cancellable);
        this.detach();
        this.proxy = proxy;
        this.ids.push(proxy.connect('g-properties-changed', () => this.read()));
        this.ids.push(
            proxy.connect('g-signal', (_proxy, _sender: string | null, signal: string, parameters: GLib.Variant) => {
                if (signal !== 'Alert') return;
                const [id, title, detail, icon, tone, important] =
                    parameters.deepUnpack<[string, string, string, string, string, boolean]>();
                const plugin = this.plugins.find((p) => p.id === id);
                this.onAlert(pluginAlert(title, detail, icon, tone, important, plugin));
            }),
        );
        this.read();
    }

    /** Forgets the daemon; no cards show. */
    detach(): void {
        for (const id of this.ids) this.proxy?.disconnect(id);
        this.ids.length = 0;
        this.proxy = null;
        this.plugins = [];
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
        this.plugins = pluginsFrom(cached(proxy, 'Plugins'));
        this.current = cardsFrom(cached(proxy, 'Cards'), this.plugins);
        this.listeners.emit();
    }
}
