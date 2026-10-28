import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import St from 'gi://St';

import { setVertical } from '../../shared/compat.js';
import { withAlpha } from '../../shared/logic/color.js';

/** What the idle panel shows, worked out by the session when it opens. */
export interface PanelContent {
    /** Today, like `Wednesday, 28 October`, in the user's language. */
    date: string;
    notifications: string;
    focus: string;
}

export interface PanelHandlers {
    openNotifications(): void;
    toggleFocus(): void;
}

const BUTTON_ALPHA = 0.12;
const BUTTON_HOVER_ALPHA = 0.22;

/** A rounded button with an icon and a label, tinted from the foreground color. */
class PanelButton {
    readonly actor: St.Button;
    private readonly label: St.Label;
    private foreground = '#ffffff';
    private readonly hoverId: number;
    private readonly clickId: number;

    constructor(iconName: string, onClick: () => void) {
        const box = new St.BoxLayout({ style_class: 'nokta-panel-button-box' });
        box.add_child(
            new St.Icon({
                style_class: 'nokta-panel-button-icon',
                gicon: new Gio.ThemedIcon({ name: iconName }),
                y_align: Clutter.ActorAlign.CENTER,
            }),
        );
        this.label = new St.Label({ style_class: 'nokta-panel-button-label', y_align: Clutter.ActorAlign.CENTER });
        box.add_child(this.label);
        this.actor = new St.Button({ style_class: 'nokta-panel-button', child: box, x_expand: true });
        this.hoverId = this.actor.connect('notify::hover', () => this.paint());
        this.clickId = this.actor.connect('clicked', onClick);
        this.paint();
    }

    set text(text: string) {
        this.label.text = text;
    }

    setForeground(color: string): void {
        this.foreground = color;
        this.paint();
    }

    destroy(): void {
        this.actor.disconnect(this.hoverId);
        this.actor.disconnect(this.clickId);
    }

    private paint(): void {
        const alpha = this.actor.hover ? BUTTON_HOVER_ALPHA : BUTTON_ALPHA;
        this.actor.style = `background-color: ${withAlpha(this.foreground, alpha)};`;
    }
}

/** The open notch while nothing plays: the date, then notifications and focus. */
export class IdlePanel {
    readonly actor: St.BoxLayout;
    private readonly date: St.Label;
    private readonly notifications: PanelButton;
    private readonly focus: PanelButton;

    constructor(handlers: PanelHandlers) {
        this.actor = setVertical(new St.BoxLayout({ style_class: 'nokta-panel' }));
        this.date = new St.Label({ style_class: 'nokta-panel-date' });
        this.notifications = new PanelButton('preferences-system-notifications-symbolic', () =>
            handlers.openNotifications(),
        );
        this.focus = new PanelButton('alarm-symbolic', () => handlers.toggleFocus());
        const buttons = new St.BoxLayout({ style_class: 'nokta-panel-buttons' });
        buttons.add_child(this.notifications.actor);
        buttons.add_child(this.focus.actor);
        this.actor.add_child(this.date);
        this.actor.add_child(buttons);
    }

    show(content: PanelContent): void {
        this.date.text = content.date;
        this.notifications.text = content.notifications;
        this.focus.text = content.focus;
    }

    setForeground(color: string): void {
        this.notifications.setForeground(color);
        this.focus.setForeground(color);
    }

    destroy(): void {
        this.notifications.destroy();
        this.focus.destroy();
        this.actor.destroy();
    }
}
