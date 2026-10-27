import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GnomeDesktop from 'gi://GnomeDesktop';
import St from 'gi://St';

import { formatClock } from './logic/format.js';

/**
 * `HH:MM` (or `h:MM`, following GNOME's clock format) for the idle notch.
 * GnomeDesktop.WallClock, as used by the top bar, ticks once per minute and
 * follows time zone and format changes, so no timer of our own is needed.
 */
export class IdleClock {
    readonly actor: St.Label;
    private readonly interfaceSettings = new Gio.Settings({ schema_id: 'org.gnome.desktop.interface' });
    private wallClock: GnomeDesktop.WallClock | null = null;
    private clockId = 0;

    constructor() {
        this.actor = new St.Label({
            style_class: 'nokta-clock',
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
            x_expand: true,
            y_expand: true,
        });
    }

    start(): void {
        if (this.wallClock) return;
        this.wallClock = new GnomeDesktop.WallClock({ time_only: true });
        this.clockId = this.wallClock.connect('notify::clock', () => this.update());
        this.update();
    }

    stop(): void {
        if (!this.wallClock) return;
        this.wallClock.disconnect(this.clockId);
        this.wallClock.run_dispose();
        this.wallClock = null;
        this.clockId = 0;
    }

    destroy(): void {
        this.stop();
        this.actor.destroy();
    }

    private update(): void {
        const use24h = this.interfaceSettings.get_string('clock-format') === '24h';
        this.actor.text = formatClock(new Date(), use24h);
    }
}
