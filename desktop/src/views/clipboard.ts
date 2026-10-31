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
} from '@ext/features/clipboard/logic/entries.js';
import { SECONDARY, TERTIARY } from '@ext/shared/dim.js';
import { withAlpha } from '@ext/shared/logic/color.js';
import { _ } from '@ext/shared/logic/i18n.js';

import { icon, setIcon } from '../icons.js';

const ICON_SIZE = 16;
const BUTTON_ICON_SIZE = 14;
/** A wheel moves this many CSS px, or lines, per row. */
const WHEEL_PX_PER_ROW = 100;
const WHEEL_LINES_PER_ROW = 3;

export interface ClipboardPageHandlers {
    copy(id: string): void;
    pin(id: string, pinned: boolean): void;
    remove(id: string): void;
    clear(): void;
    setPaused(paused: boolean): void;
    /** The search field opened, and wants the keyboard, or closed. */
    searching(field: HTMLInputElement | null): void;
    /** The page's height changed while it shows. */
    resized(): void;
}

/** St's opacity (0-255) as CSS's. */
const opacity = (value: number): string => String(value / 255);

/**
 * The clipboard page's body: the newest copies, five at a time (the wheel
 * scrolls to older ones). A click puts one back on the clipboard; each row
 * can be pinned or removed. `actions` go in the page's header: search,
 * pause and clear. While searching, a field over the list filters it as you
 * type; Enter copies the first match, Escape closes the field. As the
 * extension's clipboard/page.ts.
 */
export class ClipboardPage {
    readonly element: HTMLDivElement;
    readonly actions: HTMLButtonElement[];
    private readonly list: HTMLDivElement;
    private readonly searchBox: HTMLLabelElement;
    private readonly search: HTMLInputElement;
    private readonly searchButton: HTMLButtonElement;
    private readonly pauseButton: HTMLButtonElement;
    private entries: readonly ClipboardEntry[] = [];
    private searching = false;
    private paused = false;
    private offset = 0;
    private foreground = '#ffffff';
    private accent = '#ffffff';
    private wheel = 0;

    constructor(
        private readonly handlers: ClipboardPageHandlers,
        /** A thumbnail's path as a URL the page loads. */
        private readonly url: (path: string) => string,
        /** Now, in µs since the Unix epoch. */
        private readonly nowUs: () => number = () => Date.now() * 1000,
    ) {
        this.search = document.createElement('input');
        this.search.className = 'nokta-clip-search-field';
        this.search.type = 'text';
        this.search.placeholder = _('Search copies');
        this.search.spellcheck = false;
        this.search.addEventListener('input', () => this.onQuery());
        this.search.addEventListener('keydown', (e) => this.onSearchKey(e));
        this.searchBox = document.createElement('label');
        this.searchBox.className = 'nokta-clip-search';
        this.searchBox.style.height = `${SEARCH_HEIGHT}px`;
        this.searchBox.hidden = true;
        this.searchBox.append(icon('edit-find-symbolic', BUTTON_ICON_SIZE), this.search);
        this.list = document.createElement('div');
        this.list.className = 'nokta-clip-list';
        this.list.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
        this.element = document.createElement('div');
        this.element.className = 'nokta-clip-page';
        this.element.append(this.searchBox, this.list);
        this.searchButton = this.iconButton('edit-find-symbolic', _('Search copies'), () =>
            this.setSearching(!this.searching),
        );
        this.pauseButton = this.iconButton('media-playback-pause-symbolic', '', () => handlers.setPaused(!this.paused));
        const clear = this.iconButton('edit-clear-all-symbolic', '', () => handlers.clear());
        this.actions = [this.searchButton, this.pauseButton, clear];
        this.build();
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
        this.searchBox.style.backgroundColor = withAlpha(foreground, 0.1);
        this.searchBox.style.borderColor = withAlpha(accent, 0.5);
        this.searchBox.style.color = withAlpha(foreground, 0.6);
        this.search.style.color = foreground;
        this.search.style.caretColor = foreground;
        this.element.style.setProperty('--nokta-clip-hint', withAlpha(foreground, 0.45));
        this.element.style.setProperty('--nokta-clip-selection', withAlpha(accent, 0.5));
        this.build();
    }

    /** Back at the newest copy with no search, for the next time the page opens. */
    reset(): void {
        this.offset = 0;
        this.setSearching(false);
        this.build();
    }

    /** The entries the list shows: all, or the matches while searching. */
    private shown(): readonly ClipboardEntry[] {
        return this.searching ? filterEntries(this.entries, this.search.value) : this.entries;
    }

    private setSearching(on: boolean): void {
        if (on === this.searching) return;
        this.searching = on;
        this.searchBox.hidden = !on;
        this.search.value = '';
        this.offset = 0;
        this.build();
        this.handlers.searching(on ? this.search : null);
        this.handlers.resized();
    }

