import Clutter from 'gi://Clutter';
import St from 'gi://St';

import { Cover } from './cover.js';
import { Equalizer, type LevelSource } from './equalizer.js';
import { COVER_MS, coverLook } from './logic/cover.js';
import type { MediaSnapshot } from './logic/snapshot.js';

/**
 * The collapsed notch while a player is active: small cover, equalizer. The
 * equalizer's place can be lent to another actor (setAside).
 */
export class CollapsedMediaView {
    readonly actor: St.BoxLayout;
    private readonly cover = new Cover(22, 6);
    private readonly equalizer: Equalizer;
    private aside: Clutter.Actor | null = null;
    /** Whether the cover shows as playing; null before the first update. */
    private playing: boolean | null = null;

    constructor(levels: LevelSource) {
        this.equalizer = new Equalizer(levels);
        this.actor = new St.BoxLayout({ style_class: 'nokta-collapsed', y_align: Clutter.ActorAlign.START });
        const spacer = new St.Widget({ x_expand: true });
        this.actor.add_child(this.cover.actor);
        this.actor.add_child(spacer);
        this.actor.add_child(this.equalizer.actor);
    }

    update(snapshot: MediaSnapshot, accent: string): void {
        this.cover.set(snapshot.artPath);
        this.equalizer.setColor(accent);
        this.equalizer.setPlaying(!this.aside && snapshot.playbackStatus === 'Playing');
        this.setPlayingLook(snapshot.playbackStatus === 'Playing');
    }

    /** Paused, the cover dims and shrinks a little; playing again, it springs back. */
    private setPlayingLook(playing: boolean): void {
        if (playing === this.playing) return;
        const first = this.playing === null;
        this.playing = playing;
        const { opacity, scale } = coverLook(playing);
        const actor = this.cover.actor;
        actor.set_pivot_point(0.5, 0.5);
        actor.remove_all_transitions();
        if (first || !St.Settings.get().enable_animations) {
            actor.opacity = opacity;
            actor.set_scale(scale, scale);
            return;
        }
        actor.ease({
            opacity,
            scale_x: scale,
            scale_y: scale,
            duration: COVER_MS,
            mode: playing ? Clutter.AnimationMode.EASE_OUT_BACK : Clutter.AnimationMode.EASE_OUT_QUAD,
        });
    }

    /** Moves the cover right to `px` from the left edge, to clear the privacy dots; 0 for the usual place. */
    setInset(px: number): void {
        this.actor.style = px > 0 ? `padding-left: ${px}px;` : '';
    }

    /** Stops the equalizer while the view is not on screen. */
    setActive(active: boolean, snapshot: MediaSnapshot): void {
        this.equalizer.setPlaying(!this.aside && active && snapshot.playbackStatus === 'Playing');
    }

    /**
     * Shows `actor` in place of the equalizer, or the equalizer again with
     * null. The caller keeps owning the actor; call setActive afterwards.
     */
    setAside(actor: Clutter.Actor | null): void {
        if (this.aside) this.actor.remove_child(this.aside);
        this.aside = actor;
        if (actor) this.actor.add_child(actor);
        this.equalizer.actor.visible = !actor;
        if (actor) this.equalizer.setPlaying(false);
    }

    destroy(): void {
        this.setAside(null);
        this.equalizer.destroy();
        this.actor.destroy();
    }
}
