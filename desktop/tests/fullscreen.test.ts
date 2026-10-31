import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Props } from '../src/bridge/bridge.js';
import { MockBridge } from '../src/bridge/mock.js';
import { MonitorNotch } from '../src/monitor-notch.js';
import type { Box, Frames } from '../src/notch/notch.js';

/** Frames that never come: the springs stay put, the views still switch. */
const STILL: Frames = { now: () => 0, request: () => 1, cancel: () => {} };

async function mount(initial: Record<string, Props> = {}) {
    const bridge = new MockBridge(initial);
    const root = document.createElement('div');
    const hits: Box[] = [];
    let fullscreen: (on: boolean) => void = () => {};
    let pointer: (inside: boolean) => void = () => {};
    const notch = new MonitorNotch(
        bridge,
        {
            systemUses24h: () => true,
            setHit: (hit) => hits.push(hit),
            onPointer: (cb) => (pointer = cb),
            onFullscreen: (cb) => (fullscreen = cb),
        },
        root,
        STILL,
    );
    await notch.start(600);
    const element = () => root.querySelector<HTMLElement>('.nokta-notch');
    const shown = () => root.querySelector('.nokta-shown')?.className ?? '';
    return { bridge, notch, hits, element, shown, fullscreen, pointer };
}

afterEach(() => vi.useRealTimers());

describe('over a fullscreen app', () => {
    it('hides the notch and takes no clicks, then comes back', async () => {
        const { element, hits, fullscreen } = await mount();
        fullscreen(true);
        expect(element()?.style.visibility).toBe('hidden');
        expect(hits.at(-1)?.width).toBe(0);
        fullscreen(false);
        expect(element()?.style.visibility).toBe('');
        expect(hits.at(-1)?.width).toBeGreaterThan(0);
    });

    it('does not open under the pointer', async () => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        const { shown, fullscreen, pointer } = await mount();
        fullscreen(true);
        pointer(true);
        vi.advanceTimersByTime(2000);
        fullscreen(false);
        expect(shown()).not.toContain('nokta-panel');
    });

    it('lets a low battery through by default, not the volume', async () => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        // happy-dom fails the battery's pulse when the alert ends: no motions here.
        const { bridge, element, shown, fullscreen } = await mount({ Settings1: { Appearance: { alert_motion: false } } });
        fullscreen(true);
        bridge.signal('Osd1', 'Show', 'volume', 0.5, '');
        expect(element()?.style.visibility).toBe('hidden');
        bridge.signal('Devices1', 'Alert', 'battery-critical', '', 8);
        expect(element()?.style.visibility).toBe('');
        expect(shown()).toContain('nokta-osd');
        vi.advanceTimersByTime(10_000);
        expect(element()?.style.visibility).toBe('hidden');
    });

    it('lets everything through with fullscreen_alerts = "all", nothing with "none"', async () => {
        const all = await mount({ Settings1: { Behavior: { fullscreen_alerts: 'all' } } });
        all.fullscreen(true);
        all.bridge.signal('Osd1', 'Show', 'volume', 0.5, '');
        expect(all.element()?.style.visibility).toBe('');
        const none = await mount({ Settings1: { Behavior: { fullscreen_alerts: 'none' } } });
        none.fullscreen(true);
        none.bridge.signal('Devices1', 'Alert', 'battery-critical', '', 8);
        expect(none.element()?.style.visibility).toBe('hidden');
    });
});
