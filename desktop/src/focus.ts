import { keyAction, KEYS, type KeyAction } from '@ext/shared/logic/keyboard.js';

/** The page's names for the keys the extension reads as keysyms. */
const KEYSYMS: Record<string, number> = {
    Escape: KEYS.Escape,
    Tab: KEYS.Tab,
    ArrowLeft: KEYS.Left,
    ArrowUp: KEYS.Up,
    ArrowRight: KEYS.Right,
    ArrowDown: KEYS.Down,
};

/** What `event` does in the notch opened from the keyboard, as the extension reads it. */
export function keyActionOf(event: KeyboardEvent): KeyAction | null {
    const keysym = KEYSYMS[event.key];
    return keysym === undefined ? null : keyAction(keysym, event.shiftKey);
}

/** The buttons under `root` that can take the focus: on screen and turned on. */
function buttons(root: HTMLElement): HTMLButtonElement[] {
    return [...root.querySelectorAll('button')].filter((b) => !b.disabled && !b.closest('[hidden]'));
}

/** Focuses the first button in `root`; false when it has none. */
export function focusFirst(root: HTMLElement): boolean {
    const first = buttons(root)[0];
    first?.focus();
    return !!first;
}

/** Where `el` is on screen: its centre. */
function centre(el: HTMLElement): [number, number] {
    const r = el.getBoundingClientRect();
    return [r.left + r.width / 2, r.top + r.height / 2];
}

/**
 * Moves the focus inside `root` as the extension does: Tab and Shift+Tab go
 * round, the arrows go to the nearest button that way. From outside `root`
 * it starts at the first (or, going back, the last) button.
 */
export function moveFocus(root: HTMLElement, action: Exclude<KeyAction, 'close'>): boolean {
    const all = buttons(root);
    if (all.length === 0) return false;
    const at = all.indexOf(document.activeElement as HTMLButtonElement);
    const current = all[at];
    if (!current) {
        all[action === 'previous' ? all.length - 1 : 0]?.focus();
        return true;
    }
    if (action === 'next' || action === 'previous') {
        const step = action === 'next' ? 1 : all.length - 1;
        all[(at + step) % all.length]?.focus();
        return true;
    }
    const [x, y] = centre(current);
    const ahead = ([bx, by]: [number, number]): number | null => {
        const dx = bx - x;
        const dy = by - y;
        const along = { left: -dx, right: dx, up: -dy, down: dy }[action];
        const across = action === 'left' || action === 'right' ? Math.abs(dy) : Math.abs(dx);
        // Ahead, and more along the way than across it.
        return along > 0 && along >= across ? along + across * 2 : null;
    };
    let best: HTMLButtonElement | null = null;
    let bestScore = Infinity;
    for (const button of all) {
        const score = ahead(centre(button));
        if (score !== null && score < bestScore) {
            best = button;
            bestScore = score;
        }
    }
    best?.focus();
    return !!best;
}
