import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Pango from 'gi://Pango';
import St from 'gi://St';

import { setVertical } from '../../shared/compat.js';
import { withAlpha } from '../../shared/logic/color.js';
import {
    ageLabel,
    entryIcon,
    entryText,
    filterEntries,
    MAX_VISIBLE_ROWS,
    pageHeight,
    ROW_HEIGHT,
    scrolled,
    SEARCH_HEIGHT,
    type ClipboardEntry,
} from './logic/entries.js';
import { iconFor } from '../../shared/icons.js';
import { SECONDARY, TERTIARY } from '../../shared/dim.js';
import { _ } from '../../shared/logic/i18n.js';

export interface ClipboardPageHandlers {
    copy(id: string): void;
    pin(id: string, pinned: boolean): void;
    remove(id: string): void;
    clear(): void;
    setPaused(paused: boolean): void;
    /** The search field opened, and wants the keyboard, or closed. */
    searching(entry: St.Entry | null): void;
    /** The page's height changed while it shows. */
    resized(): void;
}

const THUMBNAIL_SIZE = 24;

/**
 * The clipboard page's body: the newest copies, five at a time (scroll for
 * older ones). A click puts one back on the clipboard; each row can be
 * pinned or removed. `actions` go in the page's header: search, pause and
 * clear. While searching, a field over the list filters it as you type;
 * Enter copies the first match, Escape closes the field.
 */
export class ClipboardPage {
    readonly actor: St.BoxLayout;
    readonly actions: St.Button[];
    private readonly list: St.BoxLayout;
    private readonly search: St.Entry;
    private readonly searchButton: St.Button;
    private readonly pauseButton: St.Button;
    private entries: readonly ClipboardEntry[] = [];
    private searching = false;
    private paused = false;
    private offset = 0;
    private foreground = '#ffffff';
    private accent = '#ffffff';
    private smoothScroll = 0;

    constructor(private readonly handlers: ClipboardPageHandlers) {
        this.actor = setVertical(new St.BoxLayout({ style_class: 'nokta-clip-page' }));
        this.search = new St.Entry({
            style_class: 'nokta-clip-search',
            hint_text: _('Search copies'),
            can_focus: true,
            height: SEARCH_HEIGHT,
            visible: false,
            primary_icon: new St.Icon({ gicon: iconFor('edit-find-symbolic'), style_class: 'nokta-clip-search-icon' }),
        });
        this.search.clutter_text.connect('text-changed', () => this.onQuery());
        this.search.clutter_text.connect('activate', () => this.copyFirstMatch());
        this.search.clutter_text.connect('key-press-event', (_actor, event: Clutter.Event) => {
            if (event.get_key_symbol() !== Clutter.KEY_Escape) return Clutter.EVENT_PROPAGATE;
            this.setSearching(false);
            return Clutter.EVENT_STOP;
        });
        this.list = setVertical(new St.BoxLayout({ style_class: 'nokta-clip-list', reactive: true }));
        this.list.connect('scroll-event', (_actor, event: Clutter.Event) => this.onScroll(event));
        this.actor.add_child(this.search);
        this.actor.add_child(this.list);
        this.searchButton = this.iconButton('edit-find-symbolic', () => this.setSearching(!this.searching));
        this.searchButton.add_style_class_name('nokta-clip-search-button');
        this.searchButton.opacity = 150;
        this.pauseButton = this.iconButton('media-playback-pause-symbolic', () => handlers.setPaused(!this.paused));
        const clear = this.iconButton('edit-clear-all-symbolic', () => handlers.clear());
        this.actions = [this.searchButton, this.pauseButton, clear];
    }

    /** The body's height for the history now shown. */
    get height(): number {
        return pageHeight(this.shown().length, this.searching);
    }

    show(entries: readonly ClipboardEntry[], paused: boolean): void {
        this.entries = entries;
        this.paused = paused;
        this.offset = scrolled(this.offset, 0, this.shown().length);
        this.build();
    }

