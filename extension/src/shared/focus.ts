import type Clutter from 'gi://Clutter';
import St from 'gi://St';

import type { KeyAction } from './logic/keyboard.js';

const DIRECTIONS: Record<Exclude<KeyAction, 'close'>, St.DirectionType> = {
    next: St.DirectionType.TAB_FORWARD,
    previous: St.DirectionType.TAB_BACKWARD,
    up: St.DirectionType.UP,
    down: St.DirectionType.DOWN,
    left: St.DirectionType.LEFT,
    right: St.DirectionType.RIGHT,
};

/** The actor with the keyboard focus, or null. */
export const keyFocus = (): Clutter.Actor | null => (global.stage as Clutter.Stage).get_key_focus();

/**
 * Lets every button under `root` take the keyboard focus, so a view needs
 * no `can_focus` of its own; a button turned off (not reactive) is left
 * alone. St.Button presses itself on Enter and Space once it has focus.
 */
export function focusButtons(root: Clutter.Actor): void {
    for (let child = root.get_first_child(); child; child = child.get_next_sibling()) {
        if (child instanceof St.Button && child.reactive) child.can_focus = true;
        focusButtons(child);
    }
}

/** Focuses the first button in `root`; false when it has none. */
export function focusFirst(root: St.Widget): boolean {
    focusButtons(root);
    return root.navigate_focus(null, St.DirectionType.TAB_FORWARD, false);
}

/**
 * Moves the focus inside `root` like St's focus groups: Tab and Shift+Tab
 * go round, the arrows go to the nearest button that way. From outside
 * `root` it starts at the first (or, going back, the last) button.
 */
export function moveFocus(root: St.Widget, action: Exclude<KeyAction, 'close'>): boolean {
    focusButtons(root);
    const focus = keyFocus();
    const direction = DIRECTIONS[action];
    if (!focus || focus === root || !root.contains(focus)) {
        const start = action === 'previous' ? St.DirectionType.TAB_BACKWARD : St.DirectionType.TAB_FORWARD;
        return root.navigate_focus(null, start, false);
    }
    return root.navigate_focus(focus, direction, action === 'next' || action === 'previous');
}
