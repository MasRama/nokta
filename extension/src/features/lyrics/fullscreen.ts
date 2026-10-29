import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Pango from 'gi://Pango';
import Shell from 'gi://Shell';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import { setVertical } from '../../shared/compat.js';
import { FillLabel } from './fill.js';
import type { FullLine, FullLines } from './logic/fullscreen.js';

/** What the full-screen view shows at one moment. */
export interface FullscreenFrame {
    lines: FullLines;
    fraction: number;
    msLeft: number;
    playing: boolean;
    title: string;
    artist: string;
    /** The cover downsized and blurred; empty without a cover. */
    backdropPath: string;
}

/** How often the view reads the song; the fill moves on its own in between. */
const TICK_MS = 100;
const CURRENT_HEIGHT = 80;
/** The lines move up this far when the current one changes. */
const SLIDE_PX = 40;
const SLIDE_MS = 320;
const FADE_MS = 200;
/** The lines before and after, out of 255. */
const DIM_OPACITY = 110;
/** The lines' column, as a part of the monitor's width and at most. */
const COLUMN_PART = 0.8;
const COLUMN_MAX = 1400;

/** A line of text and its romanization under it, in the full-screen view. */
class Line {
    readonly actor: St.BoxLayout;
    readonly romanized: St.Label;

    constructor(readonly text: St.Widget) {
        this.actor = setVertical(new St.BoxLayout({ x_expand: true }));
        this.romanized = label('nokta-lyrics-fullscreen-romanized');
        this.actor.add_child(text);
        this.actor.add_child(this.romanized);
    }

    /** Shows `full`'s romanization, and its text when this line is plain text. */
    set(full: FullLine): void {
        if (this.text instanceof St.Label) this.text.text = full.text;
        this.romanized.text = full.romanized ?? '';
        this.romanized.visible = full.romanized !== null;
    }
}

/**
 * The song's lyrics over the whole monitor, karaoke style: the blurred
 * cover behind, the current line large in the middle lighting up as it is
 * sung, the lines before and after it dimmed, each with its romanization
 * when it has one. It takes the keyboard and pointer while open; Escape, a
 * click or the song losing its lyrics closes it.
 */
export class LyricsFullscreen {
    private actor: St.Widget | null = null;
    private column: St.BoxLayout | null = null;
    private heading: St.Label | null = null;
    private previous: Line | null = null;
    private current: FillLabel | null = null;
    private currentLine: Line | null = null;
    private next: Line | null = null;
    private backdrop: St.Widget | null = null;
    private backdropPath = '';
    private grab: Clutter.Grab | null = null;
    private tickId = 0;
    private index: number | null = null;

    /** `frame` is what to show now, or null when the song has no lyrics to show. */
    constructor(private readonly frame: () => FullscreenFrame | null) {}

    get isOpen(): boolean {
        return this.actor !== null;
    }

