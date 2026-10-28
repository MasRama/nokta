import Clutter from 'gi://Clutter';
import Pango from 'gi://Pango';
import St from 'gi://St';

import { setVertical } from '../../shared/compat.js';
import { FillLabel } from './fill.js';
import type { LineProgress } from './logic/karaoke.js';
import { BREAK } from './logic/visible.js';
import type { LyricWindow } from './logic/window.js';

/** The lyrics view's rows; the middle one is the current line. */
export const SHEET_ROWS = 7;
const ROW_HEIGHT = 20;
/** The current line is larger, so it gets a taller row. */
const CURRENT_HEIGHT = 30;
/** How much taller the open notch gets for the lyrics view, with its padding. */
export const SHEET_EXTRA_HEIGHT = (SHEET_ROWS - 1) * ROW_HEIGHT + CURRENT_HEIGHT + 10;
const SLIDE_MS = 260;
/** Each row's opacity by its distance from the current line. */
const FADE = [255, 150, 95, 60];

/**
 * Seven lines of synced lyrics around the current one, which is larger
 * and lights up as it is sung; the others fade with their distance. The
 * lines slide up when the current line changes.
 */
export class LyricsSheet {
    readonly actor: St.Button;
    private readonly box: St.BoxLayout;
    private readonly rows: St.Label[] = [];
    private readonly current = new FillLabel('nokta-lyrics-row nokta-lyrics-current', CURRENT_HEIGHT);
    private shown: number | null = null;

    constructor(onClick: () => void) {
        this.box = setVertical(new St.BoxLayout({ style_class: 'nokta-lyrics-sheet', x_expand: true }));
        const middle = Math.floor(SHEET_ROWS / 2);
        for (let i = 0; i < SHEET_ROWS; i++) {
            if (i === middle) {
                this.box.add_child(this.current.actor);
                continue;
            }
            const row = new St.Label({
                style_class: 'nokta-lyrics-row',
                x_expand: true,
                height: ROW_HEIGHT,
                y_align: Clutter.ActorAlign.CENTER,
                opacity: FADE[Math.min(Math.abs(i - middle), FADE.length - 1)],
            });
            row.clutter_text.ellipsize = Pango.EllipsizeMode.END;
            this.rows.push(row);
            this.box.add_child(row);
        }
        this.actor = new St.Button({
            style_class: 'nokta-lyrics-sheet-button',
            child: this.box,
            x_expand: true,
            visible: false,
        });
        this.actor.connect('clicked', onClick);
    }

    setWidth(width: number): void {
        this.current.setWidth(width);
    }

    show(window: LyricWindow, progress: LineProgress, playing: boolean): void {
        const middle = Math.floor(SHEET_ROWS / 2);
        const others = window.rows.filter((_, i) => i !== middle);
        others.forEach((text, i) => (this.rows[i].text = text));
        const text = window.rows[middle] || BREAK;
        this.current.show(text, window.current, progress.fraction, progress.msLeft, playing);
        const previous = this.shown;
        this.shown = window.current;
        // One line on: slide the rows up from where the old ones were.
        if (previous === null || window.current !== previous + 1) return;
        this.box.remove_all_transitions();
        this.box.translation_y = ROW_HEIGHT;
        this.box.ease({ translation_y: 0, duration: SLIDE_MS, mode: Clutter.AnimationMode.EASE_OUT_CUBIC });
    }

    /** Forgets the last line, so the next show() does not slide. */
    reset(): void {
        this.shown = null;
        this.box.remove_all_transitions();
        this.box.translation_y = 0;
    }

    destroy(): void {
        this.current.destroy();
        this.actor.destroy();
    }
}
