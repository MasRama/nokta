import Clutter from 'gi://Clutter';
import Pango from 'gi://Pango';
import St from 'gi://St';

import { setVertical } from '../../shared/compat.js';
import { FillLabel } from './fill.js';

/** How much taller the open player gets while it shows the lyric row. */
export const LYRIC_ROW_EXTRA = 44;
const CURRENT_HEIGHT = 20;
const SLIDE_PX = 8;
const SLIDE_MS = 220;
/** The next line, out of 255. */
const NEXT_OPACITY = 115;

/** The lyric the row shows. */
export interface LyricNow {
    text: string;
    /** The next line with words, or null after the last. */
    next: string | null;
    /** The current line's index, to tell lines apart. */
    index: number;
    fraction: number;
    msLeft: number;
    playing: boolean;
}

/**
 * The open player's lyric row: the current line, large and lighting up as
 * it is sung, and the next one under it, dimmed. A new line slides up into
 * place. A click calls `onClick`.
 */
export class LyricLine {
    readonly actor: St.Button;
    private readonly box: St.BoxLayout;
    private readonly current = new FillLabel('nokta-lyric', CURRENT_HEIGHT);
    private readonly next: St.Label;
    private index: number | null = null;

    constructor(onClick: () => void) {
        this.box = setVertical(new St.BoxLayout({ style_class: 'nokta-lyric-box', x_expand: true }));
        this.next = new St.Label({ style_class: 'nokta-lyric-next', x_expand: true, opacity: NEXT_OPACITY });
        this.next.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        this.box.add_child(this.current.actor);
        this.box.add_child(this.next);
        this.actor = new St.Button({
            style_class: 'nokta-lyric-button',
            child: this.box,
            x_expand: true,
            visible: false,
        });
        this.actor.connect('clicked', onClick);
    }

    setWidth(width: number): void {
        this.current.setWidth(width);
        this.next.width = width;
    }

    /** Shows the lyric, or hides the row when it is null. */
    show(now: LyricNow | null): void {
        if (now === null) {
            this.index = null;
            this.box.remove_all_transitions();
            this.actor.hide();
            return;
        }
        const moved = this.index !== null && now.index !== this.index;
        this.index = now.index;
        this.actor.show();
        this.current.show(now.text, now.index, now.fraction, now.msLeft, now.playing);
        this.next.text = now.next ?? '';
        if (!moved) return;
        this.box.remove_all_transitions();
        this.box.translation_y = SLIDE_PX;
        this.box.opacity = 0;
        this.box.ease({ translation_y: 0, opacity: 255, duration: SLIDE_MS, mode: Clutter.AnimationMode.EASE_OUT_CUBIC });
    }

    destroy(): void {
        this.current.destroy();
        this.actor.destroy();
    }
}
