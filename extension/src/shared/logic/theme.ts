import { accentFor, darkenTo, luminance, mix, textOn } from './color.js';

/** The values `[appearance] theme` takes; only `custom` uses the color settings. */
export const THEMES = ['midnight', 'graphite', 'glass', 'aurora', 'paper', 'custom'] as const;
export type ThemeName = (typeof THEMES)[number];

/** The color settings, which the custom theme uses. */
export interface ThemeColors {
    background: string;
    backgroundOpacity: number;
    foreground: string;
    accent: string;
    useAlbumAccent: boolean;
}

/** How the notch looks right now, with the cover's color worked in. */
export interface Palette {
    theme: ThemeName;
    /** The body's top color and the ears' color. */
    background: string;
    backgroundOpacity: number;
    /** The body's bottom color, or null for a flat body. */
    gradient: string | null;
    foreground: string;
    /** Progress, equalizer, the OSD bar and the play button. */
    accent: string;
    /** Icons on an accent-filled control. */
    onAccent: string;
    /** A hairline around the body, as a CSS color, or null. */
    border: string | null;
    /** Dark text on a light notch. */
    light: boolean;
}

const HEX = /^#[0-9a-f]{6}$/i;

function palette(theme: ThemeName, base: Omit<Palette, 'theme' | 'onAccent'>): Palette {
    return { theme, ...base, onAccent: textOn(base.accent) };
}

/**
 * The palette for `theme`; an unknown theme is midnight. `cover` is the
 * cover's color from the daemon, used for the accent when the cover accent
 * setting is on, and for aurora's tint.
 */
export function paletteFor(theme: string, colors: ThemeColors, cover: string | null): Palette {
    const covered = colors.useAlbumAccent && cover !== null && HEX.test(cover) ? cover : null;
    const accent = (fallback: string) => covered ?? fallback;
    switch (theme) {
        case 'custom':
            return palette('custom', {
                background: colors.background,
                backgroundOpacity: colors.backgroundOpacity,
                gradient: null,
                foreground: colors.foreground,
                accent: accentFor(colors.useAlbumAccent, cover ?? '', colors.accent),
                border: null,
                light: luminance(colors.background) > 0.5,
            });
        case 'graphite':
            return palette('graphite', {
                background: '#1c1c1e',
                backgroundOpacity: 1,
                gradient: null,
                foreground: '#f5f5f7',
                accent: accent('#e5e5ea'),
                border: 'rgba(255, 255, 255, 0.08)',
                light: false,
            });
        case 'glass':
            return palette('glass', {
                background: '#2a2a32',
                backgroundOpacity: 0.62,
                gradient: '#0c0c10',
                foreground: '#ffffff',
                accent: accent('#ffffff'),
                border: 'rgba(255, 255, 255, 0.14)',
                light: false,
            });
        case 'aurora': {
            const tint = cover !== null && HEX.test(cover) ? cover : null;
            if (!tint) break;
            return palette('aurora', {
                background: darkenTo(mix(tint, '#000000', 0.6), 0.06),
                backgroundOpacity: 1,
                gradient: mix(tint, '#000000', 0.93),
                foreground: '#ffffff',
                accent: covered ? (luminance(covered) > 0.15 ? covered : mix(covered, '#ffffff', 0.35)) : '#ffffff',
                border: null,
                light: false,
            });
        }
        case 'paper':
            return palette('paper', {
                background: '#f5f5f7',
                backgroundOpacity: 1,
                gradient: null,
                foreground: '#1d1d1f',
                accent: covered ? darkenTo(covered, 0.25) : '#007aff',
                border: 'rgba(0, 0, 0, 0.08)',
                light: true,
            });
    }
    return palette('midnight', {
        background: '#000000',
        backgroundOpacity: 1,
        gradient: null,
        foreground: '#ffffff',
        accent: accent('#ffffff'),
        border: null,
        light: false,
    });
}
