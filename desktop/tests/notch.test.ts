import { describe, expect, it } from 'vitest';

import { DEFAULT_APPEARANCE } from '@ext/features/settings/logic/parse.js';
import { paletteFor } from '@ext/shared/logic/theme.js';

import { Notch, type Box, type Frames, type NotchStyle } from '../src/notch/notch.js';
import { notchPath } from '../src/notch/path.js';

const STYLE: NotchStyle = { ...DEFAULT_APPEARANCE };
const PALETTE = paletteFor('midnight', DEFAULT_APPEARANCE, null);

/** Frames that run only when the test steps them, 1/60 s apart. */
class FakeFrames implements Frames {
    private time = 0;
    private waiting = new Map<number, () => void>();
    private next = 0;

    now(): number {
        return this.time;
    }

    request(callback: () => void): number {
        this.waiting.set(++this.next, callback);
        return this.next;
    }

    cancel(id: number): void {
        this.waiting.delete(id);
    }

    /** Runs frames until none is asked for; returns how many ran. */
    runAll(): number {
        let count = 0;
        while (this.waiting.size > 0 && count < 1000) {
            this.time += 1000 / 60;
            const callbacks = [...this.waiting.values()];
            this.waiting.clear();
            for (const callback of callbacks) callback();
            count++;
        }
        return count;
    }
}

function setup() {
    const hits: Box[] = [];
    const frames = new FakeFrames();
    const notch = new Notch(STYLE, PALETTE, (hit) => hits.push(hit), frames);
    document.body.append(notch.element);
    notch.setArea(500);
    return { notch, hits, frames };
}

const shapeOf = (notch: Notch) => notch.element.querySelector('.nokta-shape')!.getAttribute('d');

describe('Notch', () => {
    it('sits at the top centre and takes the pointer only over itself', () => {
        const { notch, hits } = setup();
        notch.jumpTo(180, 32);
        // (500 - 196) / 2 = 152: the left ear's outer edge.
        expect(hits.at(-1)).toEqual({ x: 152, y: 0, width: 196, height: 32 });
        expect(shapeOf(notch)).toBe(notchPath(180, 32, 14, 8, 152));
        expect(notch.bodyRect(180, 32)).toEqual({ x: 160, y: 0, width: 180, height: 32 });
    });

    it('takes room for the whole motion while it opens, then only its own', () => {
        const { notch, hits, frames } = setup();
        notch.jumpTo(180, 32);
        hits.length = 0;
        notch.resizeTo(420, 150, 'open');
        const room = hits[0];
        expect(room.width).toBeGreaterThan(436);
        expect(room.height).toBeGreaterThan(150);
        expect(frames.runAll()).toBeGreaterThan(10);
        expect(hits.at(-1)).toEqual({ x: 32, y: 0, width: 436, height: 150 });
        expect(shapeOf(notch)).toBe(notchPath(420, 150, 22, 8, 32));
    });

    it('keeps the views at their final size and clips them while it moves', () => {
        const { notch, frames } = setup();
        notch.jumpTo(180, 32);
        notch.resizeTo(420, 150, 'open');
        const body = notch.body;
        const clip = body.parentElement!;
        expect(body.style.width).toBe('420px');
        expect(clip.style.width).toBe('180px');
        frames.runAll();
        expect(clip.style.width).toBe('420px');
        expect(clip.style.left).toBe('40px');
        expect(body.style.left).toBe('0px');
    });

    it('bends a motion to a new size mid-way', () => {
        const { notch, hits, frames } = setup();
        notch.jumpTo(180, 32);
        notch.resizeTo(420, 150, 'open');
        frames.runAll();
        notch.resizeTo(180, 32, 'close');
        notch.resizeTo(260, 32, 'width');
        frames.runAll();
        expect(hits.at(-1)).toEqual({ x: 112, y: 0, width: 276, height: 32 });
    });

    it('fades a glow in and out', () => {
        const { notch } = setup();
        const glow = notch.element.querySelector<SVGPathElement>('.nokta-glow')!;
        notch.setGlow('#ff0000');
        expect(glow.getAttribute('fill')).toBe('rgba(255, 0, 0, 1)');
        expect(glow.style.opacity).toBe('1');
        notch.setGlow(null);
        expect(glow.style.opacity).toBe('0');
    });

    it('fills the body with the palette, its gradient and theme', () => {
        const { notch } = setup();
        const custom = paletteFor('custom', { ...DEFAULT_APPEARANCE, background: '#102030', gradient: 'across', backgroundEnd: '#405060' }, null);
        notch.setPalette(custom);
        const stops = notch.element.querySelectorAll('stop');
        expect(stops[0].getAttribute('stop-color')).toBe('rgba(16, 32, 48, 1)');
        expect(stops[1].getAttribute('stop-color')).toBe('rgba(64, 80, 96, 1)');
        expect(notch.element.classList.contains('nokta-theme-custom')).toBe(true);
        expect(notch.element.classList.contains('nokta-theme-midnight')).toBe(false);
    });
});
