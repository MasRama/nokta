import Gio from 'gi://Gio';
import type GLib from 'gi://GLib';

import { BUS_NAME, PATHS } from '../../shared/contracts.js';

const INTERFACE = 'io.nokta.Devices1';

/** One io.nokta.Devices1.Alert signal. */
export interface AlertSignal {
    kind: string;
    name: string;
    percentage: number;
}

/** io.nokta.Devices1: Bluetooth, charger and battery alerts from noktad. */
export class DevicesClient {
    private connection: Gio.DBusConnection | null = null;
    private subscription = 0;

    constructor(private readonly onAlert: (alert: AlertSignal) => void) {}

    attach(connection: Gio.DBusConnection): void {
        this.detach();
        this.connection = connection;
        this.subscription = connection.signal_subscribe(
            BUS_NAME,
            INTERFACE,
            'Alert',
            PATHS.Devices1,
            null,
            Gio.DBusSignalFlags.NONE,
            (_connection, _sender, _path, _interface, _signal, parameters: GLib.Variant) => {
                const [kind, name, percentage] = parameters.deepUnpack() as [string, string, number];
                this.onAlert({ kind, name, percentage });
            },
        );
    }

    detach(): void {
        if (this.connection && this.subscription) this.connection.signal_unsubscribe(this.subscription);
        this.connection = null;
        this.subscription = 0;
    }
}
