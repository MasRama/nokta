import { afterEach, describe, expect, it, vi } from 'vitest';

import { MockBridge } from '../src/bridge/mock.js';
import { MonitorNotch } from '../src/monitor-notch.js';
import type { Frames } from '../src/notch/notch.js';

/** Frames that never come: the springs stay put, the views still switch. */
const STILL: Frames = { now: () => 0, request: () => 1, cancel: () => {} };

const mounted: MonitorNotch[] = [];

async function mount() {
    const root = document.createElement('div');
    document.body.append(root);
    const host = {
        systemUses24h: () => true,
        setHit: () => {},
        onPointer: () => {},
        openSettings: vi.fn(),
        takeKeyboard: vi.fn(),
        releaseKeyboard: vi.fn(),
    };
    const notch = new MonitorNotch(new MockBridge(), host, root, STILL);
    mounted.push(notch);
    await notch.start(600);
    const done = vi.fn();
    const tour = () => root.querySelector<HTMLElement>('.nokta-tour')!;
    const text = (name: string) => tour().querySelector(`.nokta-tour-${name}`)!.textContent;
    const press = (name: string) => tour().querySelector<HTMLElement>(`.nokta-tour-${name}`)!.click();
    return { notch, host, done, start: () => notch.startTour({ done }), tour, text, press };
}

afterEach(() => {
    mounted.splice(0).forEach((notch) => notch.stop());
    document.body.replaceChildren();
});

describe('the first-run tour', () => {
    it('walks through its steps held open with the keyboard, naming the Win key', async () => {
        const { host, done, start, tour, text, press } = await mount();
        start();
        expect(tour().classList.contains('nokta-shown')).toBe(true);
        expect(host.takeKeyboard).toHaveBeenCalled();
        expect(text('title')).toBe('This is Nokta');
        expect(document.activeElement?.className).toBe('nokta-tour-next');
        press('next');
        expect(text('title')).toBe('Open it');
        expect(text('body')).toBe('Rest the pointer on it or press Win+Alt+N.');
        press('next');
        expect(tour().querySelector<HTMLElement>('.nokta-tour-settings')!.hidden).toBe(true);
        press('next');
        expect(text('next')).toBe('Done');
        expect(tour().querySelector<HTMLElement>('.nokta-tour-settings')!.hidden).toBe(false);
        press('next');
        expect(done).toHaveBeenCalledOnce();
        expect(tour().classList.contains('nokta-shown')).toBe(false);
        expect(host.releaseKeyboard).toHaveBeenCalled();
    });

    it('ends on Skip or Escape, and stays when another window takes the keyboard', async () => {
        const { done, start, tour, press } = await mount();
        start();
        press('skip');
        expect(done).toHaveBeenCalledTimes(1);
        start();
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        expect(done).toHaveBeenCalledTimes(2);
        start();
        window.dispatchEvent(new Event('blur'));
        expect(done).toHaveBeenCalledTimes(2);
        expect(tour().classList.contains('nokta-shown')).toBe(true);
    });

    it('opens the settings from its last step', async () => {
        const { host, done, start, press } = await mount();
        start();
        press('next');
        press('next');
        press('next');
        press('settings');
        expect(done).toHaveBeenCalledOnce();
        expect(host.openSettings).toHaveBeenCalled();
    });

    it('waits while a fullscreen app hides the notch', async () => {
        const { notch, done, start, tour } = await mount();
        notch.setFullscreen(true);
        start();
        expect(tour().classList.contains('nokta-shown')).toBe(false);
        notch.setFullscreen(false);
        expect(tour().classList.contains('nokta-shown')).toBe(true);
        expect(done).not.toHaveBeenCalled();
    });
});
