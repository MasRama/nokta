import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GnomeDesktop from 'gi://GnomeDesktop';
import St from 'gi://St';

import { formatClock, uses24h } from './logic/format.js';

/**
 * `HH:MM` or `h:MM` for the idle notch, as `clock_format` says (or GNOME's
 * own clock format). GnomeDesktop.WallClock, as used by the top bar, ticks
 * once per minute and follows time zone and format changes, so no timer of
 * our own is needed. A hidden clock runs no WallClock at all.
 */
export class IdleClock {
    /** A bin that centers the label in whatever size the notch gives it. */
    readonly actor: St.Bin;
    private readonly label: St.Label;
    private readonly interfaceSettings = new Gio.Settings({ schema_id: 'org.gnome.desktop.interface' });
    private wallClock: GnomeDesktop.WallClock | null = null;
    private clockId = 0;
    /** Whether the idle view is on screen (start/stop). */
    private running = false;
    private shown = true;
    private format = 'system';

    constructor() {
        this.label = new St.Label({
            style_class: 'nokta-clock',
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this.actor = new St.Bin({ child: this.label });
    }

    start(): void {
        this.running = true;
        this.startWallClock();
    }

    stop(): void {
        this.running = false;
        this.stopWallClock();
    }

    /** `clock_format` and `show_clock`; applies at once. */
    setOptions(format: string, shown: boolean): void {
        this.format = format;
        this.shown = shown;
        this.label.visible = shown;
        if (!shown) this.stopWallClock();
        else if (this.running) this.startWallClock();
        if (this.wallClock) this.update();
    }

    private startWallClock(): void {
        if (this.wallClock || !this.shown) return;
        this.wallClock = new GnomeDesktop.WallClock({ time_only: true });
        this.clockId = this.wallClock.connect('notify::clock', () => this.update());
        this.update();
    }

    private stopWallClock(): void {
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
        const use24h = uses24h(this.format, this.interfaceSettings.get_string('clock-format'));
        this.label.text = formatClock(new Date(), use24h);
    }
}
