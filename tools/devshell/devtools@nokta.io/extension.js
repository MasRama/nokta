// Development only, never shipped. Loaded by tools/devshell/run.sh into an
// isolated headless shell so shot.sh and hover.sh can use Screenshot and Eval.
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

export default class DevTools extends Extension {
    enable() {
        global.context.unsafe_mode = true;
        if (Main.layoutManager._startingUp) {
            this._startupId = Main.layoutManager.connect('startup-complete', () => this._tidy());
        } else {
            this._tidy();
        }
    }

    // Screenshots should show the desktop, not the startup overview or the
    // "unsafe mode" notification this extension itself causes.
    _tidy() {
        Main.overview.hide();
        for (const source of Main.messageTray.getSources()) source.destroy();
    }

    disable() {
        if (this._startupId) Main.layoutManager.disconnect(this._startupId);
        this._startupId = 0;
        global.context.unsafe_mode = false;
    }
}