    setColors({ foreground, accent }: { foreground: string; accent: string }): void {
        this.foreground = foreground;
        this.accent = accent;
        this.search.style =
            `background-color: ${withAlpha(foreground, 0.1)}; color: ${foreground}; ` +
            `border: 1px solid ${withAlpha(accent, 0.5)}; box-shadow: none; ` +
            `caret-color: ${foreground}; selection-background-color: ${withAlpha(accent, 0.5)}; ` +
            `selected-color: ${foreground};`;
        const hint = this.search.hint_actor as St.Widget | null;
        if (hint) hint.style = `color: ${withAlpha(foreground, 0.45)};`;
        (this.search.primary_icon as St.Icon).style = `color: ${withAlpha(foreground, 0.6)};`;
        this.build();
    }

    /** Back at the newest copy with no search, for the next time the page opens. */
    reset(): void {
        this.offset = 0;
        this.setSearching(false);
        this.build();
    }

    destroy(): void {
        this.setSearching(false);
        this.actor.destroy();
    }

    /** The entries the list shows: all, or the matches while searching. */
    private shown(): readonly ClipboardEntry[] {
        return this.searching ? filterEntries(this.entries, this.search.text) : this.entries;
    }

    private setSearching(on: boolean): void {
        if (on === this.searching) return;
        this.searching = on;
        this.search.visible = on;
        this.search.text = '';
        this.offset = 0;
        const icon = this.searchButton.child as St.Icon;
        icon.style = on ? `color: ${this.accent};` : '';
        this.searchButton.opacity = on ? 255 : 150;
        this.build();
        this.handlers.searching(on ? this.search : null);
        this.handlers.resized();
    }

    private onQuery(): void {
        if (!this.searching) return;
        this.offset = 0;
        this.build();
        // The text has already changed, so the height before it is unknown here.
        this.handlers.resized();
    }

    private copyFirstMatch(): void {
        const first = this.shown()[0];
        if (!first) return;
        this.setSearching(false);
        this.handlers.copy(first.id);
    }

    private build(): void {
        this.list.destroy_all_children();
        // Paused shows the way back: a play button in the accent.
        const pauseIcon = this.pauseButton.child as St.Icon;
        pauseIcon.gicon = iconFor(this.paused ? 'media-playback-start-symbolic' : 'media-playback-pause-symbolic');
        pauseIcon.style = this.paused ? `color: ${this.accent};` : '';
        this.pauseButton.opacity = this.paused ? 255 : 150;
        const shown = this.shown();
        if (shown.length === 0) {
            const empty = this.paused ? _('Paused: copies are not kept') : _('Nothing copied yet');
            const note = new St.Label({
                style_class: 'nokta-clip-empty',
                text: this.entries.length > 0 ? _('No match') : empty,
                height: ROW_HEIGHT,
                y_align: Clutter.ActorAlign.CENTER,
                style: `color: ${withAlpha(this.foreground, 0.6)};`,
            });
            note.clutter_text.y_align = Clutter.ActorAlign.CENTER;
            this.list.add_child(note);
            return;
        }
        const nowUs = GLib.get_real_time();
        for (const entry of shown.slice(this.offset, this.offset + MAX_VISIBLE_ROWS)) {
            this.list.add_child(this.row(entry, nowUs));
        }
    }

    private row(entry: ClipboardEntry, nowUs: number): St.BoxLayout {
        const row = new St.BoxLayout({ style_class: 'nokta-clip-row', height: ROW_HEIGHT });
        const content = new St.BoxLayout({ style_class: 'nokta-clip-content', x_expand: true });
        content.add_child(this.picture(entry));
        const preview = new St.Label({
            style_class: 'nokta-clip-preview',
            text: entryText(entry),
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
        pin.opacity = entry.pinned ? 255 : TERTIARY;
        row.add_child(pin);
        const remove = this.iconButton('window-close-symbolic', () => this.handlers.remove(entry.id));
        remove.opacity = SECONDARY;
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
            gicon: iconFor(entryIcon(entry)),
            y_align: Clutter.ActorAlign.CENTER,
        });
    }

    private iconButton(icon: string, onClick: () => void): St.Button {
        const button = new St.Button({
            style_class: 'nokta-button nokta-clip-button',
            child: new St.Icon({ gicon: iconFor(icon), style_class: 'nokta-clip-button-icon' }),
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
        const offset = scrolled(this.offset, step, this.shown().length);
        if (offset !== this.offset) {
            this.offset = offset;
            this.build();
        }
        return Clutter.EVENT_STOP;
    }
}
