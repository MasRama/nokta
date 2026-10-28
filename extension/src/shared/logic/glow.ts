/** What an alert is about, for the colour of the glow under the notch. */
export type AlertTone = 'urgent' | 'success' | 'accent' | { color: string };

export const GLOW_COLORS = { urgent: '#ff453a', success: '#30d158' } as const;

/** Red when urgent, green for a success or the charger, a timer's own colour, else the accent. */
export function glowColor(tone: AlertTone, accent: string): string {
    if (typeof tone === 'object') return tone.color;
    return tone === 'accent' ? accent : GLOW_COLORS[tone];
}
