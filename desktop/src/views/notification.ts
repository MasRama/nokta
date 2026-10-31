import { MAX_BUTTONS } from '@ext/features/notifications/logic/actions.js';
import { textOn, withAlpha } from '@ext/shared/logic/color.js';

import { icon, setIcon } from '../icons.js';

/** The second line is dimmed next to the title, as in the extension. */
const DETAIL_OPACITY = 180 / 255;
const CLOSE_OPACITY = 150 / 255;
const BELL = 'nokta-bell-symbolic';

export interface NotificationHandlers {
    /** A click on the notification itself. */
    onClick(): void;
    /** A click on the button at this place in the row. */
    onButton(index: number): void;
    onClose(): void;
}

/** What `show` draws. */
export interface ShownNotification {
    title: string;
    /** The line under the title; none when empty. */
    detail: string;
    /** The app's picture as a URL the page loads; null draws `symbol` on the accent. */
    picture: string | null;
    /** The icon drawn without a picture; a bell when not set. */
    symbol?: string;
    /** The picture is cropped to a circle. */
    round: boolean;
    /** Its buttons' labels, at most MAX_BUTTONS show. */
    buttons: readonly string[];
    /** The stacked count, or null for one. */
    badge: string | null;
}

/**
 * A notification in the notch: the app's picture with a count when several
 * from the same app stacked, the title and one line under it, a row of
 * buttons for its actions, and a close button. As the extension's
 * notifications/view.ts.
 */
export class NotificationView {
    readonly element: HTMLDivElement;
    private readonly main: HTMLButtonElement;
    private readonly square: HTMLSpanElement;
    private readonly picture: HTMLSpanElement;
    private readonly bell: HTMLSpanElement;
    private readonly badge: HTMLSpanElement;
    private readonly title: HTMLSpanElement;
    private readonly detail: HTMLSpanElement;
    private readonly row: HTMLDivElement;
    private readonly buttons: HTMLButtonElement[] = [];
    private accent = '#ffffff';

    constructor(handlers: NotificationHandlers) {
        this.element = document.createElement('div');
        this.element.className = 'nokta-view nokta-notification';
        // The text is a button: a click on it, or on the picture, opens the notification.
        this.main = document.createElement('button');
        this.main.className = 'nokta-notification-main';
        this.main.addEventListener('click', () => handlers.onClick());
        this.square = document.createElement('span');
        this.square.className = 'nokta-notification-square';
        this.picture = document.createElement('span');
        this.picture.className = 'nokta-notification-picture';
        this.bell = icon(BELL, 18);
        this.badge = document.createElement('span');
        this.badge.className = 'nokta-notification-badge';
        this.square.append(this.picture, this.bell, this.badge);
        this.square.addEventListener('click', (event) => {
            // Not also the notch's own click, which opens it.
            event.stopPropagation();
            handlers.onClick();
        });
        this.title = document.createElement('span');
        this.title.className = 'nokta-notification-title';
        this.detail = document.createElement('span');
        this.detail.className = 'nokta-notification-detail';
        this.detail.style.opacity = String(DETAIL_OPACITY);
        const text = document.createElement('span');
        text.className = 'nokta-notification-text';
        text.append(this.title, this.detail);
        this.main.append(text);
        this.row = document.createElement('div');
        this.row.className = 'nokta-notification-buttons';
        for (let i = 0; i < MAX_BUTTONS; i++) {
            const button = document.createElement('button');
            button.className = 'nokta-button nokta-notification-button';
            button.addEventListener('click', () => handlers.onButton(i));
            this.buttons.push(button);
            this.row.append(button);
        }
        const side = document.createElement('div');
        side.className = 'nokta-notification-side';
        side.append(this.main, this.row);
        const close = document.createElement('button');
        close.className = 'nokta-button nokta-notification-close';
        close.style.opacity = String(CLOSE_OPACITY);
        close.append(icon('window-close-symbolic', 14));
        close.addEventListener('click', () => handlers.onClose());
        close.addEventListener('pointerenter', () => (close.style.opacity = '1'));
        close.addEventListener('pointerleave', () => (close.style.opacity = String(CLOSE_OPACITY)));
        this.element.append(this.square, side, close);
    }

    show({ title, detail, picture, symbol = BELL, round, buttons, badge }: ShownNotification): void {
        this.picture.style.backgroundImage = picture ? `url("${picture}")` : '';
        this.picture.hidden = picture === null;
        this.picture.classList.toggle('nokta-notification-round', round);
        this.bell.hidden = picture !== null;
        setIcon(this.bell, symbol, 18);
        // Without its own picture, a bell sits on the accent at 20 %, as a symbolic icon does on GNOME.
        this.square.style.backgroundColor = picture ? '' : withAlpha(this.accent, 0.2);
        this.square.classList.toggle('nokta-notification-symbolic', picture === null);
        this.badge.hidden = badge === null;
        this.badge.textContent = badge ?? '';
        this.title.textContent = title;
        this.title.title = title;
        this.detail.textContent = detail;
        this.detail.hidden = detail === '';
        this.buttons.forEach((button, i) => {
            button.hidden = i >= buttons.length;
            button.textContent = buttons[i] ?? '';
        });
        this.row.hidden = buttons.length === 0;
    }

    setColors(foreground: string, accent: string): void {
        this.accent = accent;
        this.element.style.setProperty('--nokta-tint', withAlpha(foreground, 0.12));
        this.element.style.setProperty('--nokta-tint-hover', withAlpha(foreground, 0.22));
        this.badge.style.backgroundColor = accent;
        this.badge.style.color = textOn(accent);
        if (!this.bell.hidden) this.square.style.backgroundColor = withAlpha(accent, 0.2);
    }
}
