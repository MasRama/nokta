import type Gio from 'gi://Gio';
import Meta from 'gi://Meta';
import type Shell from 'gi://Shell';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import { shortcutKeys } from './logic/shortcut.js';

/**
 * A shortcut bound through one of the extension's own GSettings keys, in
 * the action modes `modes`. GNOME binds keys only through GSettings, so
 * `set()` copies the config's setting into the key.
 */
export class Keybinding {
    private bound = false;

    constructor(
        private readonly settings: Gio.Settings,
        private readonly key: string,
        modes: Shell.ActionMode,
        onPressed: () => void,
    ) {
        if (typeof Main.wm.addKeybinding !== 'function') return;
        const action = Main.wm.addKeybinding(key, settings, Meta.KeyBindingFlags.IGNORE_AUTOREPEAT, modes, onPressed);
        this.bound = action !== Meta.KeyBindingAction.NONE;
    }

    /** Follows the config's setting; GNOME rebinds when the key changes. */
    set(setting: string): void {
        const keys = shortcutKeys(setting);
        const current = this.settings.get_strv(this.key);
        if (current.length !== keys.length || current.some((key, i) => key !== keys[i]))
            this.settings.set_strv(this.key, keys);
    }

    destroy(): void {
        if (this.bound) Main.wm.removeKeybinding(this.key);
        this.bound = false;
    }
}
