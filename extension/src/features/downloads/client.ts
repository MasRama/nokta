import Gio from 'gi://Gio';
import type GLib from 'gi://GLib';

import { BUS_NAME, PATHS } from '../../shared/contracts.js';
import { downloadFrom, type Download } from './logic/download.js';

const INTERFACE = 'io.nokta.Downloads1';

/** io.nokta.Downloads1: files that finish downloading, from noktad. */
export class DownloadsClient {
    private connection: Gio.DBusConnection | null = null;
    private subscription = 0;

    constructor(private readonly onFinished: (download: Download) => void) {}

    attach(connection: Gio.DBusConnection): void {
        this.detach();
        this.connection = connection;
        this.subscription = connection.signal_subscribe(
            BUS_NAME,
            INTERFACE,
            'Finished',
            PATHS.Downloads1,
            null,
            Gio.DBusSignalFlags.NONE,
            (_connection, _sender, _path, _interface, _signal, parameters: GLib.Variant) => {
                const download = downloadFrom(parameters.deepUnpack());
                if (download) this.onFinished(download);
            },
        );
    }

    detach(): void {
        if (this.connection && this.subscription) this.connection.signal_unsubscribe(this.subscription);
        this.connection = null;
        this.subscription = 0;
    }
}
