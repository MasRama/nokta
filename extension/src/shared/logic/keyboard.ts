/** The keysyms the notch reads while it holds the keyboard (X11 keysymdef.h, as Clutter has them). */
export const KEYS = {
    Escape: 0xff1b,
    Tab: 0xff09,
    ISO_Left_Tab: 0xfe20,
    Left: 0xff51,
    Up: 0xff52,
    Right: 0xff53,
    Down: 0xff54,
} as const;

/** What a key does in the notch opened from the keyboard. */
export type KeyAction = 'close' | 'next' | 'previous' | 'up' | 'down' | 'left' | 'right';

/**
 * Escape closes, Tab and Shift+Tab move the focus along, the arrows by
 * direction; null leaves the key to the focused actor (Enter and Space
 * press a button).
 */
export function keyAction(keysym: number, shift: boolean): KeyAction | null {
    switch (keysym) {
        case KEYS.Escape:
            return 'close';
        case KEYS.Tab:
            return shift ? 'previous' : 'next';
        case KEYS.ISO_Left_Tab:
            return 'previous';
        case KEYS.Up:
            return 'up';
        case KEYS.Down:
            return 'down';
        case KEYS.Left:
            return 'left';
        case KEYS.Right:
            return 'right';
        default:
            return null;
    }
}
