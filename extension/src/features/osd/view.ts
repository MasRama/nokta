import Clutter from 'gi://Clutter';
import type Gio from 'gi://Gio';
import St from 'gi://St';

import { batteryFill, batteryTone } from './logic/battery.js';
import type { OsdContent } from './logic/content.js';
import { chromeIcon } from '../../shared/icons.js';
import { withAlpha } from '../../shared/logic/color.js';

const BAR_EASE_MS = 100;
/** The detail is dimmed next to the text, unless the row is urgent. */
const DETAIL_OPACITY = 180;
/** The width inside the battery's 22 px outline, its 1 px border and 1 px padding. */
const BATTERY_INNER = 18;

/** The OSD row: icon, level bar, text, and a detail on the right. */
export class OsdView {
    readonly actor: St.BoxLayout;
    private readonly icon: St.Icon;
    private readonly track: St.Widget;
    private readonly fill: St.Widget;
    private readonly label: St.Label;
    private readonly detail: St.Label;
    private readonly battery: St.BoxLayout;
    private readonly batteryCase: St.Bin;
    private readonly batteryNub: St.Widget;
    private readonly batteryFill: St.Widget;

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
        this.detail = new St.Label({ style_class: 'nokta-osd-detail', y_align: Clutter.ActorAlign.CENTER });
        // A device's battery before its percentage: an outline, a nub and a fill in the level's tone.
        this.batteryFill = new St.Widget({
            style_class: 'nokta-osd-battery-fill',
            x_align: Clutter.ActorAlign.START,
            y_align: Clutter.ActorAlign.CENTER,
            x_expand: true,
            y_expand: true,
        });
        this.batteryCase = new St.Bin({ style_class: 'nokta-osd-battery-case', child: this.batteryFill });
        this.batteryNub = new St.Widget({ style_class: 'nokta-osd-battery-nub', y_align: Clutter.ActorAlign.CENTER });
        this.battery = new St.BoxLayout({
            style_class: 'nokta-osd-battery',
            y_align: Clutter.ActorAlign.CENTER,
            visible: false,
        });
        this.battery.add_child(this.batteryCase);
        this.battery.add_child(this.batteryNub);
        this.actor.add_child(this.label);
        this.actor.add_child(this.battery);
        this.actor.add_child(this.detail);
    }

    setColors(fill: string, track: string): void {
        this.fill.style = `background-color: ${fill};`;
        this.track.style = `background-color: ${track};`;
        const outline = withAlpha(fill, 0.5);
        this.batteryCase.style = `border-color: ${outline};`;
        this.batteryNub.style = `background-color: ${outline};`;
    }

    /** `animate` eases the bar from its last value, for a change while shown. */
    show(content: OsdContent, icon: Gio.Icon | null, animate: boolean, speed: number): void {
        // The typings omit that gicon is nullable; null leaves the slot empty.
        this.icon.gicon = chromeIcon(icon) as Gio.Icon;
        this.label.text = content.text;
        this.detail.text = content.detail ?? '';
        this.detail.visible = Boolean(content.detail);
        this.detail.opacity = content.urgent ? 255 : DETAIL_OPACITY;
        const level = content.battery ?? null;
        this.battery.visible = level !== null;
        if (level !== null) {
            this.batteryFill.width = batteryFill(level, BATTERY_INNER);
            this.batteryFill.visible = level > 0;
            this.batteryFill.style = `background-color: ${batteryTone(level)};`;
        }
        if (content.urgent) this.actor.add_style_class_name('nokta-osd-urgent');
        else this.actor.remove_style_class_name('nokta-osd-urgent');
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
