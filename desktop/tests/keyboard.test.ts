import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Props } from '../src/bridge/bridge.js';
import { MockBridge } from '../src/bridge/mock.js';
import { MonitorNotch } from '../src/monitor-notch.js';
import type { Frames } from '../src/notch/notch.js';

/** Frames that never come: the springs stay put, the views still switch. */
const STILL: Frames = { now: () => 0, request: () => 1, cancel: () => {} };

const PLAYING: Record<string, Props> = {
    Media1: { Available: true, PlaybackStatus: 'Playing', Title: 'Song', CanGoNext: true, CanGoPrevious: true },
};

const mounted: MonitorNotch[] = [];

async function mount(initial: Record<string, Props> = PLAYING) {
    const bridge = new MockBridge(initial);
    const root = document.createElement('div');
    document.body.append(root);
    const release = vi.fn();
    let shortcut = () => {};
    let fullscreen: (on: boolean) => void = () => {};
    const notch = new MonitorNotch(
        bridge,
        {
            systemUses24h: () => true,
            setHit: () => {},
            onPointer: () => {},
            onFullscreen: (cb) => (fullscreen = cb),
            onKeyboard: (cb) => (shortcut = cb),
            releaseKeyboard: release,
        },
        root,
        STILL,
    );
    mounted.push(notch);
    await notch.start(600);
    const shown = () => root.querySelector<HTMLElement>('.nokta-shown');
    const focused = () => document.activeElement;
    /** The buttons that can take the focus in the view that shows. */
    const buttons = () =>
        [...(shown()?.querySelectorAll('button') ?? [])].filter((b) => !b.disabled && !b.closest('[hidden]'));
    const press = (key: string, shiftKey = false) =>
        document.dispatchEvent(new KeyboardEvent('keydown', { key, shiftKey, bubbles: true }));
    return { notch, root, release, shown, buttons, focused, press, shortcut, fullscreen };
}

afterEach(() => {
    mounted.splice(0).forEach((notch) => notch.stop());
    document.body.replaceChildren();
});

describe('the open shortcut', () => {
    it('opens the player with the keyboard on its first button, and closes again', async () => {
        const { shown, buttons, focused, shortcut, release } = await mount();
        shortcut();
        expect(shown()?.classList).toContain('nokta-expanded');
        expect(focused()).toBe(buttons()[0]);
        shortcut();
        expect(shown()?.classList).not.toContain('nokta-expanded');
        expect(release).toHaveBeenCalledTimes(1);
    });

    it('closes on Escape, or when the window loses the keyboard', async () => {
        const { shown, press, shortcut, release } = await mount();
        shortcut();
        press('Escape');
        expect(shown()?.classList).not.toContain('nokta-expanded');
        shortcut();
        window.dispatchEvent(new Event('blur'));
        expect(shown()?.classList).not.toContain('nokta-expanded');
        expect(release).toHaveBeenCalledTimes(2);
    });

    it('moves the focus round the buttons with Tab and Shift+Tab', async () => {
        const { buttons, focused, press, shortcut } = await mount();
        shortcut();
        expect(buttons().length).toBeGreaterThan(1);
        press('Tab');
        expect(focused()).toBe(buttons()[1]);
        press('Tab', true);
        press('Tab', true);
        expect(focused()).toBe(buttons().at(-1));
    });

    it('leaves the keys alone while the notch is not open from the keyboard', async () => {
        const { shown, press, release } = await mount();
        press('Escape');
        expect(shown()?.classList).toContain('nokta-collapsed');
        expect(release).not.toHaveBeenCalled();
    });

    it('gives the keyboard back at once over a fullscreen app', async () => {
        const { shown, shortcut, fullscreen, release } = await mount();
        fullscreen(true);
        shortcut();
        expect(shown()?.classList).not.toContain('nokta-expanded');
        expect(release).toHaveBeenCalledTimes(1);
    });
});
