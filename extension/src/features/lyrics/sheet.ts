import Clutter from 'gi://Clutter';
import Pango from 'gi://Pango';
import St from 'gi://St';

import { setVertical } from '../../shared/compat.js';
import { FillLabel } from './fill.js';
import type { LineProgress } from './logic/karaoke.js';
import { offsetLabel, stepOffset } from './logic/offset.js';
import { BREAK } from './logic/visible.js';
import { romanizedRows, type LyricWindow } from './logic/window.js';
import { iconFor } from '../../shared/icons.js';
import { _ } from '../../shared/logic/i18n.js';

/** The lyrics view's rows; the middle one is the current line. */
export const SHEET_ROWS = 7;
const ROW_HEIGHT = 20;
/** The current line is larger, so it gets a taller row. */
const CURRENT_HEIGHT = 30;
/** The timing row under the lines: − button, label, + button. */
const FOOTER_HEIGHT = 26;
/** The lines' height with the sheet's padding, which plain text scrolls in. */
const LINES_HEIGHT = (SHEET_ROWS - 1) * ROW_HEIGHT + CURRENT_HEIGHT + 4;
/** How much taller the open notch gets for the lyrics view, with its padding and the timing row. */
export const SHEET_EXTRA_HEIGHT = (SHEET_ROWS - 1) * ROW_HEIGHT + CURRENT_HEIGHT + 10 + FOOTER_HEIGHT;
const SLIDE_MS = 260;
/** Each row's opacity by its distance from the current line. */
const FADE = [255, 150, 95, 60];

/**
 * Seven lines of synced lyrics around the current one, which is larger
 * and lights up as it is sung; the others fade with their distance. The
 * lines slide up when the current line changes. A Korean or Japanese
 * current line has its romanization in the row under it. A click on the lines
 * closes the view; the row under them moves the lyrics earlier or later,
 * and its button on the right opens them full screen.
 *
 * Lyrics without timing show as text to scroll through instead, with a
 * note in place of the timing row and no full-screen button.
 */
export class LyricsSheet {
    readonly actor: St.BoxLayout;
    private readonly box: St.BoxLayout;
    private readonly rows: St.Label[] = [];
    private readonly current = new FillLabel('nokta-lyrics-row nokta-lyrics-current', CURRENT_HEIGHT);
    private readonly offsetText: St.Label;
    private readonly lines: St.Button;
    private readonly timing: St.BoxLayout;
    private readonly fullscreen: St.Button;
    private readonly plain: St.ScrollView;
    private readonly plainLabel: St.Label;
    private readonly plainNote: St.Label;
    private shown: number | null = null;
    private offsetMs = 0;

