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
export const DOT_GAP = 3;

/** The dots to show, top to bottom, like the dots on a phone. */
export function dotsFor(state: PrivacyState, enabled: boolean): Dot[] {
    if (!enabled) return [];
    const dots: Dot[] = [];
    if (state.camera) dots.push('camera');
    if (state.microphone || state.screen) dots.push('recording');
    return dots;
}

/** Top offset that centers `count` stacked dots on a closed notch `height` tall. */
export function dotsTop(height: number, count: number): number {
    if (count === 0) return 0;
    const stack = count * DOT_SIZE + (count - 1) * DOT_GAP;
    return Math.max(0, Math.floor((height - stack) / 2));
}
