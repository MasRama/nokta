import type { NoktaIcon } from '../../shared/logic/icon-names.js';
import { paletteFor, type Palette, type ThemeColors } from '../../shared/logic/theme.js';

/** The sidebar's icon for each page of SETTINGS_PAGES, from Nokta's own set. */
const PAGE_ICONS: Record<string, NoktaIcon> = {
    appearance: 'dark-style',
    behavior: 'settings',
    home: 'home',
};

export function pageIcon(page: string): NoktaIcon | null {
    return PAGE_ICONS[page] ?? null;
}

/** The song the preview plays; its cover's color tints aurora and, when that is on, the accent. */
export const SAMPLE_SONG = {
    title: 'Midnight City',
    artist: 'M83',
    cover: '#5b8cff',
    /** How far it has played, 0 to 1. */
    position: 0.42,
} as const;

/** The largest corners the preview's notch can draw at its size. */
const MAX_CORNER = 28;
const MAX_EAR = 16;

export interface PreviewAppearance extends ThemeColors {
    theme: string;
    progressLine: boolean;
    cornerRadius: number;
    earRadius: number;
}

/** What the preview draws: the notch open on the sample song. */
export interface PreviewModel {
    palette: Palette;
    title: string;
    artist: string;
    /** The progress line's share, or null while the line is off. */
    progress: number | null;
    cornerRadius: number;
    earRadius: number;
}

export function previewModel(appearance: PreviewAppearance): PreviewModel {
    return {
        palette: paletteFor(appearance.theme, appearance, SAMPLE_SONG.cover),
        title: SAMPLE_SONG.title,
        artist: SAMPLE_SONG.artist,
        progress: appearance.progressLine ? SAMPLE_SONG.position : null,
        cornerRadius: Math.min(Math.max(appearance.cornerRadius, 0), MAX_CORNER),
        earRadius: Math.min(Math.max(appearance.earRadius, 0), MAX_EAR),
    };
}
