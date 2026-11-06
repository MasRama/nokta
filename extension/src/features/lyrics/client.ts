import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import { LYRICS1_XML } from '../../generated/contracts.js';
import { PATHS, type LyricsStatus } from '../../shared/contracts.js';
import { cached, callMethod, makeProxy } from '../../shared/dbus.js';
import { Listeners } from '../../shared/listeners.js';
import type { LyricLines } from '../../shared/logic/lyrics.js';
import { versionsFrom, type LyricsVersion } from './logic/versions.js';

/** Search can make a few requests to LRCLIB, each up to 10 s. */
const SEARCH_TIMEOUT_MS = 45_000;

const isLine = (v: unknown): v is [number, string] =>
    Array.isArray(v) && v.length === 2 && typeof v[0] === 'number' && typeof v[1] === 'string';

/** io.nokta.Lyrics1: the lyrics of the active track. */
export class LyricsClient {
    status: LyricsStatus | string = 'none';
    lines: LyricLines = [];
    /** The track's lyric timing, already applied to `lines`; positive is earlier. */
    offsetMs = 0;
    /** The LRCLIB record picked for the track, 0 for the lyrics noktad finds itself. */
    choice = 0;
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

    /** Every version of the current track's lyrics, best first; null when the search fails. */
    search(): Promise<LyricsVersion[] | null> {
        const proxy = this.proxy;
        if (!proxy) return Promise.resolve(null);
        return new Promise((resolve) => {
            proxy.call('Search', null, Gio.DBusCallFlags.NONE, SEARCH_TIMEOUT_MS, null, (source, result) => {
                try {
                    resolve(versionsFrom(source!.call_finish(result).get_child_value(0).deep_unpack()));
                } catch (error) {
                    console.warn('Nokta: Search failed', error);
                    resolve(null);
                }
            });
        });
    }

    /** Shows the version with this id for the track from now on; 0 goes back to noktad's own. */
    choose(id: number): void {
        if (this.proxy) callMethod(this.proxy, 'Choose', new GLib.Variant('(x)', [Math.round(id)]));
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
        this.choice = 0;
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
        const choice = cached(this.proxy, 'Choice');
        this.status = typeof status === 'string' ? status : 'none';
        this.lines = Array.isArray(lines) ? lines.filter(isLine) : [];
        this.offsetMs = typeof offsetMs === 'number' ? offsetMs : 0;
        this.choice = typeof choice === 'number' ? choice : 0;
        this.listeners.emit();
    }
}
