/** A scroll step moves the volume by this share of its normal maximum. */
export const VOLUME_STEP = 0.05;

/** The volume after one step, kept within 0 and `max`; a volume already above `max` is not raised. */
export function steppedVolume(volume: number, max: number, action: 'volume-up' | 'volume-down'): number {
    const step = Math.round(max * VOLUME_STEP);
    if (action === 'volume-down') return Math.max(0, volume - step);
    return volume >= max ? volume : Math.min(max, volume + step);
}

const ICONS = ['audio-volume-low-symbolic', 'audio-volume-medium-symbolic', 'audio-volume-high-symbolic'];

/** The icon GNOME's volume OSD shows for `fraction` of the normal maximum. */
export function volumeIcon(fraction: number, muted: boolean): string {
    if (muted || fraction <= 0) return 'audio-volume-muted-symbolic';
    return ICONS[Math.min(2, Math.max(0, Math.ceil(3 * fraction) - 1))];
}
