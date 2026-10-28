import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import St from 'gi://St';
import { iconFor } from '../../shared/icons.js';

/** The track's cover as a rounded square, or a note icon when there is none. */
export class Cover {
    readonly actor: St.Bin;
    private readonly icon: St.Icon;

    constructor(
        private readonly size: number,
        private readonly radius: number,
    ) {
        this.icon = new St.Icon({ gicon: iconFor('audio-x-generic-symbolic'), icon_size: Math.round(size / 2) });
        this.actor = new St.Bin({
            style_class: 'nokta-cover',
            width: size,
            height: size,
            y_align: Clutter.ActorAlign.CENTER,
            child: this.icon,
        });
    }

    /** `artPath` is a local file from the daemon's cache, or empty. */
    set(artPath: string): void {
        const base = `border-radius: ${this.radius}px;`;
        if (artPath) {
            // A file URI is percent-encoded, so quotes in the path cannot
            // break out of the CSS string.
            const uri = GLib.filename_to_uri(artPath, null);
            this.actor.style = `${base} background-image: url("${uri}"); background-size: cover;`;
            this.icon.hide();
        } else {
            this.actor.style = `${base} background-color: rgba(128, 128, 128, 0.3);`;
            this.icon.show();
        }
    }

    get dimension(): number {
        return this.size;
    }
}
