/**
 * What the OSD row shows: a bar filled to `fraction` (none when null) and a
 * text. Without a bar, `detail` is shown on the right; `urgent` turns it red.
 */
export interface OsdContent {
    fraction: number | null;
    text: string;
    detail?: string;
    urgent?: boolean;
    /** A device's battery level, 0 to 100, drawn before the detail. */
    battery?: number | null;
}

const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

/** The icons GNOME's media keys show for a muted microphone or speaker. */
const MUTED_MICROPHONE = 'microphone-sensitivity-muted';
const MUTED_SPEAKER = 'audio-volume-muted';

/**
 * The content for one osdWindowManager.show() request. A level
 * shows the bar and the percentage, else the label is shown alone. A
 * muted microphone or speaker says so in place of an empty bar at 0 %.
 * `iconNames` are the request's themed icon names.
 */
export function osdContent(
    level: number | null | undefined,
    maxLevel: number | null | undefined,
    label: string | null | undefined,
    iconNames: readonly string[] = [],
): OsdContent {
    if (!label) {
        if (iconNames.some((name) => name.startsWith(MUTED_MICROPHONE))) return { fraction: null, text: 'Microphone off' };
        if (iconNames.some((name) => name.startsWith(MUTED_SPEAKER))) return { fraction: null, text: 'Muted' };
    }
    if (isNumber(level)) {
        const max = isNumber(maxLevel) && maxLevel > 0 ? maxLevel : 1;
        const fraction = Math.min(1, Math.max(0, level / max));
        return { fraction, text: `${Math.round(Math.max(0, level) * 100)}%` };
    }
    return { fraction: null, text: label ?? '' };
}

/** Caps Lock or Num Lock turned on or off. */
export const lockKeyContent = (key: string, on: boolean): OsdContent => ({
    fraction: null,
    text: `${key} ${on ? 'on' : 'off'}`,
});

export interface InputSourceChange {
    /** The ids of the layout before and after; null when there is none. */
    previous: string | null;
    current: string | null;
    /** How many layouts the user has. */
    sources: number;
}

/** A layout change is worth showing when it replaces another one the user picked. */
export function inputSourceShown({ previous, current, sources }: InputSourceChange): boolean {
    return sources > 1 && previous !== null && current !== null && previous !== current;
}
