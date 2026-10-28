import Gio from 'gi://Gio';
import St from 'gi://St';
import * as BoxPointer from 'resource:///org/gnome/shell/ui/boxpointer.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import { outputIcon, outputLabel, type AudioOutput } from './logic/outputs.js';

export interface OutputMenuHandlers {
    select(id: number): void;
    /** The menu opened or closed; the notch stays open while it shows. */
    opened(open: boolean): void;
}

interface JsSignals {
    connect(signal: string, callback: (...args: never[]) => void): number;
}

/** GNOME's popup menu of sound outputs, hanging under `source`, the current one checked. */
export class OutputMenu {
    private readonly menu: PopupMenu.PopupMenu;
    private readonly manager: PopupMenu.PopupMenuManager;
    /** GNOME 48 and later destroy the UI group, the menu with it, before the extension when the shell stops. */
    private gone = false;

    constructor(
        source: St.Widget,
        private readonly handlers: OutputMenuHandlers,
    ) {
        this.menu = new PopupMenu.PopupMenu(source, 0.5, St.Side.TOP);
        this.menu.actor.add_style_class_name('nokta-output-menu');
        this.menu.actor.connect('destroy', () => (this.gone = true));
        Main.uiGroup.add_child(this.menu.actor);
        this.menu.actor.hide();
        // A JS signal the GNOME 46 typings leave out.
        (this.menu as unknown as JsSignals).connect('open-state-changed', (_menu: unknown, open: boolean) =>
            handlers.opened(open),
        );
        this.manager = new PopupMenu.PopupMenuManager(source);
        this.manager.addMenu(this.menu, 0);
    }

    open(outputs: readonly AudioOutput[], activeId: number | null): void {
        if (this.gone) return;
        this.menu.removeAll();
        for (const output of outputs) {
            const icon = new Gio.ThemedIcon({ name: outputIcon(output) });
            const item = new PopupMenu.PopupImageMenuItem(outputLabel(output), icon);
            item.setOrnament(output.id === activeId ? PopupMenu.Ornament.CHECK : PopupMenu.Ornament.NONE);
            item.connect('activate', () => this.handlers.select(output.id));
            this.menu.addMenuItem(item);
        }
        // GNOME's own menus open with the animation flags; the typings say boolean.
        this.menu.open(BoxPointer.PopupAnimation.FULL as unknown as boolean);
    }

    close(): void {
        if (!this.gone) this.menu.close(BoxPointer.PopupAnimation.NONE as unknown as boolean);
    }

    destroy(): void {
        if (this.gone) return;
        this.gone = true;
        this.manager.removeMenu(this.menu);
        this.menu.destroy();
    }
}
