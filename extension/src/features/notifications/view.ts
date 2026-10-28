import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import Pango from 'gi://Pango';
import St from 'gi://St';

import { TintedButton } from '../../shared/button.js';
import { setVertical } from '../../shared/compat.js';
import { MAX_BUTTONS } from './logic/actions.js';
import { iconFor } from '../../shared/icons.js';
import { chromeIcon } from '../../shared/icons.js';

/** The second line is dimmed next to the title. */
const DETAIL_OPACITY = 180;
/** The close button is dimmed until the pointer is on it. */
const CLOSE_OPACITY = 150;

export interface NotificationHandlers {
    /** A click on the notification itself. */
    onClick(): void;
    /** A click on the button at this place in the row. */
    onButton(index: number): void;
    onClose(): void;
}

/**
 * A notification in the notch: the app icon with a count when several from
 * the same app stacked, the title and one line under it, a row of buttons
 * for its actions, and a close button.
 */
export class NotificationView {
    readonly actor: St.BoxLayout;
    private readonly iconBox: St.Widget;
    private readonly icon: St.Icon;
    private readonly badge: St.Label;
    private readonly title: St.Label;
    private readonly detail: St.Label;
    private readonly buttonRow: St.BoxLayout;
    private readonly buttons: TintedButton[] = [];
    private readonly close: St.Button;
    private readonly clickId: number;
    private readonly closeIds: number[];

    constructor(handlers: NotificationHandlers) {
        this.actor = new St.BoxLayout({
            style_class: 'nokta-notification',
            reactive: true,
            y_align: Clutter.ActorAlign.START,
        });
        this.iconBox = new St.Widget({ layout_manager: new Clutter.BinLayout(), y_align: Clutter.ActorAlign.CENTER });
        this.icon = new St.Icon({ style_class: 'nokta-notification-icon' });
        this.badge = new St.Label({
            style_class: 'nokta-notification-badge',
            x_expand: true,
            y_expand: true,
            x_align: Clutter.ActorAlign.END,
            y_align: Clutter.ActorAlign.START,
            visible: false,
        });
        // Over the icon's top right corner, a little outside it.
        this.badge.translation_x = 6;
        this.badge.translation_y = -5;
        this.iconBox.add_child(this.icon);
        this.iconBox.add_child(this.badge);
        const text = setVertical(
            new St.BoxLayout({ style_class: 'nokta-notification-text', x_expand: true, y_align: Clutter.ActorAlign.CENTER }),
        );
        this.title = new St.Label({ style_class: 'nokta-notification-title' });
        this.detail = new St.Label({ style_class: 'nokta-notification-detail', opacity: DETAIL_OPACITY });
        for (const label of [this.title, this.detail]) {
            label.clutter_text.ellipsize = Pango.EllipsizeMode.END;
            text.add_child(label);
        }
        this.buttonRow = new St.BoxLayout({ style_class: 'nokta-notification-buttons', visible: false });
        for (let i = 0; i < MAX_BUTTONS; i++) {
            const button = new TintedButton('nokta-notification-button', null, () => handlers.onButton(i));
            this.buttons.push(button);
            this.buttonRow.add_child(button.actor);
        }
        text.add_child(this.buttonRow);
        this.close = new St.Button({
            style_class: 'nokta-notification-close',
            child: new St.Icon({
                style_class: 'nokta-notification-close-icon',
                gicon: iconFor('window-close-symbolic'),
            }),
            y_align: Clutter.ActorAlign.CENTER,
            opacity: CLOSE_OPACITY,
        });
        this.closeIds = [
            this.close.connect('clicked', () => handlers.onClose()),
            this.close.connect('notify::hover', () => {
                this.close.opacity = this.close.hover ? 255 : CLOSE_OPACITY;
            }),
        ];
        this.actor.add_child(this.iconBox);
        this.actor.add_child(text);
        this.actor.add_child(this.close);
        this.clickId = this.actor.connect('button-release-event', () => {
            // A button takes its own click; it never also opens the notification.
            if (!this.onButton()) handlers.onClick();
            return Clutter.EVENT_STOP;
        });
    }

    /** `buttons` are the labels of its actions' buttons, at most MAX_BUTTONS; `badge` the stacked count. */
    show(title: string, detail: string, icon: Gio.Icon | null, buttons: readonly string[], badge: string | null): void {
        // The typings omit that gicon is nullable; null leaves the slot empty.
        this.icon.gicon = chromeIcon(icon) as Gio.Icon;
        this.icon.visible = icon !== null;
        this.badge.visible = badge !== null;
        this.badge.text = badge ?? '';
        this.iconBox.visible = icon !== null || badge !== null;
        this.title.text = title;
        this.detail.text = detail;
        this.detail.visible = detail !== '';
        this.buttons.forEach((button, i) => {
            button.actor.visible = i < buttons.length;
            button.text = buttons[i] ?? '';
        });
        this.buttonRow.visible = buttons.length > 0;
    }

    setColors(foreground: string, accent: string, onAccent: string): void {
        for (const button of this.buttons) button.setForeground(foreground);
        this.badge.style = `background-color: ${accent}; color: ${onAccent};`;
    }

    destroy(): void {
        this.actor.disconnect(this.clickId);
        for (const id of this.closeIds) this.close.disconnect(id);
        for (const button of this.buttons) button.destroy();
        this.actor.destroy();
    }

    /** Whether the pointer is on one of the buttons. */
    private onButton(): boolean {
        return this.close.hover || this.buttons.some((button) => button.actor.visible && button.actor.hover);
    }
}
