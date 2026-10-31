import { afterEach, describe, expect, it } from 'vitest';

import { memoryLowRequest } from '../src/alerts.js';
import type { Props } from '../src/bridge/bridge.js';
import { MockBridge } from '../src/bridge/mock.js';
import { MonitorNotch } from '../src/monitor-notch.js';
import type { Frames } from '../src/notch/notch.js';
import { System } from '../src/system.js';
import { DEFAULT_BEHAVIOR } from '@ext/features/settings/logic/parse.js';

/** Frames that never come: the springs stay put, the views still switch. */
const STILL: Frames = { now: () => 0, request: () => 1, cancel: () => {} };

/** Alerts without their motion, which happy-dom cannot run. */
const QUIET: Props = { Appearance: { alert_motion: false } };

const GB = 1e9;
/** 42 % CPU, 6 of 16 GB, no temperature, 1.5 MB/s down and 40 kB/s up. */
const USAGE = [0.42, 6 * GB, 16 * GB, null, 1_500_000, 40_000];

const mounted: MonitorNotch[] = [];

async function mount(initial: Record<string, Props> = {}) {
    const bridge = new MockBridge({
        Settings1: { ...QUIET, Home: { toggles: [], tiles: ['system'] } },
        ...initial,
    });
    const root = document.createElement('div');
    document.body.append(root);
    const notch = new MonitorNotch(bridge, { systemUses24h: () => true, setHit: () => {}, onPointer: () => {} }, root, STILL);
    mounted.push(notch);
    await notch.start(600);
    const shown = () => root.querySelector<HTMLElement>('.nokta-shown');
    const tile = (name: string) => root.querySelector<HTMLElement>(`[data-tile="${name}"]`)!;
    const values = () => [...root.querySelectorAll<HTMLElement>('.nokta-system-value')].map((v) => v.textContent);
    const watches = () => bridge.calls.filter((c) => c.iface === 'System1').map((c) => c.method);
    return { bridge, notch, root, shown, tile, values, watches };
}

afterEach(() => {
    mounted.splice(0).forEach((notch) => notch.stop());
    document.body.replaceChildren();
});

describe('System1 over the bridge', () => {
    it('reads a sample only while it watches, an unknown temperature as NaN', async () => {
        const bridge = new MockBridge({ System1: { Usage: USAGE } });
        const system = new System(bridge, () => {}, () => {});
        await system.attach();
        expect(system.usage).toBeNull();
        system.watch();
        system.watch();
        expect(system.usage?.cpu).toBe(0.42);
        expect(system.usage?.temperature).toBeNaN();
        system.unwatch();
        expect(system.usage).toBeNull();
        expect(bridge.calls.map((c) => c.method)).toEqual(['Watch', 'Unwatch']);
    });

    it('takes no sample while nobody watches, as all zero', async () => {
        const bridge = new MockBridge({ System1: { Usage: [0, 0, 0, null, 0, 0] } });
        const system = new System(bridge, () => {}, () => {});
        await system.attach();
        system.watch();
        expect(system.usage).toBeNull();
    });
});

describe('the memory alert', () => {
    it('names the app using the most, in red, unless the setting is off', () => {
        const request = memoryLowRequest(15 * GB, 16 * GB, 'chrome', { memoryAlert: true }, DEFAULT_BEHAVIOR, true);
        expect(request?.content.text).toBe('Memory is almost full');
        expect(request?.content.detail).toBe('chrome');
        expect(request?.tone).toBe('urgent');
        expect(request?.kind).toBe('memory');
        expect(memoryLowRequest(15 * GB, 16 * GB, 'chrome', { memoryAlert: false }, DEFAULT_BEHAVIOR, true)).toBeNull();
    });

    it('shows in the notch', async () => {
        const { bridge, shown } = await mount();
        bridge.signal('System1', 'MemoryLow', 15 * GB, 16 * GB, '');
        expect(shown()?.textContent).toContain('Memory is almost full');
        expect(shown()?.textContent).toContain('15.0 / 16.0 GB');
        expect(shown()?.classList).toContain('nokta-osd-urgent');
    });
});

describe('the System page', () => {
    it('watches while it is open and shows each sample', async () => {
        const { bridge, notch, shown, tile, values, watches } = await mount({ System1: { Usage: USAGE } });
        notch.open(true);
        tile('system').click();
        expect(shown()?.classList).toContain('nokta-pages');
        expect(watches()).toEqual(['Watch']);
        expect(values()).toEqual(['42%', '6.0 / 16.0 GB', '–', '↓ 1.5 MB/s  ↑ 40.0 kB/s']);
        bridge.set('System1', { Usage: [0.1, 7 * GB, 16 * GB, 45.4, 0, 0] });
        expect(values()[0]).toBe('10%');
        expect(values()[2]).toBe('45 °C');
        shown()!.querySelector<HTMLElement>('.nokta-subpage-back')!.click();
        expect(watches()).toEqual(['Watch', 'Unwatch']);
    });

    it('draws the last samples as the CPU line, newest on the right', async () => {
        const { bridge, notch, root, tile } = await mount({ System1: { Usage: USAGE } });
        notch.open(true);
        tile('system').click();
        bridge.set('System1', { Usage: [1, 7 * GB, 16 * GB, null, 0, 0] });
        const bars = [...root.querySelectorAll<HTMLElement>('.nokta-system-spark-bar')];
        expect(bars).toHaveLength(30);
        expect(bars.at(-1)?.style.height).toBe('18px');
        expect(bars.at(-2)?.style.height).toBe('8px');
        expect(bars[0].style.height).toBe('1px');
    });

    it('stops watching when the notch closes', async () => {
        const { notch, tile, watches } = await mount({ System1: { Usage: USAGE } });
        notch.open(true);
        tile('system').click();
        notch.close();
        expect(watches()).toEqual(['Watch', 'Unwatch']);
    });
});
