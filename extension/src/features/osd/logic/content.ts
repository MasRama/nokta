/**
 * What the OSD row shows: a bar filled to `fraction` (none when null) and a
 * text. Without a bar, `detail` is shown on the right; `urgent` turns it red.
 */
export interface OsdContent {
    fraction: number | null;
    text: string;
    detail?: string;
    urgent?: boolean;
}

const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

/**
 * The content for one osdWindowManager.show() request. A level
 * shows the bar and the percentage, else the label is shown alone.
 */
export function osdContent(
    level: number | null | undefined,
    maxLevel: number | null | undefined,
    label: string | null | undefined,
): OsdContent {
    if (isNumber(level)) {
        const max = isNumber(maxLevel) && maxLevel > 0 ? maxLevel : 1;
        const fraction = Math.min(1, Math.max(0, level / max));
        return { fraction, text: `${Math.round(Math.max(0, level) * 100)}%` };
    }
    return { fraction: null, text: label ?? '' };
}

export const capsLockContent = (on: boolean): OsdContent => ({
    fraction: null,
    text: on ? 'Caps Lock on' : 'Caps Lock off',
});
