import type { NoktaIcon } from '../../shared/logic/icon-names.js';
import { backdropPalette } from '../../shared/logic/backdrop.js';
import { paletteFor, type Palette, type PictureState, type ThemeColors } from '../../shared/logic/theme.js';

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
    /** The song's blurred cover behind the open player. */
    coverBackdrop?: boolean;
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

/**
 * `picture` is the picture theme's image, as the daemon prepared it. With the
 * cover behind the player, the sample song has no image: its color stands in.
 */
export function previewModel(appearance: PreviewAppearance, picture: PictureState | null = null): PreviewModel {
    return {
        palette: appearance.coverBackdrop
            ? { ...backdropPalette(appearance, SAMPLE_SONG.cover, ''), picture: null }
            : paletteFor(appearance.theme, appearance, SAMPLE_SONG.cover, picture),
        title: SAMPLE_SONG.title,
        artist: SAMPLE_SONG.artist,
        progress: appearance.progressLine ? SAMPLE_SONG.position : null,
        cornerRadius: Math.min(Math.max(appearance.cornerRadius, 0), MAX_CORNER),
        earRadius: Math.min(Math.max(appearance.earRadius, 0), MAX_EAR),
    };
}

/**
 * A cairo linear gradient's ends that match the notch's shader over a body at
 * `x`, 0 sized `width` × `height`: the shader runs along `direction` in the
 * body's own 0..1 space, so the ends are worked out in pixels from there.
 */
export function gradientEnds(
    x: number,
    width: number,
    height: number,
    direction: [number, number],
): [number, number, number, number] {
    const [dx, dy] = direction;
    const scale = Math.max(dx, dy, 1e-9);
    // The shader's t in pixels: (px / width) * vx + (py / height) * vy over |v|².
    const vx = dx / scale;
    const vy = dy / scale;
    const length = vx * vx + vy * vy;
    const ax = vx / width / length;
    const ay = vy / height / length;
    const a = ax * ax + ay * ay;
    return [x, 0, x + ax / a, ay / a];
}
