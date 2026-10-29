import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Graphene from 'gi://Graphene';
import St from 'gi://St';

import { BAR_COUNT, barLevels, barsFrom, easeBars, RAMP_MS, rampLevels } from './logic/equalizer.js';

/** The music's band levels from 0 to 1 when noktad hears them, else null. */
export type LevelSource = () => readonly number[] | null;

/** Heights the bars rest at while paused. */
const REST = [0.45, 0.75, 0.55, 0.35];

/** The bars ease to rest over this long when the music stops. */
const SETTLE_MS = 250;

/** About 12 steps a second. */
const STEP_MS = 83;

/**
 * Four bars stepped like a level meter while music plays. They follow the
 * music's bands when noktad records it ([media] real_equalizer), else a
 * pattern: a playback indicator, not a spectrum. Easing them with Clutter
 * would make the compositor redraw at the full frame rate for as long as
 * music plays (measured: ~24 % of a core for gnome-shell); stepping costs a
 * fraction of that, so the levels are eased by the steps themselves. Still
 * when not playing or when GNOME animations are off.
 */
export class Equalizer {
    readonly actor: St.BoxLayout;
    private readonly bars: St.Widget[] = [];
    private shown: readonly number[] = REST;
    private timerId = 0;
    /** When the music last started, for the bars' rise from rest. */
    private startedMs = 0;

    constructor(private readonly levels: LevelSource) {
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
            for (const bar of this.bars) bar.remove_all_transitions();
            this.startedMs = GLib.get_monotonic_time() / 1000;
            this.timerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, STEP_MS, () => {
                const nowMs = GLib.get_monotonic_time() / 1000;
                const levels = this.levels();
                const target = levels ? easeBars(this.shown, barsFrom(levels)) : barLevels(nowMs);
                this.show(rampLevels(target, nowMs - this.startedMs, RAMP_MS, REST));
                return GLib.SOURCE_CONTINUE;
            });
        } else if (!animate && this.timerId) {
            GLib.source_remove(this.timerId);
            this.timerId = 0;
            this.settle();
        }
    }

    destroy(): void {
        this.setPlaying(false);
        this.actor.destroy();
    }

    /** The bars ease down to rest, once, instead of snapping there. */
    private settle(): void {
        this.shown = REST;
        const ease = St.Settings.get().enable_animations;
        this.bars.forEach((bar, i) => {
            bar.remove_all_transitions();
            if (ease)
                bar.ease({ scale_y: REST[i], duration: SETTLE_MS, mode: Clutter.AnimationMode.EASE_OUT_QUAD });
            else bar.scale_y = REST[i];
        });
    }

    private show(levels: readonly number[]): void {
        this.shown = levels;
        this.bars.forEach((bar, i) => (bar.scale_y = levels[i]));
    }
}
