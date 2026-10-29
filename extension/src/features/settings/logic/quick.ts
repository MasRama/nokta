import { paletteFor, THEMES, type ThemeColors, type ThemeName } from '../../../shared/logic/theme.js';

/** The motion choices on the settings page, as `[appearance] animation_speed`. */
export const MOTION_PRESETS: readonly { label: string; speed: number }[] = [
    { label: 'Fast', speed: 0.75 },
    { label: 'Normal', speed: 1 },
    { label: 'Slow', speed: 1.5 },
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
}

/** Aurora takes its tint from the cover; with none playing its swatch still shows one. */
const SAMPLE_COVER = '#c2477f';

/** One swatch per theme, in THEMES order; `cover` is the playing cover's color, if any. */
export function themeSwatches(colors: ThemeColors, cover: string | null): ThemeSwatch[] {
    return THEMES.map((theme) => {
        const palette = paletteFor(theme, colors, cover ?? SAMPLE_COVER);
        return {
            theme,
            label: theme.charAt(0).toUpperCase() + theme.slice(1),
            top: palette.background,
            bottom: palette.gradient ?? palette.background,
            direction: palette.direction,
            foreground: palette.foreground,
            accent: palette.accent,
        };
    });
}
