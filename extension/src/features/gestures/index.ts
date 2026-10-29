import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Volume from 'resource:///org/gnome/shell/ui/status/volume.js';

import { ScrollTracker, type ScrollAction, type ScrollDiscrete } from './logic/scroll.js';
import { steppedVolume, volumeIcon } from './logic/volume.js';

/** What the gestures act on. */
export interface GestureTarget {
    enabled(): boolean;
    /** Song gestures need a player; the volume always works. */
    hasPlayer(): boolean;
    playPause(): void;
    next(): void;
    previous(): void;
}

const DISCRETE: Partial<Record<Clutter.ScrollDirection, ScrollDiscrete>> = {
    [Clutter.ScrollDirection.UP]: 'up',
    [Clutter.ScrollDirection.DOWN]: 'down',
    [Clutter.ScrollDirection.LEFT]: 'left',
    [Clutter.ScrollDirection.RIGHT]: 'right',
};

/** GNOME 46 to 48 show on one monitor with `show`; 49 and later with `showOne`. */
interface OsdShow {
    show(...args: unknown[]): void;
    showOne?: (monitorIndex: number, icon: Gio.Icon, label: string | null, level: number, maxLevel: number) => void;
}

/**
 * Scroll, swipe and middle click on the notch. Events reach the notch only
 * when nothing under the pointer used them, so scroll views and sliders
 * keep their scrolling.
 */
export class NotchGestures {
    private readonly tracker = new ScrollTracker();
    private readonly ids: number[];

    constructor(
        private readonly actor: Clutter.Actor,
        private readonly monitorIndex: number,
        private readonly target: GestureTarget,
    ) {
        this.ids = [
            actor.connect('scroll-event', (_actor, event: Clutter.Event) => this.onScroll(event)),
            actor.connect('button-release-event', (_actor, event: Clutter.Event) => this.onRelease(event)),
        ];
    }

    destroy(): void {
        for (const id of this.ids) this.actor.disconnect(id);
        this.ids.length = 0;
    }

    private onScroll(event: Clutter.Event): boolean {
        if (!this.target.enabled()) return Clutter.EVENT_PROPAGATE;
        // A wheel sends clicks and smooth copies of them, a touchpad smooth
        // events and click copies: only the originals count.
        if (event.get_flags() & Clutter.EventFlags.FLAG_POINTER_EMULATED) return Clutter.EVENT_STOP;
        const direction = event.get_scroll_direction();
        const discrete = DISCRETE[direction] ?? null;
        const [dx, dy] = direction === Clutter.ScrollDirection.SMOOTH ? event.get_scroll_delta() : [0, 0];
        const action = this.tracker.push(dx, dy, discrete, GLib.get_monotonic_time() / 1000);
        if (action) this.act(action);
        return Clutter.EVENT_STOP;
    }

    private onRelease(event: Clutter.Event): boolean {
        if (event.get_button() !== Clutter.BUTTON_MIDDLE || !this.target.enabled()) return Clutter.EVENT_PROPAGATE;
        if (this.target.hasPlayer()) this.target.playPause();
        return Clutter.EVENT_STOP;
    }

    private act(action: ScrollAction): void {
        if (action === 'volume-up' || action === 'volume-down') {
            this.stepVolume(action);
        } else if (this.target.hasPlayer()) {
            if (action === 'next') this.target.next();
            else this.target.previous();
        }
    }

    /** Steps the output's volume and shows it, as the volume keys do. */
    private stepVolume(action: 'volume-up' | 'volume-down'): void {
        const control = Volume.getMixerControl();
        const stream = control.get_default_sink();
        if (!stream) return;
        const max = control.get_vol_max_norm();
        const muted = stream.is_muted && action === 'volume-down';
        if (stream.is_muted && action === 'volume-up') stream.change_is_muted(false);
        const volume = steppedVolume(stream.volume, max, action);
        stream.volume = volume;
        stream.push_volume();
        const level = volume / max;
        const icon = Gio.ThemedIcon.new(volumeIcon(level, muted));
        const osd = Main.osdWindowManager as unknown as OsdShow;
        if (osd.showOne) osd.showOne(this.monitorIndex, icon, null, level, 1);
        else osd.show(this.monitorIndex, icon, null, level, 1);
    }
}
