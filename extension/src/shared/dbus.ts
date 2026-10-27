import Gio from 'gi://Gio';

import { BUS_NAME } from './contracts.js';

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
    const Wrapper = Gio.DBusProxy.makeProxyWrapper(xml);
    return new Promise((resolve, reject) => {
        Wrapper(
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
