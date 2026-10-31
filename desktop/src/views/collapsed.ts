import { coverLook } from '@ext/features/media/logic/cover.js';
import type { MediaSnapshot } from '@ext/features/media/logic/snapshot.js';

import { Cover } from './cover.js';
import { Equalizer, type LevelSource } from './equalizer.js';

/**
 * The closed notch while a player is there: a small cover and the
 * equalizer, whose place an indicator such as the call can take.
 */
export class CollapsedView {
    readonly element: HTMLDivElement;
    private readonly cover = new Cover(22, 6);
    private readonly equalizer: Equalizer;
    private aside: HTMLElement | null = null;
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
        this.equalizer.setPlaying(!this.aside && active && this.playing);
    }

    /** Shows `element` in the equalizer's place; null brings it back. */
    setAside(element: HTMLElement | null): void {
        if (element === this.aside) return;
        this.aside?.remove();
        this.aside = element;
        if (element) {
            this.element.append(element);
            this.equalizer.setPlaying(false);
        }
        this.equalizer.element.hidden = element !== null;
    }

    /** Room at the left for the privacy dots. */
    setInset(px: number): void {
        this.element.style.paddingLeft = px > 0 ? `${px}px` : '';
    }

    destroy(): void {
        this.equalizer.destroy();
    }
}
