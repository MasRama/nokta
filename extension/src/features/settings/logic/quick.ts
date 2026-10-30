import { _, N_ } from '../../../shared/logic/i18n.js';
import { paletteFor, THEMES, type PictureState, type ThemeColors, type ThemeName } from '../../../shared/logic/theme.js';

const THEME_LABELS: Record<ThemeName, string> = {
    midnight: N_('Midnight'),
    graphite: N_('Graphite'),
    glass: N_('Glass'),
    aurora: N_('Aurora'),
    paper: N_('Paper'),
    custom: N_('Custom'),
    picture: N_('Picture'),
};

/** The motion choices on the settings page, as `[appearance] animation_speed`. */
export const MOTION_PRESETS: readonly { label: string; speed: number }[] = [
    { label: N_('Fast'), speed: 0.75 },
    { label: N_('Normal'), speed: 1 },
    { label: N_('Slow'), speed: 1.5 },
];

/** The preset `speed` is, or null for a speed set by hand in the settings window. */
export function motionPreset(speed: number): number | null {
    const index = MOTION_PRESETS.findIndex((preset) => Math.abs(preset.speed - speed) < 0.01);
    return index < 0 ? null : index;
}

/** A small notch in one theme's colors. */
export interface ThemeSwatch {
    theme: ThemeName;
    label: string;
    top: string;
    bottom: string;
    /** The way from `top` to `bottom`, as the palette's direction. */
    direction: [number, number];
    foreground: string;
    accent: string;
    /** The picture theme's image, drawn over the colors; null for the others. */
    picture: string | null;
}

/** Aurora takes its tint from the cover; with none playing its swatch still shows one. */
const SAMPLE_COVER = '#c2477f';

/**
 * One swatch per theme, in THEMES order; `cover` is the playing cover's
 * color, if any, and `picture` the picture theme's image.
 */
export function themeSwatches(colors: ThemeColors, cover: string | null, picture: PictureState | null = null): ThemeSwatch[] {
    return THEMES.map((theme) => {
        const palette = paletteFor(theme, colors, cover ?? SAMPLE_COVER, picture);
        return {
            theme,
            label: _(THEME_LABELS[theme]), // i18n: runtime
            top: palette.background,
            bottom: palette.gradient ?? palette.background,
            direction: palette.direction,
            foreground: palette.foreground,
            accent: palette.accent,
            picture: palette.picture?.path ?? null,
        };
    });
}
