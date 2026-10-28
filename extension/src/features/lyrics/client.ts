import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import { LYRICS1_XML } from '../../generated/contracts.js';
import { PATHS, type LyricsStatus } from '../../shared/contracts.js';
import { cached, callMethod, makeProxy } from '../../shared/dbus.js';
import { Listeners } from '../../shared/listeners.js';
import type { LyricLines } from '../../shared/logic/lyrics.js';

const isLine = (v: unknown): v is [number, string] =>
    Array.isArray(v) && v.length === 2 && typeof v[0] === 'number' && typeof v[1] === 'string';

/** io.nokta.Lyrics1: the lyrics of the active track. */
export class LyricsClient {
    status: LyricsStatus | string = 'none';
    lines: LyricLines = [];
    /** The track's lyric timing, already applied to `lines`; positive is earlier. */
    offsetMs = 0;
    private proxy: Gio.DBusProxy | null = null;
    private changedId = 0;
    private readonly listeners = new Listeners();

    onChanged(callback: () => void): number {
        return this.listeners.add(callback);
    }

    disconnect(id: number): void {
        this.listeners.remove(id);
    }

    /** Sets the current track's timing; the daemon sends the shifted lines. */
    setOffset(offsetMs: number): void {
        if (this.proxy) callMethod(this.proxy, 'SetOffset', new GLib.Variant('(x)', [Math.round(offsetMs)]));
    }

    async attach(connection: Gio.DBusConnection, cancellable: Gio.Cancellable): Promise<void> {
        const proxy = await makeProxy(LYRICS1_XML, PATHS.Lyrics1, connection, cancellable);
        this.detach();
        this.proxy = proxy;
        this.changedId = proxy.connect('g-properties-changed', () => this.read());
        this.read();
    }

    detach(): void {
        if (this.proxy) {
            this.proxy.disconnect(this.changedId);
            this.proxy = null;
            this.changedId = 0;
        }
        this.status = 'none';
        this.lines = [];
        this.offsetMs = 0;
        this.listeners.emit();
    }

    destroy(): void {
        this.listeners.clear();
        this.detach();
    }

    private read(): void {
        if (!this.proxy) return;
        const status = cached(this.proxy, 'Status');
        const lines = cached(this.proxy, 'Lines');
        const offsetMs = cached(this.proxy, 'OffsetMs');
        this.status = typeof status === 'string' ? status : 'none';
        this.lines = Array.isArray(lines) ? lines.filter(isLine) : [];
        this.offsetMs = typeof offsetMs === 'number' ? offsetMs : 0;
        this.listeners.emit();
    }
}
