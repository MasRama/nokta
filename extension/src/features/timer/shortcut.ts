import type Gio from 'gi://Gio';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import { shortcutKeys } from './logic/shortcut.js';

const KEY = 'focus-shortcut';

/** The focus shortcut, bound through the extension's own GSettings key. */
export class FocusShortcut {
    private bound = false;

    constructor(
        private readonly settings: Gio.Settings,
        onPressed: () => void,
    ) {
        if (typeof Main.wm.addKeybinding !== 'function') return;
        const action = Main.wm.addKeybinding(
            KEY,
            settings,
            Meta.KeyBindingFlags.IGNORE_AUTOREPEAT,
            Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW,
            onPressed,
        );
        this.bound = action !== Meta.KeyBindingAction.NONE;
    }

    /** Follows `[timer] shortcut`; GNOME rebinds when the key changes. */
    set(setting: string): void {
        const keys = shortcutKeys(setting);
        const current = this.settings.get_strv(KEY);
        if (current.length !== keys.length || current.some((key, i) => key !== keys[i]))
            this.settings.set_strv(KEY, keys);
    }

    destroy(): void {
        if (this.bound) Main.wm.removeKeybinding(KEY);
        this.bound = false;
    }
}
