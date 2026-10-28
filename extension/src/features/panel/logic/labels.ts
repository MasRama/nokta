/** The notifications tile's badge: how many wait in GNOME's message list; null for none or when GNOME does not say. */
export function notificationBadge(count: number | null): string | null {
    if (!count) return null;
    return count > 9 ? '9+' : String(count);
}
