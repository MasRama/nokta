import Clutter from 'gi://Clutter';
import St from 'gi://St';

import { Cover } from './cover.js';
import { Equalizer } from './equalizer.js';
import type { MediaSnapshot } from './logic/snapshot.js';

/** The collapsed notch while a player is active: small cover, equalizer. */
export class CollapsedMediaView {
    readonly actor: St.BoxLayout;
    private readonly cover = new Cover(22, 6);
    private readonly equalizer = new Equalizer();

    constructor() {
        this.actor = new St.BoxLayout({ style_class: 'nokta-collapsed', y_align: Clutter.ActorAlign.START });
        const spacer = new St.Widget({ x_expand: true });
        this.actor.add_child(this.cover.actor);
        this.actor.add_child(spacer);
        this.actor.add_child(this.equalizer.actor);
    }

    update(snapshot: MediaSnapshot, accent: string): void {
        this.cover.set(snapshot.artPath);
        this.equalizer.setColor(accent);
        this.equalizer.setPlaying(snapshot.playbackStatus === 'Playing');
    }

    /** Stops the equalizer while the view is not on screen. */
    setActive(active: boolean, snapshot: MediaSnapshot): void {
        this.equalizer.setPlaying(active && snapshot.playbackStatus === 'Playing');
    }

    destroy(): void {
        this.equalizer.destroy();
        this.actor.destroy();
    }
}
