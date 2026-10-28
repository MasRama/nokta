import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import { CLIPBOARD1_XML } from '../../generated/contracts.js';
import { PATHS } from '../../shared/contracts.js';
import { cached, callMethod, makeProxy } from '../../shared/dbus.js';
import { Listeners } from '../../shared/listeners.js';
import { entriesFrom, type ClipboardEntry } from './logic/entries.js';

/** What Get gives back: the text, or a PNG. */
export type ClipboardContent = { kind: 'text'; text: string } | { kind: 'image'; png: GLib.Bytes };

/** io.nokta.Clipboard1: the history noktad keeps of what was copied. */
export class ClipboardClient {
    private proxy: Gio.DBusProxy | null = null;
    private changedId = 0;
    private current: ClipboardEntry[] = [];
    private pausedNow = false;
    private readonly listeners = new Listeners();

    /** Newest first. */
    entries(): readonly ClipboardEntry[] {
        return this.current;
    }

    get paused(): boolean {
        return this.pausedNow;
    }

    get connected(): boolean {
        return this.proxy !== null;
    }

    onChanged(callback: () => void): number {
        return this.listeners.add(callback);
    }

    disconnect(id: number): void {
        this.listeners.remove(id);
    }

    async attach(connection: Gio.DBusConnection, cancellable: Gio.Cancellable): Promise<void> {
        const proxy = await makeProxy(CLIPBOARD1_XML, PATHS.Clipboard1, connection, cancellable);
        this.detach();
        this.proxy = proxy;
        this.changedId = proxy.connect('g-properties-changed', () => this.read());
        this.read();
    }

    addText(text: string): void {
        if (this.proxy) callMethod(this.proxy, 'Add', new GLib.Variant('(ssay)', ['text', text, []]));
    }

    /** `png` goes to noktad as it is, without a copy in JavaScript. */
    addImage(png: GLib.Bytes): void {
        if (!this.proxy) return;
        const params = GLib.Variant.new_tuple([
            GLib.Variant.new_string('image'),
            GLib.Variant.new_string(''),
            GLib.Variant.new_from_bytes(new GLib.VariantType('ay'), png, true),
        ]);
        callMethod(this.proxy, 'Add', params);
    }

    /** One entry's content; null when it is gone or noktad is away. */
    get(id: string): Promise<ClipboardContent | null> {
        const proxy = this.proxy;
        if (!proxy) return Promise.resolve(null);
        return new Promise((resolve) => {
            proxy.call('Get', new GLib.Variant('(s)', [id]), Gio.DBusCallFlags.NONE, -1, null, (source, result) => {
                try {
                    const reply = source!.call_finish(result);
                    const kind = reply.get_child_value(0).get_string()[0];
                    if (kind === 'text') resolve({ kind, text: reply.get_child_value(1).get_string()[0] });
                    else if (kind === 'image') resolve({ kind, png: reply.get_child_value(2).get_data_as_bytes() });
                    else resolve(null);
                } catch {
                    resolve(null);
                }
            });
        });
    }

    pin(id: string, pinned: boolean): void {
        if (this.proxy) callMethod(this.proxy, 'Pin', new GLib.Variant('(sb)', [id, pinned]));
    }

    remove(id: string): void {
        if (this.proxy) callMethod(this.proxy, 'Remove', new GLib.Variant('(s)', [id]));
    }

    clear(): void {
        if (this.proxy) callMethod(this.proxy, 'Clear');
    }

    setPaused(paused: boolean): void {
        if (this.proxy) callMethod(this.proxy, 'SetPaused', new GLib.Variant('(b)', [paused]));
    }

    /** Forgets the daemon; the history shows empty. */
    detach(): void {
        if (this.changedId) this.proxy?.disconnect(this.changedId);
        this.changedId = 0;
        this.proxy = null;
        this.current = [];
        this.pausedNow = false;
        this.listeners.emit();
    }

    destroy(): void {
        this.listeners.clear();
        this.detach();
    }

    private read(): void {
        const proxy = this.proxy;
        if (!proxy) return;
        this.current = entriesFrom(cached(proxy, 'Items'));
        this.pausedNow = cached(proxy, 'Paused') === true;
        this.listeners.emit();
    }
}
