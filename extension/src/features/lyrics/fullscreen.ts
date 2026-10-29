import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Pango from 'gi://Pango';
import Shell from 'gi://Shell';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import { setVertical } from '../../shared/compat.js';
import { withAlpha } from '../../shared/logic/color.js';
import { ProgressBar, type MediaControls } from '../media/index.js';
import { FillLabel } from './fill.js';
import { blobColors, lineOpacity, type FullLine, type FullLines } from './logic/fullscreen.js';

/** What the full-screen view shows at one moment. */
export interface FullscreenFrame {
    lines: FullLines;
    fraction: number;
    msLeft: number;
    playing: boolean;
    title: string;
    artist: string;
    /** The cover, empty without one. */
    artPath: string;
    /** The cover's color, `#rrggbb`, or empty. */
    accentColor: string;
    /** The cover downsized and blurred; empty without a cover. */
    backdropPath: string;
    positionUs: number;
    lengthUs: number;
    canPlayPause: boolean;
    canGoNext: boolean;
    canGoPrevious: boolean;
    canSeek: boolean;
}

/** What the view's buttons and seek bar do. */
export type FullscreenControls = Pick<MediaControls, 'playPause' | 'next' | 'previous' | 'setPosition'>;

/** How often the view reads the song; the fill moves on its own in between. */
const TICK_MS = 100;
const CURRENT_HEIGHT = 90;
/** The lines move up about one line when the current one changes. */
const SLIDE_PX = 64;
const SLIDE_MS = 400;
const FADE_MS = 200;
/** The buttons and seek bar hide once the pointer rests this long. */
const CONTROLS_REST_MS = 3000;
/** The lines' column, as a part of the monitor's width and at most. */
const COLUMN_PART = 0.7;
const COLUMN_MAX = 1100;
/** The colors drifting behind the lyrics: their size against the monitor's larger side, */
const BLOB_PART = 0.9;
/** how far each drifts, as a part of the monitor, and how long one way takes. */
const BLOB_DRIFT = 0.18;
const BLOB_DRIFT_MS = [20_000, 24_000, 28_000];
/** Where each starts, as a part of the monitor (its center). */
const BLOB_SPOTS: ReadonlyArray<[number, number]> = [
    [0.2, 0.25],
    [0.8, 0.35],
    [0.5, 0.85],
];
const BLOB_ALPHA = 0.55;

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
 * The song over the whole monitor, karaoke style: the cover blurred behind
 * with its colors drifting slowly, the cover, title and artist on top, the
 * current line large in the middle lighting up as it is sung, the lines
 * around it fading with their distance, each with its romanization when it
 * has one. The buttons and the seek bar show while the pointer moves.
 * It takes the keyboard and pointer while open; Space plays or pauses;
 * Escape, ×, a click outside the buttons or the song losing its lyrics
 * closes it.
 */
export class LyricsFullscreen {
    private actor: St.Widget | null = null;
    private column: St.BoxLayout | null = null;
    private cover: St.Widget | null = null;
    private title: St.Label | null = null;
    private artist: St.Label | null = null;
    private before: Line[] = [];
    private current: FillLabel | null = null;
    private currentLine: Line | null = null;
    private after: Line[] = [];
    private backdrop: St.Widget | null = null;
    private blobs: St.Widget[] = [];
    private controls: St.Widget | null = null;
    private play: St.Button | null = null;
    private previousButton: St.Button | null = null;
    private nextButton: St.Button | null = null;
    private progress: ProgressBar | null = null;
    private artPath = '';
    private backdropPath = '';
    private accent: string | null = null;
    private grab: Clutter.Grab | null = null;
    private tickId = 0;
    private restId = 0;
    private index: number | null = null;

    /**
     * `frame` is what to show now, or null when the song has no lyrics to
     * show; `controls` play, skip and seek.
     */
    constructor(
        private readonly frame: () => FullscreenFrame | null,
        private readonly media: FullscreenControls,
    ) {}

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
        actor.add_child(this.buildBlobs(monitor.width, monitor.height));
        actor.add_child(new St.Widget({ style_class: 'nokta-lyrics-fullscreen-shade', x_expand: true, y_expand: true }));

        const width = Math.round(Math.min(monitor.width * COLUMN_PART, COLUMN_MAX));
        actor.add_child(this.buildColumn(width));
        actor.add_child(this.buildControls(width));

        actor.connect('key-press-event', (_actor, event: Clutter.Event) => {
            const key = event.get_key_symbol();
            if (key === Clutter.KEY_space) {
                this.media.playPause();
                this.wake();
                return Clutter.EVENT_STOP;
            }
            if (key !== Clutter.KEY_Escape) return Clutter.EVENT_PROPAGATE;
            this.close();
            return Clutter.EVENT_STOP;
        });
        actor.connect('motion-event', () => {
            this.wake();
            return Clutter.EVENT_PROPAGATE;
        });
        actor.connect('button-release-event', (_actor, event: Clutter.Event) => this.closeOutside(event));
        actor.connect('touch-event', (_actor, event: Clutter.Event) => {
            if (event.type() !== Clutter.EventType.TOUCH_END) return Clutter.EVENT_PROPAGATE;
            return this.closeOutside(event);
        });

