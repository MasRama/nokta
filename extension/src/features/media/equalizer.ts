import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Graphene from 'gi://Graphene';
import St from 'gi://St';

import { BAR_COUNT, barLevels } from './logic/equalizer.js';

/** Heights the bars rest at while paused. */
const REST = [0.45, 0.75, 0.55, 0.35];

/** About 12 steps a second. */
const STEP_MS = 83;

/**
 * Four bars stepped like a level meter while music plays: a playback
 * indicator, not a spectrum. Easing them would make the compositor redraw at
 * the full frame rate for as long as music plays (measured: ~24 % of a core
 * for gnome-shell); stepping costs a fraction of that. Still when not
 * playing or when GNOME animations are off.
 */
export class Equalizer {
    readonly actor: St.BoxLayout;
    private readonly bars: St.Widget[] = [];
    private timerId = 0;

    constructor() {
        this.actor = new St.BoxLayout({ style_class: 'nokta-equalizer', y_align: Clutter.ActorAlign.CENTER });
        for (let i = 0; i < BAR_COUNT; i++) {
            const bar = new St.Widget({
                style_class: 'nokta-equalizer-bar',
                y_align: Clutter.ActorAlign.END,
                pivot_point: new Graphene.Point({ x: 0.5, y: 1 }),
                scale_y: REST[i],
            });
            this.actor.add_child(bar);
            this.bars.push(bar);
        }
    }

    setColor(color: string): void {
        for (const bar of this.bars) bar.style = `background-color: ${color};`;
    }

    setPlaying(playing: boolean): void {
        const animate = playing && St.Settings.get().enable_animations;
        if (animate && !this.timerId) {
            this.timerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, STEP_MS, () => {
                this.show(barLevels(GLib.get_monotonic_time() / 1000));
                return GLib.SOURCE_CONTINUE;
            });
        } else if (!animate && this.timerId) {
            GLib.source_remove(this.timerId);
            this.timerId = 0;
            this.show(REST);
        }
    }

    destroy(): void {
        this.setPlaying(false);
        this.actor.destroy();
    }

    private show(levels: readonly number[]): void {
        this.bars.forEach((bar, i) => (bar.scale_y = levels[i]));
    }
}
