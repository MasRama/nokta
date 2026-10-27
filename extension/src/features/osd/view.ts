import Clutter from 'gi://Clutter';
import type Gio from 'gi://Gio';
import St from 'gi://St';

import type { OsdContent } from './logic/content.js';

const BAR_EASE_MS = 100;

/** The OSD row (spec 3.4): icon, level bar, text. */
export class OsdView {
    readonly actor: St.BoxLayout;
    private readonly icon: St.Icon;
    private readonly track: St.Widget;
    private readonly fill: St.Widget;
    private readonly label: St.Label;

    constructor() {
        this.actor = new St.BoxLayout({ style_class: 'nokta-osd', y_align: Clutter.ActorAlign.START });
        this.icon = new St.Icon({ style_class: 'nokta-osd-icon', y_align: Clutter.ActorAlign.CENTER });
        this.track = new St.Widget({
            style_class: 'nokta-osd-track',
            layout_manager: new Clutter.BinLayout(),
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        // The fill always covers the track and is scaled from its left edge,
        // so the level never depends on the track's allocation.
        this.fill = new St.Widget({ style_class: 'nokta-osd-fill', x_expand: true, y_expand: true, scale_x: 0 });
        this.fill.set_pivot_point(0, 0.5);
        this.track.add_child(this.fill);
        this.label = new St.Label({ style_class: 'nokta-osd-text', y_align: Clutter.ActorAlign.CENTER });
        this.actor.add_child(this.icon);
        this.actor.add_child(this.track);
        this.actor.add_child(this.label);
    }

    setColors(fill: string, track: string): void {
        this.fill.style = `background-color: ${fill};`;
        this.track.style = `background-color: ${track};`;
    }

    /** `animate` eases the bar from its last value, for a change while shown. */
    show(content: OsdContent, icon: Gio.Icon | null, animate: boolean, speed: number): void {
        // The typings omit that gicon is nullable; null leaves the slot empty.
        this.icon.gicon = icon as Gio.Icon;
        this.label.text = content.text;
        const hasBar = content.fraction !== null;
        this.track.visible = hasBar;
        this.label.x_expand = !hasBar;
        if (hasBar) this.label.remove_style_class_name('nokta-osd-text-only');
        else this.label.add_style_class_name('nokta-osd-text-only');
        this.setFraction(content.fraction ?? 0, animate, speed);
    }

    destroy(): void {
        this.actor.destroy();
    }

    private setFraction(fraction: number, animate: boolean, speed: number): void {
        this.fill.remove_all_transitions();
        if (animate) {
            this.fill.ease({
                scale_x: fraction,
                duration: Math.round(BAR_EASE_MS * speed),
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            });
        } else {
            this.fill.scale_x = fraction;
        }
    }
}
