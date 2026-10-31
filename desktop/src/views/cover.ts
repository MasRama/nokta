import { icon } from '../icons.js';
import { fileUrl } from '../platform.js';

/** The track's cover as a rounded square, or a note when there is none. */
export class Cover {
    readonly element: HTMLDivElement;
    private readonly note: HTMLSpanElement;
    private artPath: string | null = null;

    constructor(size: number, radius: number) {
        this.element = document.createElement('div');
        this.element.className = 'nokta-cover';
        Object.assign(this.element.style, { width: `${size}px`, height: `${size}px`, borderRadius: `${radius}px` });
        this.note = icon('audio-x-generic-symbolic', Math.round(size / 2));
        this.element.append(this.note);
    }

    /** `artPath` is a file in the core's cache, or empty. */
    set(artPath: string): void {
        if (artPath === this.artPath) return;
        this.artPath = artPath;
        // JSON quoting keeps a quote in the path inside the CSS string.
        this.element.style.backgroundImage = artPath ? `url(${JSON.stringify(fileUrl(artPath))})` : '';
        this.element.classList.toggle('nokta-cover-empty', !artPath);
        this.note.hidden = !!artPath;
    }

    /** A `box-shadow` under the cover, or '' for none. */
    setShadow(shadow: string): void {
        this.element.style.boxShadow = shadow;
    }
}
