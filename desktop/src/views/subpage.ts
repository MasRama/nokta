import { icon } from '../icons.js';

/**
 * A page that a home tile opens: a back arrow and its title, then a body the
 * feature draws. As the extension's panel/page.ts.
 */
export class SubPage {
    readonly element: HTMLDivElement;
    private readonly label: HTMLSpanElement;

    constructor(title: string, body: HTMLElement, onBack: () => void, actions: readonly HTMLElement[] = []) {
        this.element = document.createElement('div');
        this.element.className = 'nokta-subpage';
        const back = document.createElement('button');
        back.className = 'nokta-button nokta-subpage-back';
        back.append(icon('go-previous-symbolic', 16));
        back.addEventListener('click', onBack);
        const label = document.createElement('span');
        label.className = 'nokta-subpage-title';
        label.textContent = title;
        this.label = label;
        const header = document.createElement('div');
        header.className = 'nokta-subpage-header';
        // Buttons at the header's right end, like the clipboard's.
        const end = document.createElement('div');
        end.className = 'nokta-subpage-actions';
        end.append(...actions);
        header.append(back, label, end);
        this.element.append(header, body);
    }

    /** A page that shows one of several things names the one it shows. */
    setTitle(title: string): void {
        this.label.textContent = title;
    }
}
