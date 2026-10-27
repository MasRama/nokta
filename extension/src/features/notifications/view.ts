import Clutter from 'gi://Clutter';
import type Gio from 'gi://Gio';
import Pango from 'gi://Pango';
import St from 'gi://St';

import { setVertical } from '../../shared/compat.js';

/** The second line is dimmed next to the title. */
const DETAIL_OPACITY = 180;

/** A notification in the notch: the app icon, the title and one line under it. */
export class NotificationView {
    readonly actor: St.BoxLayout;
    private readonly icon: St.Icon;
    private readonly title: St.Label;
    private readonly detail: St.Label;
    private readonly clickId: number;

    constructor(onClick: () => void) {
        this.actor = new St.BoxLayout({
            style_class: 'nokta-notification',
            reactive: true,
            y_align: Clutter.ActorAlign.START,
        });
        this.icon = new St.Icon({ style_class: 'nokta-notification-icon', y_align: Clutter.ActorAlign.CENTER });
        const text = setVertical(new St.BoxLayout({ x_expand: true, y_align: Clutter.ActorAlign.CENTER }));
        this.title = new St.Label({ style_class: 'nokta-notification-title' });
        this.detail = new St.Label({ style_class: 'nokta-notification-detail', opacity: DETAIL_OPACITY });
        for (const label of [this.title, this.detail]) {
            label.clutter_text.ellipsize = Pango.EllipsizeMode.END;
            text.add_child(label);
        }
        this.actor.add_child(this.icon);
        this.actor.add_child(text);
        this.clickId = this.actor.connect('button-release-event', () => {
            onClick();
            return Clutter.EVENT_STOP;
        });
    }

    show(title: string, detail: string, icon: Gio.Icon | null): void {
        // The typings omit that gicon is nullable; null leaves the slot empty.
        this.icon.gicon = icon as Gio.Icon;
        this.icon.visible = icon !== null;
        this.title.text = title;
        this.detail.text = detail;
        this.detail.visible = detail !== '';
    }

    destroy(): void {
        this.actor.disconnect(this.clickId);
        this.actor.destroy();
    }
}
