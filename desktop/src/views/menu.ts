import { _ } from '@ext/shared/logic/i18n.js';

import type { Box } from '../notch/notch.js';

export interface NotchMenuHandlers {
    openSettings(): void;
    clearShelf(): void;
    setClipboardPaused(paused: boolean): void;
}

/** What the menu shows when it opens. */
export interface NotchMenuState {
    shelfItems: number;
    /** Null hides the item: the clipboard history is off. */
    clipboardPaused: boolean | null;
}

/** Room kept between the menu and the window's edge. */
const MARGIN = 8;

/**
 * The notch's right-click menu, as the extension's panel/menu.ts, drawn in
 * the page where the pointer is. Windows has no Do Not Disturb to switch,
 * so it has Settings, Clear shelf and Pause clipboard.
 */
export class NotchMenu {
    readonly element: HTMLDivElement;
    private readonly clearShelf: HTMLButtonElement;
    private readonly pauseClipboard: HTMLButtonElement;

    /** `changed` runs when the menu opens or closes, so the window's click box follows it. */
    constructor(
        handlers: NotchMenuHandlers,
        private readonly changed: () => void,
    ) {
        this.element = document.createElement('div');
        this.element.className = 'nokta-menu';
        this.element.setAttribute('role', 'menu');
        this.element.hidden = true;
        const item = (label: string, onClick: () => void): HTMLButtonElement => {
            const button = document.createElement('button');
            button.className = 'nokta-menu-item';
            button.type = 'button';
            button.setAttribute('role', 'menuitem');
            const text = document.createElement('span');
            text.textContent = label;
            button.append(text);
            button.addEventListener('click', () => {
                this.close();
                onClick();
            });
            this.element.append(button);
            return button;
        };
        item(_('Settings'), () => handlers.openSettings());
        this.clearShelf = item(_('Clear shelf'), () => handlers.clearShelf());
        this.pauseClipboard = item(_('Pause clipboard'), () =>
            handlers.setClipboardPaused(this.pauseClipboard.getAttribute('aria-checked') !== 'true'),
        );
        this.pauseClipboard.setAttribute('role', 'menuitemcheckbox');
        const sw = document.createElement('span');
        sw.className = 'nokta-menu-switch';
        this.pauseClipboard.append(sw);
    }

    get isOpen(): boolean {
        return !this.element.hidden;
    }

    /** Opens at (`x`, `y`) in the page, kept inside a window `width` x `height` CSS px. */
    open(x: number, y: number, state: NotchMenuState, width: number, height: number): void {
        this.clearShelf.hidden = state.shelfItems === 0;
        this.pauseClipboard.hidden = state.clipboardPaused === null;
        this.pauseClipboard.setAttribute('aria-checked', String(state.clipboardPaused === true));
        this.element.hidden = false;
        const { offsetWidth: w, offsetHeight: h } = this.element;
        this.element.style.left = `${Math.max(MARGIN, Math.min(x, width - w - MARGIN))}px`;
        this.element.style.top = `${Math.max(MARGIN, Math.min(y, height - h - MARGIN))}px`;
        this.changed();
    }

    close(): void {
        if (this.element.hidden) return;
        this.element.hidden = true;
        this.changed();
    }

    /** Where it is in the page, while open. */
    box(): Box | null {
        if (this.element.hidden) return null;
        return {
            x: this.element.offsetLeft,
            y: this.element.offsetTop,
            width: this.element.offsetWidth,
            height: this.element.offsetHeight,
        };
    }
}
