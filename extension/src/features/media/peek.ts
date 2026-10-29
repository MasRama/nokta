import Clutter from 'gi://Clutter';
import Pango from 'gi://Pango';
import St from 'gi://St';

import { SECONDARY } from '../../shared/dim.js';
import { Cover } from './cover.js';
import { Equalizer, type LevelSource } from './equalizer.js';
import type { MediaSnapshot } from './logic/snapshot.js';

/**
 * The closed notch, widened for a moment when the song changes: the cover,
 * the title and the artist on one line, and the equalizer.
 */
export class PeekView {
    readonly actor: St.BoxLayout;
    private readonly cover = new Cover(22, 6);
    private readonly title: St.Label;
    private readonly artist: St.Label;
    private readonly equalizer: Equalizer;
    private playing = false;

    constructor(levels: LevelSource) {
        this.equalizer = new Equalizer(levels);
        this.actor = new St.BoxLayout({ style_class: 'nokta-peek', y_align: Clutter.ActorAlign.START });
        const text = new St.BoxLayout({
            style_class: 'nokta-peek-text',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this.title = new St.Label({ style_class: 'nokta-peek-title', y_align: Clutter.ActorAlign.CENTER });
        this.artist = new St.Label({
            style_class: 'nokta-peek-artist',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this.artist.opacity = SECONDARY;
        for (const label of [this.title, this.artist]) label.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        text.add_child(this.title);
        text.add_child(this.artist);
        this.actor.add_child(this.cover.actor);
        this.actor.add_child(text);
        this.actor.add_child(this.equalizer.actor);
    }

    update(snapshot: MediaSnapshot, accent: string): void {
        this.cover.set(snapshot.artPath);
        this.title.text = snapshot.title;
        this.artist.text = snapshot.artists.join(', ');
        this.artist.visible = this.artist.text !== '';
        this.equalizer.setColor(accent);
        this.playing = snapshot.playbackStatus === 'Playing';
    }

    /** Moves the cover right to `px` from the left edge, to clear the privacy dots; 0 for the usual place. */
    setInset(px: number): void {
        this.actor.style = px > 0 ? `padding-left: ${px}px;` : '';
    }

    /** The equalizer runs only while the peek shows. */
    setActive(active: boolean): void {
        this.equalizer.setPlaying(active && this.playing);
    }

    destroy(): void {
        this.equalizer.destroy();
        this.actor.destroy();
    }
}
