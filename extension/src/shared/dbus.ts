import Gio from 'gi://Gio';
import type GLib from 'gi://GLib';

import { NOKTA1_XML } from '../generated/contracts.js';
import { BUS_NAME, PATHS } from './contracts.js';

/**
 * Follows io.nokta.Nokta on the session bus, starting the daemon through
 * D-Bus activation if it is installed. Returns the watch id.
 */
export function watchDaemon(
    onAppear: (connection: Gio.DBusConnection) => void,
    onVanish: () => void,
): number {
    return Gio.bus_watch_name(
        Gio.BusType.SESSION,
        BUS_NAME,
        Gio.BusNameWatcherFlags.AUTO_START,
        (connection) => onAppear(connection),
        () => onVanish(),
    );
}

export function unwatchDaemon(id: number): void {
    Gio.bus_unwatch_name(id);
}

type ProxyArgs = Parameters<ReturnType<typeof Gio.DBusProxy.makeProxyWrapper>>;

/**
 * A proxy from `Gio.DBusProxy.makeProxyWrapper(xml)`. GJS in GNOME 51 makes
 * the wrapper a class and warns when it is called without `new`; before, it
 * is a function returning the proxy, which `new` returns as well.
 */
export function newProxy(xml: string, ...args: ProxyArgs): Gio.DBusProxy {
    const Wrapper = Gio.DBusProxy.makeProxyWrapper(xml) as unknown as new (...args: ProxyArgs) => Gio.DBusProxy;
    return new Wrapper(...args);
}

/**
 * Builds a proxy for one io.nokta interface without blocking the shell.
 * The proxy caches all properties and emits g-properties-changed.
 */
export function makeProxy<T extends Gio.DBusProxy>(
    xml: string,
    path: string,
    connection: Gio.DBusConnection,
    cancellable: Gio.Cancellable,
): Promise<T> {
    return new Promise((resolve, reject) => {
        newProxy(
            xml,
            connection,
            BUS_NAME,
            path,
            (proxy: Gio.DBusProxy | null, error: unknown) => (error || !proxy ? reject(error) : resolve(proxy as T)),
            cancellable,
            Gio.DBusProxyFlags.DO_NOT_AUTO_START,
        );
    });
}

/** Unpacks one cached property, or undefined when the proxy has none. */
export function cached(proxy: Gio.DBusProxy, name: string): unknown {
    return proxy.get_cached_property(name)?.recursiveUnpack();
}

/** Calls a method without waiting for it; failures are logged, not thrown. */
export function callMethod(proxy: Gio.DBusProxy, method: string, params: GLib.Variant | null = null): void {
    proxy.call(method, params, Gio.DBusCallFlags.NONE, -1, null, (source, result) => {
        try {
            source?.call_finish(result);
        } catch (error) {
            console.warn(`Nokta: ${method} failed`, error);
        }
    });
}

/** io.nokta.Nokta1: the API version, null when the daemon does not say, and the daemon's own version. */
export async function readDaemon(
    connection: Gio.DBusConnection,
    cancellable: Gio.Cancellable,
): Promise<{ apiVersion: number | null; daemonVersion: string }> {
    const proxy = await makeProxy(NOKTA1_XML, PATHS.Nokta1, connection, cancellable);
    const apiVersion = cached(proxy, 'ApiVersion');
    const daemonVersion = cached(proxy, 'DaemonVersion');
    return {
        apiVersion: typeof apiVersion === 'number' ? apiVersion : null,
        daemonVersion: typeof daemonVersion === 'string' ? daemonVersion : '',
    };
}
