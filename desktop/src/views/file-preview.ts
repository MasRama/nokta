import { withAlpha } from '@ext/shared/logic/color.js';
import { _ } from '@ext/shared/logic/i18n.js';

import { icon, setIcon } from '../icons.js';

/** What fills the picture's box: a PNG on disk, as a URL the page loads, or an icon. */
export type PreviewPicture = { kind: 'file'; url: string } | { kind: 'icon'; icon: string };

/** One button: its id, icon and label (marked with `N_`, translated here). */
export interface PreviewButton<Id extends string> {
    id: Id;
    icon: string;
    label: string;
}

/**
 * A file in the notch: its picture, a title, an optional detail line and up
 * to three buttons, two on the first row. A click on the picture presses
 * `openId` while that button shows. `kind` names it, like `nokta-download`.
 * As the extension's shared/file-preview.ts.
 */
export class FilePreview<Id extends string> {
    readonly element: HTMLDivElement;
    private readonly thumb: HTMLButtonElement;
    private readonly glyph: HTMLSpanElement;
    private readonly title: HTMLSpanElement;
    private readonly detail: HTMLSpanElement;
    private readonly buttons = new Map<Id, HTMLButtonElement>();
    private canOpen = false;

    constructor(
        kind: string,
        buttons: readonly PreviewButton<Id>[],
        private readonly openId: Id,
        onPress: (id: Id) => void,
    ) {
        this.element = document.createElement('div');
        this.element.className = `nokta-view nokta-file-preview ${kind}`;
        this.thumb = document.createElement('button');
        this.thumb.className = 'nokta-button nokta-file-preview-thumb';
        this.thumb.addEventListener('click', () => {
            if (this.canOpen) onPress(this.openId);
        });
        this.glyph = icon('', 40);
        this.thumb.append(this.glyph);
        this.title = document.createElement('span');
        this.title.className = 'nokta-file-preview-title';
        this.detail = document.createElement('span');
        this.detail.className = 'nokta-file-preview-detail';
        const text = document.createElement('div');
        text.className = 'nokta-file-preview-text';
        text.append(this.title, this.detail);
        const rows = [document.createElement('div'), document.createElement('div')];
        for (const row of rows) row.className = 'nokta-file-preview-buttons';
        buttons.forEach(({ id, icon: name, label }, i) => {
            const button = document.createElement('button');
            button.className = 'nokta-button nokta-file-preview-button';
            const caption = document.createElement('span');
            caption.textContent = _(label); // i18n: runtime
            button.append(icon(name, 14), caption);
            button.addEventListener('click', () => onPress(id));
            this.buttons.set(id, button);
            rows[i < 2 ? 0 : 1].append(button);
        });
        const side = document.createElement('div');
        side.className = 'nokta-file-preview-side';
        side.append(text, ...rows);
        this.element.append(this.thumb, side);
    }

    /** Shows `picture`, `title` and `detail` (none when empty) with the buttons in `shown`. */
    show(picture: PreviewPicture, title: string, detail: string, shown: readonly Id[]): void {
        const file = picture.kind === 'file';
        this.thumb.style.backgroundImage = file ? `url("${picture.url}")` : '';
        this.thumb.classList.toggle('nokta-file-preview-thumb-icon', !file);
        this.glyph.hidden = file;
        if (!file) setIcon(this.glyph, picture.icon, 40);
        this.title.textContent = title;
        this.title.title = title;
        this.detail.textContent = detail;
        this.detail.hidden = detail === '';
        this.setButtons(shown);
    }

    /** Changes the buttons while it shows. */
    setButtons(shown: readonly Id[]): void {
        this.canOpen = shown.includes(this.openId);
        for (const [id, button] of this.buttons) button.hidden = !shown.includes(id);
        const rows = new Set([...this.buttons.values()].map((button) => button.parentElement!));
        for (const row of rows) row.hidden = [...row.children].every((child) => (child as HTMLElement).hidden);
    }

    setForeground(color: string): void {
        this.element.style.setProperty('--nokta-tint', withAlpha(color, 0.12));
        this.element.style.setProperty('--nokta-tint-hover', withAlpha(color, 0.22));
    }
}
