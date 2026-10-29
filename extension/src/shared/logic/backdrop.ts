import { luminance, mix, textOn } from './color.js';
import type { Palette, ThemeColors } from './theme.js';

/** How much darker the cover shows behind the player, so white text reads on any cover. */
export const BACKDROP_DARKEN = 0.45;

const HEX = /^#[0-9a-f]{6}$/i;

export interface BackdropState {
    /** `[appearance] cover_backdrop`. */
    on: boolean;
    /** What the notch shows: the open player is `expanded`. */
    view: string;
    /** The daemon's blurred cover, empty without one. */
    backdrop: string;
}

/** The blurred cover to show behind the notch, or null to show the theme's own. */
export function backdropFor(state: BackdropState): string | null {
    return state.on && state.view === 'expanded' && state.backdrop ? state.backdrop : null;
}

/** The colors over the blurred cover: white text on it darkened, the cover's color as the accent. */
export function backdropPalette(colors: ThemeColors, cover: string | null, backdrop: string): Palette {
    const tint = cover !== null && HEX.test(cover) ? cover : null;
    const covered = colors.useAlbumAccent ? tint : null;
    const accent = covered ? (luminance(covered) > 0.15 ? covered : mix(covered, '#ffffff', 0.35)) : '#ffffff';
    return {
        theme: 'picture',
        // Where the picture does not reach; the ears show the cover too.
        background: tint ? mix(tint, '#000000', 0.6) : '#000000',
        backgroundOpacity: 1,
        gradient: null,
        direction: [0, 1],
        foreground: '#ffffff',
        accent,
        onAccent: textOn(accent),
        border: 'rgba(255, 255, 255, 0.14)',
        light: false,
        picture: { path: backdrop, darken: BACKDROP_DARKEN },
    };
}
