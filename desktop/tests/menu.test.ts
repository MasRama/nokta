import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Props } from '../src/bridge/bridge.js';
import { MockBridge } from '../src/bridge/mock.js';
import { MonitorNotch } from '../src/monitor-notch.js';
import type { Box, Frames } from '../src/notch/notch.js';

/** Frames that never come: the springs stay put, the views still switch. */
const STILL: Frames = { now: () => 0, request: () => 1, cancel: () => {} };

const mounted: MonitorNotch[] = [];

async function mount(initial: Record<string, Props> = {}) {
    const bridge = new MockBridge(initial);
    const root = document.createElement('div');
    document.body.append(root);
    const openSettings = vi.fn();
    const hits: Box[] = [];
    let pointer: (inside: boolean) => void = () => {};
    const notch = new MonitorNotch(
        bridge,
        {
            systemUses24h: () => true,
            setHit: (hit) => hits.push(hit),
            onPointer: (cb) => (pointer = cb),
            openSettings,
        },
        root,
        STILL,
    );
    mounted.push(notch);
    await notch.start(600);
    const menu = () => root.querySelector<HTMLElement>('.nokta-menu')!;
    const items = () =>
        [...menu().querySelectorAll<HTMLElement>('.nokta-menu-item')].filter((i) => !i.hidden).map((i) => i.textContent);
    const rightClick = () =>
        root.querySelector('.nokta-notch')!.dispatchEvent(
            new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 300, clientY: 20 }),
        );
    return { bridge, root, menu, items, rightClick, openSettings, hits, pointer: (inside: boolean) => pointer(inside) };
}

afterEach(() => {
    mounted.splice(0).forEach((notch) => notch.stop());
    document.body.replaceChildren();
});

describe("the notch's right-click menu", () => {
    it('opens at the pointer with what there is to do, and its WebView menu does not', async () => {
        const { menu, items, root } = await mount({ Clipboard1: { Paused: false } });
        const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 300, clientY: 20 });
        root.querySelector('.nokta-notch')!.dispatchEvent(event);
        expect(event.defaultPrevented).toBe(true);
        expect(menu().hidden).toBe(false);
        expect(menu().style.top).toBe('20px');
        // No files on the shelf; the clipboard history is on by default.
        expect(items()).toEqual(['Settings', 'Pause clipboard']);
    });

    it('clears the shelf and pauses the clipboard', async () => {
        const shelf = { Items: [['file:///C:/a.txt', 'a.txt', 'text-x-generic']] };
        const { bridge, menu, items, rightClick, root } = await mount({ Shelf1: shelf, Clipboard1: { Paused: true } });
        rightClick();
        expect(items()).toEqual(['Settings', 'Clear shelf', 'Pause clipboard']);
        const pause = [...root.querySelectorAll<HTMLElement>('.nokta-menu-item')][2]!;
        expect(pause.getAttribute('aria-checked')).toBe('true');
        pause.click();
        expect(bridge.calls).toContainEqual({ iface: 'Clipboard1', method: 'SetPaused', args: [false] });
        expect(menu().hidden).toBe(true);
        rightClick();
        root.querySelectorAll<HTMLElement>('.nokta-menu-item')[1]!.click();
        expect(bridge.calls).toContainEqual({ iface: 'Shelf1', method: 'Clear', args: [] });
    });

    it('hides Pause clipboard while the history is off, and opens the settings', async () => {
        const { items, rightClick, root, openSettings } = await mount({ Settings1: { Clipboard: { enabled: false } } });
        rightClick();
        expect(items()).toEqual(['Settings']);
        root.querySelector<HTMLElement>('.nokta-menu-item')!.click();
        expect(openSettings).toHaveBeenCalled();
    });

    it('takes clicks while it shows, and closes on a press elsewhere or when the pointer leaves', async () => {
        const { menu, rightClick, hits, pointer } = await mount();
        const before = hits.length;
        rightClick();
        expect(hits.length).toBeGreaterThan(before);
        document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
        expect(menu().hidden).toBe(true);
        rightClick();
        menu().dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
        expect(menu().hidden).toBe(false);
        pointer(false);
        expect(menu().hidden).toBe(true);
    });
});
