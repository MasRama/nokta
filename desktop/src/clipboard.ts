import { entriesFrom, type ClipboardEntry } from '@ext/features/clipboard/logic/entries.js';

import type { Bridge } from './bridge/bridge.js';
import { Follower } from './follower.js';

/** Clipboard1: the history of what was copied, newest first; the page's ClipboardClient. */
export class Clipboard extends Follower {
    entries: ClipboardEntry[] = [];
    paused = false;

    constructor(bridge: Bridge, onChanged: () => void) {
        super(bridge, 'Clipboard1', onChanged);
    }

    /** Puts an entry back on Windows' clipboard; the app writes it, as the extension does itself. */
    copy(id: string): void {
        this.call('Copy', id);
    }

    pin(id: string, pinned: boolean): void {
        this.call('Pin', id, pinned);
    }

    remove(id: string): void {
        this.call('Remove', id);
    }

    /** Removes every entry that is not pinned. */
    clear(): void {
        this.call('Clear');
    }

    setPaused(paused: boolean): void {
        this.call('SetPaused', paused);
    }

    protected override read(): void {
        this.entries = entriesFrom(this.props.Items);
        this.paused = this.props.Paused === true;
    }
}
