/** How much taller the open player gets while it shows the lyric row, as the extension's. */
export const LYRIC_ROW_EXTRA = 44;

/** The lyric the row shows, as the extension's `LyricNow`. */
export interface LyricNow {
    text: string;
    /** The next line with words, or null after the last. */
    next: string | null;
    /** The current line romanized, shown in the next line's place; null when it has none. */
    romanized: string | null;
    /** The current line's index, to tell lines apart. */
    index: number;
    fraction: number;
    msLeft: number;
    playing: boolean;
}

/**
 * The open player's lyric row: the current line, lighting up as it is
 * sung, and the next one under it, dimmed (or the current line's
 * romanization). A new line slides up into place.
 */
export class LyricLine {
    readonly element: HTMLDivElement;
    private readonly base: HTMLSpanElement;
    private readonly lit: HTMLSpanElement;
    private readonly next: HTMLSpanElement;
    /** The line and whether it plays, as the fill was last started for. */
    private key = '';
    private index: number | null = null;

    constructor() {
        this.element = document.createElement('div');
        this.element.className = 'nokta-lyric-row';
        this.element.hidden = true;
        const current = document.createElement('div');
        current.className = 'nokta-lyric';
        this.base = document.createElement('span');
        this.base.className = 'nokta-lyric-base';
        this.lit = document.createElement('span');
        this.lit.className = 'nokta-lyric-lit';
        current.append(this.base, this.lit);
        this.next = document.createElement('span');
        this.next.className = 'nokta-lyric-next';
        this.element.append(current, this.next);
    }

    /** Shows the lyric, or hides the row when it is null. */
    show(now: LyricNow | null): void {
        if (now === null) {
            this.element.hidden = true;
            this.index = null;
            this.key = '';
            return;
        }
        this.element.hidden = false;
        const moved = this.index !== null && now.index !== this.index;
        this.index = now.index;
        this.base.textContent = this.lit.textContent = now.text;
        this.next.textContent = now.romanized ?? now.next ?? '';
        this.next.classList.toggle('nokta-lyric-romanized', now.romanized !== null);
        this.fill(now);
        if (moved) {
            this.element.classList.remove('nokta-lyric-moved');
            void this.element.offsetWidth;
            this.element.classList.add('nokta-lyric-moved');
        }
    }

    /** Lights the line from where it is to its end over the time left, once per line. */
    private fill({ index, fraction, msLeft, playing, text }: LyricNow): void {
        const key = `${index}\n${text}\n${playing}`;
        if (key === this.key) return;
        this.key = key;
        const clip = (f: number) => `inset(0 ${(1 - f) * 100}% 0 0)`;
        this.lit.style.transition = 'none';
        this.lit.style.clipPath = clip(fraction);
        if (!playing || msLeft <= 0) return;
        void this.lit.offsetWidth;
        this.lit.style.transition = `clip-path ${msLeft}ms linear`;
        this.lit.style.clipPath = clip(1);
    }
}