    private onQuery(): void {
        if (!this.searching) return;
        this.offset = 0;
        this.build();
        this.handlers.resized();
    }

    private onSearchKey(event: KeyboardEvent): void {
        // The field's own keys: the notch's Escape and arrows do not see them.
        event.stopPropagation();
        if (event.key === 'Escape') {
            event.preventDefault();
            this.setSearching(false);
        } else if (event.key === 'Enter') {
            event.preventDefault();
            this.copyFirstMatch();
        }
    }

    private copyFirstMatch(): void {
        const first = this.shown()[0];
        if (!first) return;
        this.setSearching(false);
        this.handlers.copy(first.id);
    }

    private build(): void {
        // Paused shows the way back: a play button in the accent.
        this.light(this.searchButton, this.searching);
        setIcon(
            this.pauseButton.firstElementChild as HTMLElement,
            this.paused ? 'media-playback-start-symbolic' : 'media-playback-pause-symbolic',
            BUTTON_ICON_SIZE,
        );
        this.pauseButton.title = this.paused ? _('Resume') : _('Pause');
        this.light(this.pauseButton, this.paused);
        const shown = this.shown();
        if (shown.length === 0) {
            const note = document.createElement('span');
            note.className = 'nokta-clip-empty';
            note.style.height = `${ROW_HEIGHT}px`;
            note.style.color = withAlpha(this.foreground, 0.6);
            const empty = this.paused ? _('Paused: copies are not kept') : _('Nothing copied yet');
            note.textContent = this.entries.length > 0 ? _('No match') : empty;
            this.list.replaceChildren(note);
            return;
        }
        const now = this.nowUs();
        this.list.replaceChildren(
            ...shown.slice(this.offset, this.offset + MAX_VISIBLE_ROWS).map((entry) => this.row(entry, now)),
        );
    }

    /** A header button in the accent while on, dimmed while off. */
    private light(button: HTMLButtonElement, on: boolean): void {
        button.style.color = on ? this.accent : '';
        button.style.opacity = on ? '1' : opacity(SECONDARY);
    }

    private row(entry: ClipboardEntry, nowUs: number): HTMLElement {
        const row = document.createElement('div');
        row.className = 'nokta-clip-row';
        row.style.height = `${ROW_HEIGHT}px`;
        const copy = document.createElement('button');
        copy.className = 'nokta-clip-entry';
        const preview = document.createElement('span');
        preview.className = 'nokta-clip-preview';
        preview.textContent = entryText(entry);
        const age = document.createElement('span');
        age.className = 'nokta-clip-age';
        age.textContent = ageLabel(nowUs, entry.timeUs);
        age.style.color = withAlpha(this.foreground, 0.55);
        copy.append(this.picture(entry), preview, age);
        copy.addEventListener('click', () => this.handlers.copy(entry.id));
        const pin = this.iconButton('view-pin-symbolic', '', () => this.handlers.pin(entry.id, !entry.pinned));
        pin.classList.add('nokta-clip-pin');
        pin.style.color = entry.pinned ? this.accent : '';
        pin.style.opacity = entry.pinned ? '1' : opacity(TERTIARY);
        const remove = this.iconButton('window-close-symbolic', _('Remove'), () => this.handlers.remove(entry.id));
        remove.style.opacity = opacity(SECONDARY);
        row.append(copy, pin, remove);
        return row;
    }

    private picture(entry: ClipboardEntry): HTMLElement {
        if (entry.thumbnail) {
            const picture = document.createElement('span');
            picture.className = 'nokta-clip-thumbnail';
            picture.style.backgroundImage = `url("${this.url(entry.thumbnail)}")`;
            return picture;
        }
        const glyph = icon(entryIcon(entry), ICON_SIZE);
        glyph.classList.add('nokta-clip-icon');
        return glyph;
    }

    private iconButton(name: string, title: string, onClick: () => void): HTMLButtonElement {
        const button = document.createElement('button');
        button.className = 'nokta-button nokta-clip-button';
        if (title) button.title = title;
        button.append(icon(name, BUTTON_ICON_SIZE));
        button.addEventListener('click', onClick);
        return button;
    }

    private onWheel(event: WheelEvent): void {
        event.preventDefault();
        // 0 is pixels, 1 lines, 2 pages.
        const perRow = [WHEEL_PX_PER_ROW, WHEEL_LINES_PER_ROW, 1 / MAX_VISIBLE_ROWS][event.deltaMode] ?? 1;
        this.wheel += event.deltaY / perRow;
        const step = Math.trunc(this.wheel);
        this.wheel -= step;
        const offset = scrolled(this.offset, step, this.shown().length);
        if (offset !== this.offset) {
            this.offset = offset;
            this.build();
        }
    }
}
