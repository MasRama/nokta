import type { MediaSnapshot } from '@ext/features/media/logic/snapshot.js';

import { Cover } from './cover.js';
import { Equalizer, type LevelSource } from './equalizer.js';

/**
 * The closed notch, widened for a moment when the song changes: the cover,
 * the title and the artist on one line, and the equalizer.
 */
export class PeekView {
    readonly element: HTMLDivElement;
    private readonly cover = new Cover(22, 6);
    private readonly title: HTMLSpanElement;
    private readonly artist: HTMLSpanElement;
    private readonly equalizer: Equalizer;
    private playing = false;

    constructor(levels: LevelSource) {
        this.equalizer = new Equalizer(levels);
        this.element = document.createElement('div');
        this.element.className = 'nokta-view nokta-peek';
        const text = document.createElement('div');
        text.className = 'nokta-peek-text';
        this.title = document.createElement('span');
        this.title.className = 'nokta-peek-title';
        this.artist = document.createElement('span');
        this.artist.className = 'nokta-peek-artist';
        text.append(this.title, this.artist);
        this.element.append(this.cover.element, text, this.equalizer.element);
    }

    /** Room at the left for the privacy dots. */
    setInset(px: number): void {
        this.element.style.paddingLeft = px > 0 ? `${px}px` : '';
    }

    update(snapshot: MediaSnapshot, accent: string): void {
        this.cover.set(snapshot.artPath);
        this.title.textContent = snapshot.title;
        this.artist.textContent = snapshot.artists.join(', ');
        this.artist.hidden = this.artist.textContent === '';
        this.equalizer.setColor(accent);
        this.playing = snapshot.playbackStatus === 'Playing';
    }

    setActive(active: boolean): void {
        this.equalizer.setPlaying(active && this.playing);
    }

    destroy(): void {
        this.equalizer.destroy();
    }
}
