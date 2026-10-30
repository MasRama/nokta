import type Adw from 'gi://Adw';
import { ExtensionPreferences } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import { setTranslator } from './shared/logic/i18n.js';
import { fillWindow } from './prefs/window.js';

/** The settings window. GNOME runs it in its own process, never inside the shell. */
export default class NoktaPreferences extends ExtensionPreferences {
    override fillPreferencesWindow(window: Adw.PreferencesWindow): void {
        setTranslator({ gettext: (s) => this.gettext(s), ngettext: (s, p, n) => this.ngettext(s, p, n) });
        fillWindow(window, this.path);
    }
}
