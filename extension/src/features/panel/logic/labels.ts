/** The notifications button: how many wait in GNOME's message list; null when GNOME does not say. */
export function notificationsLabel(count: number | null): string {
    if (count === null) return 'Notifications';
    if (count === 0) return 'No notifications';
    return count === 1 ? '1 notification' : `${count} notifications`;
}
