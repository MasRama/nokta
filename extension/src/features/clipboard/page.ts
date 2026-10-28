import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Pango from 'gi://Pango';
import St from 'gi://St';

import { setVertical } from '../../shared/compat.js';
import { withAlpha } from '../../shared/logic/color.js';
import {
    ageLabel,
    listHeight,
    MAX_VISIBLE_ROWS,
    ROW_HEIGHT,
    scrolled,
    type ClipboardEntry,
} from './logic/entries.js';

export interface ClipboardPageHandlers {
    copy(id: string): void;
    pin(id: string, pinned: boolean): void;
    remove(id: string): void;
    clear(): void;
    setPaused(paused: boolean): void;
}

const THUMBNAIL_SIZE = 24;

/**
 * The clipboard page's body: the newest copies, five at a time (scroll for
 * older ones). A click puts one back on the clipboard; each row can be
 * pinned or removed. `actions` go in the page's header: pause and clear.
 */
export class ClipboardPage {
    readonly actor: St.BoxLayout;
    readonly actions: St.Button[];
    private readonly pauseButton: St.Button;
    private entries: readonly ClipboardEntry[] = [];
    private paused = false;
    private offset = 0;
    private foreground = '#ffffff';
    private accent = '#ffffff';
    private smoothScroll = 0;

    constructor(private readonly handlers: ClipboardPageHandlers) {
        this.actor = setVertical(new St.BoxLayout({ style_class: 'nokta-clip-list', reactive: true }));
        this.actor.connect('scroll-event', (_actor, event: Clutter.Event) => this.onScroll(event));
        this.pauseButton = this.iconButton('media-playback-pause-symbolic', () => handlers.setPaused(!this.paused));
        const clear = this.iconButton('edit-clear-all-symbolic', () => handlers.clear());
        this.actions = [this.pauseButton, clear];
    }

    /** The body's height for the history now shown. */
    get height(): number {
        return listHeight(this.entries.length);
    }

    show(entries: readonly ClipboardEntry[], paused: boolean): void {
        this.entries = entries;
        this.paused = paused;
        this.offset = scrolled(this.offset, 0, entries.length);
        this.build();
    }

    setColors({ foreground, accent }: { foreground: string; accent: string }): void {
        this.foreground = foreground;
        this.accent = accent;
        this.build();
    }

    /** Back at the newest copy, for the next time the page opens. */
    reset(): void {
        this.offset = 0;
        this.build();
    }

    destroy(): void {
        this.actor.destroy();
    }

    private build(): void {
        this.actor.destroy_all_children();
        // Paused shows the way back: a play button in the accent.
        const pauseIcon = this.pauseButton.child as St.Icon;
        pauseIcon.icon_name = this.paused ? 'media-playback-start-symbolic' : 'media-playback-pause-symbolic';
        pauseIcon.style = this.paused ? `color: ${this.accent};` : '';
        this.pauseButton.opacity = this.paused ? 255 : 150;
        if (this.entries.length === 0) {
            const note = new St.Label({
                style_class: 'nokta-clip-empty',
                text: this.paused ? 'Paused: copies are not kept' : 'Nothing copied yet',
                height: ROW_HEIGHT,
                y_align: Clutter.ActorAlign.CENTER,
                style: `color: ${withAlpha(this.foreground, 0.6)};`,
            });
            note.clutter_text.y_align = Clutter.ActorAlign.CENTER;
            this.actor.add_child(note);
            return;
        }
        const nowUs = GLib.get_real_time();
        for (const entry of this.entries.slice(this.offset, this.offset + MAX_VISIBLE_ROWS)) {
            this.actor.add_child(this.row(entry, nowUs));
        }
    }

    private row(entry: ClipboardEntry, nowUs: number): St.BoxLayout {
        const row = new St.BoxLayout({ style_class: 'nokta-clip-row', height: ROW_HEIGHT });
        const content = new St.BoxLayout({ style_class: 'nokta-clip-content', x_expand: true });
        content.add_child(this.picture(entry));
        const preview = new St.Label({
            style_class: 'nokta-clip-preview',
            text: entry.kind === 'image' ? `Picture · ${entry.preview}` : entry.preview,
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        preview.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        content.add_child(preview);
        content.add_child(
            new St.Label({
                style_class: 'nokta-clip-age',
                text: ageLabel(nowUs, entry.timeUs),
                y_align: Clutter.ActorAlign.CENTER,
                style: `color: ${withAlpha(this.foreground, 0.55)};`,
            }),
        );
        const copy = new St.Button({
            style_class: 'nokta-clip-entry',
            child: content,
            x_expand: true,
            x_align: Clutter.ActorAlign.FILL,
            can_focus: true,
        });
        copy.connect('clicked', () => this.handlers.copy(entry.id));
        row.add_child(copy);
        const pin = this.iconButton('view-pin-symbolic', () => this.handlers.pin(entry.id, !entry.pinned));
        pin.add_style_class_name('nokta-clip-pin');
        (pin.child as St.Icon).style = entry.pinned ? `color: ${this.accent};` : '';
        pin.opacity = entry.pinned ? 255 : 110;
        row.add_child(pin);
        const remove = this.iconButton('window-close-symbolic', () => this.handlers.remove(entry.id));
        remove.opacity = 150;
        row.add_child(remove);
        return row;
    }

    private picture(entry: ClipboardEntry): St.Widget {
        if (entry.thumbnail) {
            // A file URI is percent-encoded, so quotes in the path cannot
            // break out of the CSS string.
            const uri = GLib.filename_to_uri(entry.thumbnail, null);
            return new St.Bin({
                style_class: 'nokta-clip-thumbnail',
                style: `background-image: url("${uri}"); background-size: cover;`,
                width: THUMBNAIL_SIZE,
                height: THUMBNAIL_SIZE,
                y_align: Clutter.ActorAlign.CENTER,
            });
        }
        return new St.Icon({
            style_class: 'nokta-clip-icon',
            icon_name: entry.kind === 'image' ? 'image-x-generic-symbolic' : 'edit-paste-symbolic',
            y_align: Clutter.ActorAlign.CENTER,
        });
    }

    private iconButton(icon: string, onClick: () => void): St.Button {
        const button = new St.Button({
            style_class: 'nokta-button nokta-clip-button',
            child: new St.Icon({ icon_name: icon, style_class: 'nokta-clip-button-icon' }),
            y_align: Clutter.ActorAlign.CENTER,
            can_focus: true,
        });
        button.connect('clicked', onClick);
        return button;
    }

    private onScroll(event: Clutter.Event): boolean {
        let step = 0;
        const direction = event.get_scroll_direction();
        if (direction === Clutter.ScrollDirection.UP) step = -1;
        else if (direction === Clutter.ScrollDirection.DOWN) step = 1;
        else if (direction === Clutter.ScrollDirection.SMOOTH) {
            this.smoothScroll += event.get_scroll_delta()[1];
            step = Math.trunc(this.smoothScroll);
            this.smoothScroll -= step;
        }
        const offset = scrolled(this.offset, step, this.entries.length);
        if (offset !== this.offset) {
            this.offset = offset;
            this.build();
        }
        return Clutter.EVENT_STOP;
    }
}