        Main.uiGroup.add_child(actor);
        this.actor = actor;
        this.grab = Main.pushModal(actor, { actionMode: Shell.ActionMode.POPUP });
        actor.grab_key_focus();
        this.show(first);
        this.wake();
        this.drift(monitor.width, monitor.height);
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
        if (this.restId) GLib.source_remove(this.restId);
        this.tickId = this.restId = 0;
        if (this.grab) Main.popModal(this.grab);
        this.grab = null;
        this.current?.destroy();
        this.progress?.destroy();
        this.actor.destroy();
        this.actor = this.column = this.cover = this.title = this.artist = this.backdrop = null;
        this.controls = this.play = this.previousButton = this.nextButton = null;
        this.current = this.currentLine = this.progress = null;
        this.before = [];
        this.after = [];
        this.blobs = [];
        this.artPath = this.backdropPath = '';
        this.accent = null;
        this.index = null;
    }

    destroy(): void {
        this.close();
    }

    private buildBlobs(width: number, height: number): St.Widget {
        const layer = new St.Widget({ x_expand: true, y_expand: true, clip_to_allocation: true });
        const size = Math.round(Math.max(width, height) * BLOB_PART);
        this.blobs = BLOB_SPOTS.map(([x, y]) => {
            const blob = new St.Widget({
                style_class: 'nokta-lyrics-fullscreen-blob',
                width: size,
                height: size,
                x: Math.round(x * width - size / 2),
                y: Math.round(y * height - size / 2),
            });
            layer.add_child(blob);
            return blob;
        });
        return layer;
    }

    /** The colors drift back and forth for as long as the view is open. */
    private drift(width: number, height: number): void {
        if (!St.Settings.get().enable_animations) return;
        this.blobs.forEach((blob, i) => {
            const sign = i % 2 === 0 ? 1 : -1;
            blob.ease({
                translation_x: sign * BLOB_DRIFT * width,
                translation_y: -sign * BLOB_DRIFT * height * 0.6,
                duration: BLOB_DRIFT_MS[i],
                mode: Clutter.AnimationMode.EASE_IN_OUT_SINE,
                repeatCount: -1,
                autoReverse: true,
            });
        });
    }

    private buildColumn(width: number): St.BoxLayout {
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
        const header = new St.BoxLayout({ style_class: 'nokta-lyrics-fullscreen-header' });
        this.cover = new St.Widget({ style_class: 'nokta-lyrics-fullscreen-cover', y_align: Clutter.ActorAlign.CENTER });
        const names = setVertical(new St.BoxLayout({ x_expand: true, y_align: Clutter.ActorAlign.CENTER }));
        this.title = label('nokta-lyrics-fullscreen-title');
        this.artist = label('nokta-lyrics-fullscreen-artist');
        names.add_child(this.title);
        names.add_child(this.artist);
        header.add_child(this.cover);
        header.add_child(names);
        column.add_child(header);

        const lines = setVertical(new St.BoxLayout({ style_class: 'nokta-lyrics-fullscreen-lines' }));
        this.before = [0, 1].map(() => new Line(label('nokta-lyrics-fullscreen-line')));
        this.current = new FillLabel('nokta-lyrics-fullscreen-current', CURRENT_HEIGHT);
        this.current.setWidth(width);
        this.currentLine = new Line(this.current.actor);
        this.after = [0, 1, 2].map(() => new Line(label('nokta-lyrics-fullscreen-line')));
        this.before.forEach((line, i) => (line.actor.opacity = lineOpacity(this.before.length - i)));
        this.after.forEach((line, i) => (line.actor.opacity = lineOpacity(i + 1)));
        for (const line of [...this.before, this.currentLine, ...this.after]) lines.add_child(line.actor);
        column.add_child(lines);
        this.column = lines;
        return column;
    }

    private buildControls(width: number): St.Widget {
        const layer = new St.Widget({
            style_class: 'nokta-lyrics-fullscreen-chrome',
            layout_manager: new Clutter.BinLayout(),
            x_expand: true,
            y_expand: true,
        });
        const close = button('window-close-symbolic', 'nokta-lyrics-fullscreen-close', () => this.close());
        close.set({ x_expand: true, y_expand: true, x_align: Clutter.ActorAlign.END, y_align: Clutter.ActorAlign.START });
        layer.add_child(close);

        const bar = setVertical(
            new St.BoxLayout({
                style_class: 'nokta-lyrics-fullscreen-controls',
                width,
                x_expand: true,
                y_expand: true,
                x_align: Clutter.ActorAlign.CENTER,
                y_align: Clutter.ActorAlign.END,
            }),
        );
        this.progress = new ProgressBar((us) => this.media.setPosition(us));
        this.progress.setColors('#ffffff', 'rgba(255, 255, 255, 0.25)');
        const buttons = new St.BoxLayout({ style_class: 'nokta-lyrics-fullscreen-buttons', x_align: Clutter.ActorAlign.CENTER });
        this.previousButton = button('media-skip-backward-symbolic', 'nokta-lyrics-fullscreen-skip', () => this.media.previous());
        this.play = button('media-playback-start-symbolic', 'nokta-lyrics-fullscreen-play', () => this.media.playPause());
        this.nextButton = button('media-skip-forward-symbolic', 'nokta-lyrics-fullscreen-skip', () => this.media.next());
        buttons.add_child(this.previousButton);
        buttons.add_child(this.play);
        buttons.add_child(this.nextButton);
        bar.add_child(this.progress.actor);
        bar.add_child(buttons);
        layer.add_child(bar);
        this.controls = layer;
        return layer;
    }

    /** Shows the buttons and seek bar, and hides them once the pointer rests. */
    private wake(): void {
        const controls = this.controls;
        if (!controls) return;
        if (!controls.visible || controls.opacity < 255) {
            controls.remove_all_transitions();
            controls.show();
            controls.ease({ opacity: 255, duration: FADE_MS, mode: Clutter.AnimationMode.EASE_OUT_QUAD });
        }
        if (this.restId) GLib.source_remove(this.restId);
        this.restId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, CONTROLS_REST_MS, () => {
            this.restId = 0;
            this.controls?.ease({
                opacity: 0,
                duration: FADE_MS,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                onComplete: () => this.controls?.hide(),
            });
            return GLib.SOURCE_REMOVE;
        });
    }

    /** A click or tap closes the view, unless it was on a button or the seek bar. */
    private closeOutside(event: Clutter.Event): boolean {
        const source = (global.stage as Clutter.Stage).get_event_actor(event);
        const onControl = source !== null && source !== this.controls && this.controls?.contains(source);
        if (!onControl) this.close();
        return Clutter.EVENT_STOP;
    }

    private show(frame: FullscreenFrame): void {
        if (!this.current || !this.column) return;
        const { lines } = frame;
        this.title!.text = frame.title;
        this.artist!.text = frame.artist;
        this.artist!.visible = frame.artist !== '';
        lines.before.forEach((line, i) => this.before[i]?.set(line));
        this.current.show(lines.current.text, lines.index, frame.fraction, frame.msLeft, frame.playing);
        this.currentLine!.set(lines.current);
        lines.after.forEach((line, i) => this.after[i]?.set(line));
        this.showPicture(frame);
        this.showControls(frame);
        const moved = this.index !== null && lines.index !== this.index;
        this.index = lines.index;
        if (!moved) return;
        this.column.remove_all_transitions();
        this.column.translation_y = SLIDE_PX;
        this.column.ease({ translation_y: 0, duration: SLIDE_MS, mode: Clutter.AnimationMode.EASE_OUT_CUBIC });
    }

    private showPicture(frame: FullscreenFrame): void {
        if (frame.artPath !== this.artPath) {
            this.artPath = frame.artPath;
            this.cover!.visible = frame.artPath !== '';
            this.cover!.style = frame.artPath ? `background-image: url("${GLib.filename_to_uri(frame.artPath, null)}");` : '';
        }
        if (frame.backdropPath !== this.backdropPath) {
            this.backdropPath = frame.backdropPath;
            this.backdrop!.style = frame.backdropPath
                ? `background-image: url("${GLib.filename_to_uri(frame.backdropPath, null)}");`
                : '';
        }
        if (frame.accentColor !== this.accent) {
            this.accent = frame.accentColor;
            const colors = blobColors(frame.accentColor);
            this.blobs.forEach((blob, i) => {
                blob.style = `background-gradient-start: ${withAlpha(colors[i], BLOB_ALPHA)}; background-gradient-end: ${withAlpha(colors[i], 0)};`;
            });
        }
    }

    private showControls(frame: FullscreenFrame): void {
        this.progress?.update(frame.positionUs, frame.lengthUs, frame.canSeek);
        if (this.play) {
            (this.play.child as St.Icon).icon_name = frame.playing ? 'media-playback-pause-symbolic' : 'media-playback-start-symbolic';
            this.play.reactive = frame.canPlayPause;
        }
        if (this.previousButton) this.previousButton.reactive = frame.canGoPrevious;
        if (this.nextButton) this.nextButton.reactive = frame.canGoNext;
    }
}

function label(styleClass: string): St.Label {
    const text = new St.Label({ style_class: styleClass, x_expand: true });
    text.clutter_text.ellipsize = Pango.EllipsizeMode.END;
    return text;
}

function button(iconName: string, styleClass: string, onClick: () => void): St.Button {
    const b = new St.Button({
        style_class: `nokta-lyrics-fullscreen-control ${styleClass}`,
        child: new St.Icon({ icon_name: iconName }),
        can_focus: true,
    });
    b.connect('clicked', onClick);
    return b;
}
