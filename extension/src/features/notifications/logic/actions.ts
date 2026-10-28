/** At most this many of a notification's buttons show, in one row. */
export const MAX_BUTTONS = 3;

export interface NotificationButton {
    label: string;
    /** Its action's place in the notification's `actions`. */
    index: number;
}

/**
 * The buttons for a notification's actions, GNOME 46 and later: each
 * action with a label, in order, at most MAX_BUTTONS. None when `actions`
 * is not an array.
 */
export function notificationButtons(actions: unknown): NotificationButton[] {
    if (!Array.isArray(actions)) return [];
    const buttons: NotificationButton[] = [];
    actions.forEach((action: unknown, index) => {
        const label = typeof action === 'object' && action !== null ? (action as { label?: unknown }).label : null;
        if (typeof label === 'string' && label.trim() !== '') buttons.push({ label: label.trim(), index });
    });
    return buttons.slice(0, MAX_BUTTONS);
}
