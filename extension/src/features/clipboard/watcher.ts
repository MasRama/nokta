import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import St from 'gi://St';

import type { ClipboardClient, ClipboardContent } from './client.js';
import { captureKind, MAX_IMAGE_BYTES } from './logic/entries.js';

/**
 * Hands each copy to noktad: text, or a PNG. Skips what a password manager
 * marks as secret, and everything while the history is off or paused.
 */
export class ClipboardWatcher {
    private readonly selection: Meta.Selection;
    private readonly ownerId: number;
    private stopped = false;

    constructor(
        private readonly client: ClipboardClient,
        private readonly enabled: () => boolean,
    ) {
        this.selection = global.display.get_selection();
        this.ownerId = this.selection.connect('owner-changed', (_selection, type: number, source) => {
            if (type === Meta.SelectionType.SELECTION_CLIPBOARD && source) this.onCopy();
        });
    }

    destroy(): void {
        this.stopped = true;
        this.selection.disconnect(this.ownerId);
    }

    private onCopy(): void {
        if (!this.enabled() || !this.client.connected || this.client.paused) return;
        const kind = captureKind(this.selection.get_mimetypes(Meta.SelectionType.SELECTION_CLIPBOARD));
        const clipboard = St.Clipboard.get_default();
        if (kind === 'text') {
            clipboard.get_text(St.ClipboardType.CLIPBOARD, (_clipboard, text) => {
                if (!this.stopped && text) this.client.addText(text);
            });
        } else if (kind === 'image') {
            clipboard.get_content(St.ClipboardType.CLIPBOARD, 'image/png', (_clipboard, content) => {
                const png = content instanceof GLib.Bytes ? content : new GLib.Bytes(content);
                const size = png.get_size();
                if (!this.stopped && size > 0 && size <= MAX_IMAGE_BYTES) this.client.addImage(png);
            });
        }
    }
}

/** Puts an entry back on the clipboard, for the next paste. */
export function copyToClipboard(content: ClipboardContent): void {
    const clipboard = St.Clipboard.get_default();
    if (content.kind === 'text') clipboard.set_text(St.ClipboardType.CLIPBOARD, content.text);
    else clipboard.set_content(St.ClipboardType.CLIPBOARD, 'image/png', content.png);
}
