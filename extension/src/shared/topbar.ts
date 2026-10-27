import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const JUST_PERFECTION = 'just-perfection-desktop@just-perfection';
// ExtensionState.ACTIVE in GNOME 46 misc/extensionUtils.js; the @girs typings
// still call it ENABLED, which is undefined at runtime.
const EXTENSION_ACTIVE = 1;

export type Restore = () => void;

let loggedJustPerfection = false;

/**
 * Moves the date menu (clock, calendar, notifications) from the center of the
 * top bar to the start of the right box, where the notch does not cover it.
 * Returns how to undo it, or null when nothing was moved.
 */
export function moveDateMenuRight(): Restore | null {
    if (Main.extensionManager.lookup(JUST_PERFECTION)?.state === EXTENSION_ACTIVE) {
        if (!loggedJustPerfection) {
            console.log('Nokta: Just Perfection is enabled, so its clock position setting is used');
            loggedJustPerfection = true;
        }
        return null;
    }
    const panel = Main.panel as unknown as PanelBoxes;
    const container = Main.panel.statusArea.dateMenu.container;
    const original = container.get_parent();
    if (original !== panel._centerBox) return null;
    const index = original.get_children().indexOf(container);
    original.remove_child(container);
    panel._rightBox.insert_child_at_index(container, 0);
    return () => {
        // Leave it alone if something else has moved it since.
        if (container.get_parent() !== panel._rightBox) return;
        panel._rightBox.remove_child(container);
        original.insert_child_at_index(container, Math.min(index, original.get_n_children()));
    };
}

/** Private panel boxes this module relies on (GNOME Shell 46). */
interface PanelBoxes {
    _centerBox: import('gi://St').default.BoxLayout;
    _rightBox: import('gi://St').default.BoxLayout;
}
