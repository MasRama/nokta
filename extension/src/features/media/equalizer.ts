import Clutter from 'gi://Clutter';
import Graphene from 'gi://Graphene';
import St from 'gi://St';

/** Per bar: loop duration in ms and the height it rests at. */
const BARS = [
    { ms: 420, rest: 0.45 },
    { ms: 330, rest: 0.75 },
    { ms: 510, rest: 0.55 },
    { ms: 380, rest: 0.35 },
];
const LOW = 0.25;

/**
 * Four bars that bounce while music plays: a playback indicator, not a
 * spectrum. The animation runs on the compositor, with no timers here, and
 * stays still when GNOME animations are off.
 */
export class Equalizer {
    readonly actor: St.BoxLayout;
    private readonly bars: St.Widget[];
    private playing = false;

    constructor() {
        this.actor = new St.BoxLayout({ style_class: 'nokta-equalizer', y_align: Clutter.ActorAlign.CENTER });
        this.bars = BARS.map(({ rest }) => {
            const bar = new St.Widget({
                style_class: 'nokta-equalizer-bar',
                y_align: Clutter.ActorAlign.END,
                pivot_point: new Graphene.Point({ x: 0.5, y: 1 }),
                scale_y: rest,
            });
            this.actor.add_child(bar);
            return bar;
        });
    }

    setColor(color: string): void {
        for (const bar of this.bars) bar.style = `background-color: ${color};`;
    }

    setPlaying(playing: boolean): void {
        if (playing === this.playing) return;
        this.playing = playing;
        this.bars.forEach((bar, i) => {
            bar.remove_all_transitions();
            const { ms, rest } = BARS[i];
            if (!playing || !St.Settings.get().enable_animations) {
                bar.ease({ scale_y: rest, duration: 200, mode: Clutter.AnimationMode.EASE_OUT_QUAD });
                return;
            }
            bar.scale_y = LOW;
            bar.ease({
                scale_y: 1,
                duration: ms,
                mode: Clutter.AnimationMode.EASE_IN_OUT_SINE,
                repeatCount: -1,
                autoReverse: true,
            });
        });
    }

    destroy(): void {
        for (const bar of this.bars) bar.remove_all_transitions();
        this.actor.destroy();
    }
}
