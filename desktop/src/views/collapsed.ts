import { coverLook } from '@ext/features/media/logic/cover.js';
import type { MediaSnapshot } from '@ext/features/media/logic/snapshot.js';

import { Cover } from './cover.js';
import { Equalizer, type LevelSource } from './equalizer.js';

/** The closed notch while a player is there: a small cover and the equalizer. */
export class CollapsedView {
    readonly element: HTMLDivElement;
    private readonly cover = new Cover(22, 6);
    private readonly equalizer: Equalizer;
    private playing = false;

    constructor(levels: LevelSource) {
        this.equalizer = new Equalizer(levels);
        this.element = document.createElement('div');
        this.element.className = 'nokta-view nokta-collapsed';
        this.element.append(this.cover.element, this.equalizer.element);
    }

    update(snapshot: MediaSnapshot, accent: string): void {
        this.cover.set(snapshot.artPath);
        this.equalizer.setColor(accent);
        this.playing = snapshot.playbackStatus === 'Playing';
        // Paused, the cover dims and shrinks a little; playing again, it springs back.
        const { opacity, scale } = coverLook(this.playing);
        this.cover.element.style.opacity = String(opacity / 255);
        this.cover.element.style.transform = `scale(${scale})`;
        this.cover.element.classList.toggle('nokta-cover-paused', !this.playing);
    }

    /** The equalizer steps only while the view is on screen. */
    setActive(active: boolean): void {
        this.equalizer.setPlaying(active && this.playing);
    }

    destroy(): void {
        this.equalizer.destroy();
    }
}
