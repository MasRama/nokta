import Clutter from 'gi://Clutter';
import St from 'gi://St';

import { formatDuration } from '../../shared/logic/format.js';
import { fractionOf, positionAt } from './logic/progress.js';

/**
 * Elapsed time, a bar and the total time. Click or drag the bar to seek;
 * while dragging the bar follows the pointer and the seek is sent on release.
 */
export class ProgressBar {
    readonly actor: St.BoxLayout;
    private readonly elapsed: St.Label;
    private readonly total: St.Label;
    private readonly hit: St.Widget;
    private readonly track: St.Widget;
    private readonly fill: St.Widget;
    private lengthUs = 0;
    private positionUs = 0;
    private seekable = false;
    private grab: Clutter.Grab | null = null;
    private dragUs = 0;

    constructor(private readonly onSeek: (us: number) => void) {
        this.actor = new St.BoxLayout({ style_class: 'nokta-progress', x_expand: true });
        this.elapsed = new St.Label({ style_class: 'nokta-time', y_align: Clutter.ActorAlign.CENTER });
        this.total = new St.Label({ style_class: 'nokta-time', y_align: Clutter.ActorAlign.CENTER });
        // A taller transparent hit area around the thin bar.
        this.hit = new St.Widget({
            layout_manager: new Clutter.BinLayout(),
            reactive: true,
            x_expand: true,
            height: 14,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this.track = new St.Widget({
            style_class: 'nokta-progress-track',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this.fill = new St.Widget({ style_class: 'nokta-progress-fill' });
        this.track.add_child(this.fill);
        this.hit.add_child(this.track);
        this.actor.add_child(this.elapsed);
        this.actor.add_child(this.hit);
        this.actor.add_child(this.total);

        this.track.connect('notify::width', () => this.redraw());
        this.hit.connect('button-press-event', (_actor, event: Clutter.Event) => this.press(event));
        this.hit.connect('motion-event', (_actor, event: Clutter.Event) => this.motion(event));
        this.hit.connect('button-release-event', (_actor, event: Clutter.Event) => this.release(event));
    }

    setColors(accent: string, trackColor: string): void {
        this.fill.style = `background-color: ${accent};`;
        this.track.style = `background-color: ${trackColor};`;
    }

    /** Hidden when the length is unknown. */
    update(positionUs: number, lengthUs: number, seekable: boolean): void {
        this.lengthUs = lengthUs;
        this.positionUs = positionUs;
        this.seekable = seekable && lengthUs > 0;
        this.actor.visible = lengthUs > 0;
        this.hit.reactive = this.seekable;
        if (!this.grab) this.redraw();
    }

    destroy(): void {
        this.endGrab();
        this.actor.destroy();
    }

    private redraw(): void {
        const shown = this.grab ? this.dragUs : this.positionUs;
        this.fill.set_size(Math.round(fractionOf(shown, this.lengthUs) * this.track.width), this.track.height);
        this.elapsed.text = formatDuration(shown);
        this.total.text = formatDuration(this.lengthUs);
    }

    private pointerUs(event: Clutter.Event): number {
        const [stageX, stageY] = event.get_coords();
        const [, x] = this.track.transform_stage_point(stageX, stageY);
        return positionAt(x, this.track.width, this.lengthUs);
    }

    private press(event: Clutter.Event): boolean {
        if (!this.seekable || event.get_button() !== Clutter.BUTTON_PRIMARY) return Clutter.EVENT_PROPAGATE;
        this.grab = (global.stage as Clutter.Stage).grab(this.hit);
        this.dragUs = this.pointerUs(event);
        this.redraw();
        return Clutter.EVENT_STOP;
    }

    private motion(event: Clutter.Event): boolean {
        if (!this.grab) return Clutter.EVENT_PROPAGATE;
        this.dragUs = this.pointerUs(event);
        this.redraw();
        return Clutter.EVENT_STOP;
    }

    private release(event: Clutter.Event): boolean {
        if (!this.grab) return Clutter.EVENT_PROPAGATE;
        this.dragUs = this.pointerUs(event);
        this.endGrab();
        this.positionUs = this.dragUs;
        this.redraw();
        this.onSeek(this.dragUs);
        return Clutter.EVENT_STOP;
    }

    private endGrab(): void {
        this.grab?.dismiss();
        this.grab = null;
    }
}