    /**
     * `onClose` for a click on the lines, `onOffset` with the timing a footer
     * click asks for, `onFullscreen` for the full-screen button.
     */
    constructor(onClose: () => void, onOffset: (offsetMs: number) => void, onFullscreen: () => void) {
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
        this.lines = new St.Button({
            style_class: 'nokta-lyrics-sheet-button',
            child: this.box,
            x_expand: true,
            // The rows slide in from below; keep them off the timing row.
            clip_to_allocation: true,
        });
        this.lines.connect('clicked', onClose);

        this.plainLabel = new St.Label({ style_class: 'nokta-lyrics-plain-text', x_expand: true });
        this.plainLabel.clutter_text.line_wrap = true;
        this.plainLabel.clutter_text.line_wrap_mode = Pango.WrapMode.WORD_CHAR;
        this.plainLabel.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
        // A click closes the view, as on synced lines; the wheel scrolls.
        const plainButton = new St.Button({
            style_class: 'nokta-lyrics-sheet-button nokta-lyrics-plain-button',
            child: this.plainLabel,
            x_expand: true,
        });
        plainButton.connect('clicked', onClose);
        const plainBox = setVertical(new St.BoxLayout({ x_expand: true }));
        plainBox.add_child(plainButton);
        this.plain = new St.ScrollView({
            style_class: 'nokta-lyrics-plain',
            x_expand: true,
            height: LINES_HEIGHT,
            hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.AUTOMATIC,
            overlay_scrollbars: true,
            visible: false,
        });
        this.plain.set_child(plainBox);

        this.offsetText = new St.Label({ style_class: 'nokta-lyrics-offset-label', text: offsetLabel(0) });
        const footer = new St.BoxLayout({
            style_class: 'nokta-lyrics-footer',
            x_align: Clutter.ActorAlign.CENTER,
            height: FOOTER_HEIGHT,
        });
        this.timing = new St.BoxLayout({ style_class: 'nokta-lyrics-timing' });
        this.timing.add_child(
            footerButton('list-remove-symbolic', _('Show the lyrics later'), () =>
                onOffset(stepOffset(this.offsetMs, -1)),
            ),
        );
        const reset = new St.Button({
            style_class: 'nokta-button nokta-lyrics-offset',
            child: this.offsetText,
            y_align: Clutter.ActorAlign.CENTER,
            can_focus: true,
            accessible_name: _('Reset the lyric timing'),
        });
        reset.connect('clicked', () => {
            if (this.offsetMs !== 0) onOffset(0);
        });
        this.timing.add_child(reset);
        this.timing.add_child(
            footerButton('list-add-symbolic', _('Show the lyrics earlier'), () => onOffset(stepOffset(this.offsetMs, 1))),
        );
        footer.add_child(this.timing);
        this.plainNote = new St.Label({
            style_class: 'nokta-lyrics-plain-note',
            text: _('Lyrics without timing'),
            y_align: Clutter.ActorAlign.CENTER,
            // As dim as the rows next to the current line.
            opacity: FADE[1],
            visible: false,
        });
        footer.add_child(this.plainNote);

        // The timing buttons stay centred: a spacer as wide as the corner the full-screen button sits in.
        this.fullscreen = footerButton('view-fullscreen-symbolic', _('Full-screen lyrics'), onFullscreen);
        this.fullscreen.add_style_class_name('nokta-lyrics-fullscreen-button');
        const corner = new St.Widget({ layout_manager: new Clutter.BinLayout(), x_expand: true });
        this.fullscreen.x_align = Clutter.ActorAlign.END;
        this.fullscreen.x_expand = true;
        corner.add_child(this.fullscreen);
        const bottom = new St.BoxLayout({ x_expand: true, height: FOOTER_HEIGHT });
        bottom.add_child(new St.Widget({ x_expand: true }));
        bottom.add_child(footer);
        bottom.add_child(corner);

        this.actor = setVertical(new St.BoxLayout({ x_expand: true, visible: false }));
        this.actor.add_child(this.lines);
        this.actor.add_child(this.plain);
        this.actor.add_child(bottom);
    }

    setWidth(width: number): void {
        this.current.setWidth(width);
        this.plainLabel.width = width;
    }

    /**
     * Shows the lines around the current one; `offsetMs` is the timing they
     * already have, `romanized` the current line's romanization or null.
     */
    show(window: LyricWindow, progress: LineProgress, playing: boolean, offsetMs: number, romanized: string | null): void {
        this.setPlain(false);
        if (offsetMs !== this.offsetMs) {
            this.offsetMs = offsetMs;
            this.offsetText.text = offsetLabel(offsetMs);
            // The line now ends at another time.
            this.current.restart();
        }
        const middle = Math.floor(SHEET_ROWS / 2);
        const others = romanizedRows(window.rows, romanized).filter((_, i) => i !== middle);
        others.forEach((text, i) => (this.rows[i].text = text));
        // this.rows skips the current line: the row under it is this.rows[middle].
        if (romanized === null) this.rows[middle].remove_style_class_name('nokta-lyrics-romanized');
        else this.rows[middle].add_style_class_name('nokta-lyrics-romanized');
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

    /** Shows lyrics without timing as text to scroll through, from the top when it is new. */
    showPlain(text: string): void {
        this.setPlain(true);
        if (this.plainLabel.text === text) return;
        this.plainLabel.text = text;
        this.plain.vadjustment.value = 0;
    }

    /** Forgets the last line, so the next show() does not slide, and scrolls plain text back up. */
    reset(): void {
        this.shown = null;
        this.box.remove_all_transitions();
        this.box.translation_y = 0;
        this.plain.vadjustment.value = 0;
    }

    private setPlain(plain: boolean): void {
        this.lines.visible = !plain;
        this.timing.visible = !plain;
        this.fullscreen.visible = !plain;
        this.plain.visible = plain;
        this.plainNote.visible = plain;
    }

    destroy(): void {
        this.current.destroy();
        this.actor.destroy();
    }
}

function footerButton(icon: string, name: string, onClick: () => void): St.Button {
    const button = new St.Button({
        style_class: 'nokta-button nokta-lyrics-step',
        child: new St.Icon({ gicon: iconFor(icon), style_class: 'nokta-button-icon' }),
        y_align: Clutter.ActorAlign.CENTER,
        can_focus: true,
        accessible_name: name,
    });
    button.connect('clicked', onClick);
    return button;
}
