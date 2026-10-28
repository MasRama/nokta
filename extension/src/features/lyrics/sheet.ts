import Clutter from 'gi://Clutter';
import Pango from 'gi://Pango';
import St from 'gi://St';

import { setVertical } from '../../shared/compat.js';
import { BREAK } from './logic/visible.js';
import type { LyricWindow } from './logic/window.js';

/** The lyrics view's rows; the middle one is the current line. */
export const SHEET_ROWS = 7;
/** How much taller the open notch gets for the lyrics view. */
export const SHEET_EXTRA_HEIGHT = 150;
const ROW_HEIGHT = 20;
const SLIDE_MS = 220;
const DIM_OPACITY = 110;

/**
 * Seven lines of synced lyrics around the current one, which is bright and
 * a little larger. The lines slide up when the current line changes.
 */
export class LyricsSheet {
    readonly actor: St.Button;
    private readonly box: St.BoxLayout;
    private readonly rows: St.Label[] = [];
    private current: number | null = null;

    constructor(onClick: () => void) {
        this.box = setVertical(new St.BoxLayout({ style_class: 'nokta-lyrics-sheet', x_expand: true }));
        const middle = Math.floor(SHEET_ROWS / 2);
        for (let i = 0; i < SHEET_ROWS; i++) {
            const row = new St.Label({
                style_class: i === middle ? 'nokta-lyrics-row nokta-lyrics-current' : 'nokta-lyrics-row',
                x_expand: true,
                height: ROW_HEIGHT,
                opacity: i === middle ? 255 : DIM_OPACITY,
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

    show(window: LyricWindow): void {
        const middle = Math.floor(SHEET_ROWS / 2);
        window.rows.forEach((text, i) => {
            this.rows[i].text = i === middle && !text ? BREAK : text;
        });
        const previous = this.current;
        this.current = window.current;
        // One line on: slide the rows up from where the old ones were.
        if (previous === null || window.current !== previous + 1) return;
        this.box.remove_all_transitions();
        this.box.translation_y = ROW_HEIGHT;
        this.box.ease({ translation_y: 0, duration: SLIDE_MS, mode: Clutter.AnimationMode.EASE_OUT_QUAD });
    }

    /** Forgets the last line, so the next show() does not slide. */
    reset(): void {
        this.current = null;
        this.box.remove_all_transitions();
        this.box.translation_y = 0;
    }

    destroy(): void {
        this.actor.destroy();
    }
}
