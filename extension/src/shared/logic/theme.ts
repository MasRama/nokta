import { accentFor, darkenTo, luminance, mix, textOn } from './color.js';

/** The values `[appearance] theme` takes; only `custom` uses the color settings. */
export const THEMES = ['midnight', 'graphite', 'glass', 'aurora', 'paper', 'custom', 'picture'] as const;
export type ThemeName = (typeof THEMES)[number];

/** The values `[appearance] gradient` takes; custom's fill runs that way, or is flat. */
export const GRADIENTS = ['none', 'down', 'across', 'diagonal'] as const;

/** The color settings, which the custom theme uses. */
export interface ThemeColors {
    background: string;
    backgroundOpacity: number;
    foreground: string;
    accent: string;
    useAlbumAccent: boolean;
    /** One of GRADIENTS; flat when missing. */
    gradient?: string;
    /** Where the gradient ends. */
    backgroundEnd?: string;
}

/** How the notch looks right now, with the cover's color worked in. */
export interface Palette {
    theme: ThemeName;
    /** The body's top color and the ears' color. */
    background: string;
    backgroundOpacity: number;
    /** The color the body runs to along `direction`, or null for a flat body. */
    gradient: string | null;
    /** The gradient's way across the body, a unit vector: [0, 1] runs down, [1, 0] left to right. */
    direction: [number, number];
    foreground: string;
    /** Progress, equalizer, the OSD bar and the play button. */
    accent: string;
    /** Icons on an accent-filled control. */
    onAccent: string;
    /** A hairline around the body, as a CSS color, or null. */
    border: string | null;
    /** Dark text on a light notch. */
    light: boolean;
    /** The image the body shows over its fill, darkened by `darken`, or null. */
    picture: { path: string; darken: number } | null;
}

/** The picture theme's image as the daemon prepared it, and how dark to show it. */
export interface PictureState {
    /** Empty while there is no picture. */
    path: string;
    /** Its vivid color, `#rrggbb` or empty. */
    color: string;
    /** The mean color of its top half, `#rrggbb` or empty. */
    tone: string;
    darken: number;
}

const HEX = /^#[0-9a-f]{6}$/i;

/** The settings that choose a theme by the system's light or dark style. */
export interface ThemeChoice {
    theme: string;
    followSystemStyle: boolean;
    lightTheme: string;
}

/** The theme in use: `lightTheme` under a light system style while following it, else `theme`. */
export function themeFor(choice: ThemeChoice, dark: boolean): string {
    return choice.followSystemStyle && !dark ? choice.lightTheme : choice.theme;
}

/** The key a theme picked now is saved to, so the notch shows it under the current style. */
export function themeKeyFor(choice: ThemeChoice, dark: boolean): 'theme' | 'light_theme' {
    return choice.followSystemStyle && !dark ? 'light_theme' : 'theme';
}

const DOWN: [number, number] = [0, 1];

/** The unit vector a gradient runs along; down for anything unknown. */
export function gradientDirection(name: string): [number, number] {
    switch (name) {
        case 'across':
            return [1, 0];
        case 'diagonal':
            return [Math.SQRT1_2, Math.SQRT1_2];
        default:
            return [...DOWN];
    }
}

function palette(
    theme: ThemeName,
    base: Omit<Palette, 'theme' | 'onAccent' | 'direction' | 'picture'>,
    direction: [number, number] = DOWN,
    picture: Palette['picture'] = null,
): Palette {
    return { theme, ...base, direction: [...direction], onAccent: textOn(base.accent), picture };
}

/**
 * The palette for `theme`; an unknown theme is midnight. `cover` is the
 * cover's color from the daemon, used for the accent when the cover accent
 * setting is on, and for aurora's tint. `picture` is the picture theme's
 * image; without one that theme draws like midnight.
 */
export function paletteFor(
    theme: string,
    colors: ThemeColors,
    cover: string | null,
    picture: PictureState | null = null,
): Palette {
    const covered = colors.useAlbumAccent && cover !== null && HEX.test(cover) ? cover : null;
    const accent = (fallback: string) => covered ?? fallback;
    switch (theme) {
        case 'custom': {
            const end = colors.gradient && colors.gradient !== 'none' && colors.backgroundEnd && HEX.test(colors.backgroundEnd)
                ? colors.backgroundEnd
                : null;
            return palette('custom', {
                background: colors.background,
                backgroundOpacity: colors.backgroundOpacity,
                gradient: end,
                foreground: colors.foreground,
                accent: accentFor(colors.useAlbumAccent, cover ?? '', colors.accent),
                border: null,
                light: luminance(end ? mix(colors.background, end, 0.5) : colors.background) > 0.5,
            }, end ? gradientDirection(colors.gradient ?? 'none') : DOWN);
        }
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
    if (theme === 'picture') return picturePalette(colors, covered, picture);
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

/** The body shows the picture; its darkened tone colors the ears and decides the text. */
function picturePalette(colors: ThemeColors, covered: string | null, picture: PictureState | null): Palette {
    if (!picture?.path) return { ...paletteFor('midnight', colors, covered), theme: 'picture' };
    const darken = Math.min(0.8, Math.max(0, picture.darken));
    const background = mix(HEX.test(picture.tone) ? picture.tone : '#000000', '#000000', darken);
    const light = textOn(background) === '#000000';
    const foreground = light ? '#1d1d1f' : '#ffffff';
    const own = HEX.test(picture.color) ? picture.color : null;
    const vivid = covered ?? own;
    return palette(
        'picture',
        {
            background,
            backgroundOpacity: 1,
            gradient: null,
            foreground,
            accent: vivid ? (light ? darkenTo(vivid, 0.25) : vivid) : foreground,
            border: light ? 'rgba(0, 0, 0, 0.08)' : 'rgba(255, 255, 255, 0.14)',
            light,
        },
        DOWN,
        { path: picture.path, darken },
    );
}