    /** Opens the view over monitor `monitorIndex`, if the song has lyrics. */
    open(monitorIndex: number): void {
        const first = this.frame();
        const monitor = Main.layoutManager.monitors[monitorIndex];
        if (this.actor || !first || !monitor) return;
        const actor = new St.Widget({
            style_class: 'nokta-lyrics-fullscreen',
            layout_manager: new Clutter.BinLayout(),
            reactive: true,
            can_focus: true,
            x: monitor.x,
            y: monitor.y,
            width: monitor.width,
            height: monitor.height,
            opacity: 0,
        });
        this.backdrop = new St.Widget({ style_class: 'nokta-lyrics-fullscreen-backdrop', x_expand: true, y_expand: true });
        actor.add_child(this.backdrop);
        actor.add_child(new St.Widget({ style_class: 'nokta-lyrics-fullscreen-shade', x_expand: true, y_expand: true }));

        const width = Math.round(Math.min(monitor.width * COLUMN_PART, COLUMN_MAX));
        const column = setVertical(
            new St.BoxLayout({
                style_class: 'nokta-lyrics-fullscreen-column',
                width,
                x_expand: true,
                y_expand: true,
                x_align: Clutter.ActorAlign.CENTER,
                y_align: Clutter.ActorAlign.CENTER,
            }),
        );
        this.heading = label('nokta-lyrics-fullscreen-heading');
        this.previous = new Line(label('nokta-lyrics-fullscreen-line'));
        this.current = new FillLabel('nokta-lyrics-fullscreen-current', CURRENT_HEIGHT);
        this.current.setWidth(width);
        this.currentLine = new Line(this.current.actor);
        this.next = new Line(label('nokta-lyrics-fullscreen-line'));
        this.previous.actor.opacity = DIM_OPACITY;
        this.next.actor.opacity = DIM_OPACITY;
        column.add_child(this.heading);
        column.add_child(this.previous.actor);
        column.add_child(this.currentLine.actor);
        column.add_child(this.next.actor);
        actor.add_child(column);
        this.column = column;

        actor.connect('key-press-event', (_actor, event: Clutter.Event) => {
            if (event.get_key_symbol() !== Clutter.KEY_Escape) return Clutter.EVENT_PROPAGATE;
            this.close();
            return Clutter.EVENT_STOP;
        });
        actor.connect('button-release-event', () => {
            this.close();
            return Clutter.EVENT_STOP;
        });
        actor.connect('touch-event', (_actor, event: Clutter.Event) => {
            if (event.type() !== Clutter.EventType.TOUCH_END) return Clutter.EVENT_PROPAGATE;
            this.close();
            return Clutter.EVENT_STOP;
        });

        Main.uiGroup.add_child(actor);
        this.actor = actor;
        this.grab = Main.pushModal(actor, { actionMode: Shell.ActionMode.POPUP });
        actor.grab_key_focus();
        this.show(first);
        actor.ease({ opacity: 255, duration: FADE_MS, mode: Clutter.AnimationMode.EASE_OUT_QUAD });
        this.tickId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, TICK_MS, () => {
            const frame = this.frame();
            if (!frame) {
                this.tickId = 0;
                this.close();
                return GLib.SOURCE_REMOVE;
            }
            this.show(frame);
            return GLib.SOURCE_CONTINUE;
        });
    }

    close(): void {
        if (!this.actor) return;
        if (this.tickId) GLib.source_remove(this.tickId);
        this.tickId = 0;
        if (this.grab) Main.popModal(this.grab);
        this.grab = null;
        this.current?.destroy();
        this.actor.destroy();
        this.actor = this.column = this.heading = this.backdrop = null;
        this.previous = this.current = this.currentLine = this.next = null;
        this.backdropPath = '';
        this.index = null;
    }

    destroy(): void {
        this.close();
    }

    private show(frame: FullscreenFrame): void {
        if (!this.current || !this.column) return;
        const { lines } = frame;
        this.heading!.text = frame.artist ? `${frame.title} — ${frame.artist}` : frame.title;
        this.previous!.set(lines.previous);
        this.current.show(lines.current.text, lines.index, frame.fraction, frame.msLeft, frame.playing);
        this.currentLine!.set(lines.current);
        this.next!.set(lines.next);
        if (frame.backdropPath !== this.backdropPath) {
            this.backdropPath = frame.backdropPath;
            this.backdrop!.style = frame.backdropPath
                ? `background-image: url("${GLib.filename_to_uri(frame.backdropPath, null)}");`
                : '';
        }
        const moved = this.index !== null && lines.index !== this.index;
        this.index = lines.index;
        if (!moved) return;
        this.column.remove_all_transitions();
        this.column.translation_y = SLIDE_PX;
        this.column.ease({ translation_y: 0, duration: SLIDE_MS, mode: Clutter.AnimationMode.EASE_OUT_CUBIC });
    }

}

function label(styleClass: string): St.Label {
    const text = new St.Label({ style_class: styleClass, x_expand: true });
    text.clutter_text.ellipsize = Pango.EllipsizeMode.END;
    return text;
}
