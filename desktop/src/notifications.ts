import type { Bridge } from './bridge/bridge.js';

/** A toast an app showed, as `Notifications1.Posted` sends it. */
export interface Toast {
    /** Windows' id: the same id again is the same toast, updated. */
    id: string;
    /** The app's id: toasts from one app stack. */
    appId: string;
    app: string;
    title: string;
    body: string;
    /** A picture in the cache, the toast's logo or the app's icon; null for none. */
    icon: string | null;
    /** The icon is cropped to a circle. */
    round: boolean;
    buttons: string[];
}

/**
 * A toast's plain text as markup, for the extension's `notificationLines`,
 * which reads GNOME's markup: `<` and `&` stay as they are.
 */
export const asMarkup = (text: string): string =>
    text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** `Posted`'s arguments as a toast; null when they are not one. */
export function toastFrom(args: readonly unknown[]): Toast | null {
    const [id, appId, app, title, body, icon, round, buttons] = args;
    const texts = [id, appId, app, title, body, icon];
    if (!texts.every((t) => typeof t === 'string') || typeof round !== 'boolean' || !Array.isArray(buttons)) return null;
    const [i, a, n, t, b, p] = texts as string[];
    return {
        id: i,
        appId: a,
        app: n,
        title: t,
        body: b,
        icon: p || null,
        round,
        buttons: buttons.filter((label): label is string => typeof label === 'string'),
    };
}

/**
 * Notifications1, only on Windows: each toast another app shows, read from
 * Windows' notification database, which the notch shows as the extension
 * shows a GNOME banner.
 */
export class Notifications {
    private stop: (() => void) | null = null;

    constructor(
        private readonly bridge: Bridge,
        private readonly onPosted: (toast: Toast) => void,
    ) {}

    attach(): void {
        this.detach();
        this.stop = this.bridge.onSignal('Notifications1', 'Posted', (...args) => {
            const toast = toastFrom(args);
            if (toast) this.onPosted(toast);
        });
    }

    detach(): void {
        this.stop?.();
        this.stop = null;
    }

    /** Opens what a click on the toast opens, or on its button at `button`. */
    activate(id: string, button: number | null): void {
        void this.bridge.call('Notifications1', 'Activate', id, button ?? -1).catch((err: unknown) => {
            console.warn('Nokta: cannot open the notification', err);
        });
    }
}
