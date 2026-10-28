/** What GNOME's privacy indicators say is in use. */
export interface PrivacyState {
    camera: boolean;
    microphone: boolean;
    /** The screen is shared or recorded. */
    screen: boolean;
}

export const NO_PRIVACY: Readonly<PrivacyState> = { camera: false, microphone: false, screen: false };

/** A dot on the notch: green for the camera, orange for recording. */
export type Dot = 'camera' | 'recording';

export const DOT_COLORS: Readonly<Record<Dot, string>> = { camera: '#33d17a', recording: '#ff9500' };

export const DOT_SIZE = 5;
export const DOT_GAP = 4;
/** Closest a dot comes to the notch's left edge. */
const MIN_INSET = 8;
/** Space between the last dot and the content beside it. */
const CONTENT_GAP = 8;

/** The dots to show, top to bottom, like the dots on a phone. */
export function dotsFor(state: PrivacyState, enabled: boolean): Dot[] {
    if (!enabled) return [];
    const dots: Dot[] = [];
    if (state.camera) dots.push('camera');
    if (state.microphone || state.screen) dots.push('recording');
    return dots;
}

export interface DotsPlace {
    /** From the notch body's left edge to the first dot. */
    left: number;
    /** From the top, so the row is centered on the closed notch. */
    top: number;
    /** Where content beside the dots may start; 0 without dots. */
    contentLeft: number;
}

/**
 * Where a row of `count` dots goes on a closed notch `height` tall with
 * `cornerRadius` corners: the first dot centered on the corner's circle,
 * so it lines up with the curve, and the row centered vertically.
 */
export function dotsPlace(height: number, cornerRadius: number, count: number): DotsPlace {
    const left = Math.max(MIN_INSET, Math.round(cornerRadius - DOT_SIZE / 2));
    const top = Math.max(0, Math.round((height - DOT_SIZE) / 2));
    const width = count * DOT_SIZE + Math.max(0, count - 1) * DOT_GAP;
    return { left, top, contentLeft: count === 0 ? 0 : left + width + CONTENT_GAP };
}
