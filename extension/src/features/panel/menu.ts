import * as BoxPointer from 'resource:///org/gnome/shell/ui/boxpointer.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import St from 'gi://St';

export interface NotchMenuHandlers {
    openSettings(): void;
    setDoNotDisturb(on: boolean): void;
    clearShelf(): void;
    setClipboardPaused(paused: boolean): void;
}

/** What the menu shows when it opens. */
export interface NotchMenuState {
    doNotDisturb: boolean;
    shelfItems: number;
    /** Null hides the item: the clipboard history is off. */
    clipboardPaused: boolean | null;
}

/** The notch's right-click menu, a GNOME popup menu that opens where the pointer is. */
export class NotchMenu {
    /** A point at the pointer for the menu to hang from. */
    private readonly anchor = new St.Widget({ width: 1, height: 1, opacity: 0 });
    private readonly menu: PopupMenu.PopupMenu;
    private readonly manager: PopupMenu.PopupMenuManager;
    private readonly doNotDisturb: PopupMenu.PopupSwitchMenuItem;
    private readonly clearShelf: PopupMenu.PopupMenuItem;
    private readonly pauseClipboard: PopupMenu.PopupSwitchMenuItem;
    /** GNOME destroys the UI group, the anchor with it, before the extension when the shell stops. */
    private gone = false;

    constructor(handlers: NotchMenuHandlers) {
        Main.uiGroup.add_child(this.anchor);
        this.anchor.connect('destroy', () => (this.gone = true));
        this.menu = new PopupMenu.PopupMenu(this.anchor, 0, St.Side.TOP);
        this.menu.actor.add_style_class_name('nokta-menu');
        Main.uiGroup.add_child(this.menu.actor);
        this.menu.actor.hide();
        this.manager = new PopupMenu.PopupMenuManager(this.anchor);
        this.manager.addMenu(this.menu, 0);

        const settings = new PopupMenu.PopupMenuItem('Settings');
        settings.connect('activate', () => handlers.openSettings());
        this.doNotDisturb = new PopupMenu.PopupSwitchMenuItem('Do Not Disturb', false);
        this.doNotDisturb.connect('toggled', (_item, on: boolean) => handlers.setDoNotDisturb(on));
        this.clearShelf = new PopupMenu.PopupMenuItem('Clear shelf');
        this.clearShelf.connect('activate', () => handlers.clearShelf());
        this.pauseClipboard = new PopupMenu.PopupSwitchMenuItem('Pause clipboard', false);
        this.pauseClipboard.connect('toggled', (_item, on: boolean) => handlers.setClipboardPaused(on));
        this.menu.addMenuItem(settings);
        this.menu.addMenuItem(this.doNotDisturb);
        this.menu.addMenuItem(this.clearShelf);
        this.menu.addMenuItem(this.pauseClipboard);
    }

    open(x: number, y: number, state: NotchMenuState): void {
        if (this.gone) return;
        this.anchor.set_position(Math.round(x), Math.round(y));
        this.doNotDisturb.setToggleState(state.doNotDisturb);
        this.clearShelf.visible = state.shelfItems > 0;
        this.pauseClipboard.visible = state.clipboardPaused !== null;
        this.pauseClipboard.setToggleState(state.clipboardPaused === true);
        // GNOME's own menus open with the animation flags; the typings say boolean.
        this.menu.open(BoxPointer.PopupAnimation.FULL as unknown as boolean);
    }

    destroy(): void {
        if (this.gone) return;
        this.gone = true;
        this.manager.removeMenu(this.menu);
        this.menu.destroy();
        this.anchor.destroy();
    }
}
