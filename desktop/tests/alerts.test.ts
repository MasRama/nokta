import { afterEach, describe, expect, it, vi } from 'vitest';

import { behaviorFrom } from '@ext/features/settings/logic/parse.js';

import { deviceRequest, osdRequest } from '../src/alerts.js';
import type { Props } from '../src/bridge/bridge.js';
import { MockBridge } from '../src/bridge/mock.js';
import { MonitorNotch } from '../src/monitor-notch.js';
import type { Frames } from '../src/notch/notch.js';

/** Frames that never come: the springs stay put, the views still switch. */
const STILL: Frames = { now: () => 0, request: () => 1, cancel: () => {} };

const DEFAULTS = behaviorFrom({});

async function mount(initial: Record<string, Props> = {}) {
    const bridge = new MockBridge(initial);
    const root = document.createElement('div');
    const notch = new MonitorNotch(
        bridge,
        { systemUses24h: () => true, setHit: () => {}, onPointer: () => {} },
        root,
        STILL,
    );
    await notch.start(600);
    const shown = () => root.querySelector('.nokta-view.nokta-shown')?.classList[1];
    const text = () => root.querySelector('.nokta-osd-text')?.textContent;
    return { bridge, root, shown, text };
}

afterEach(() => vi.useRealTimers());

describe('osdRequest', () => {
    it('shows the volume with its level and icon', () => {
        const request = osdRequest('volume', 0.5, '', DEFAULTS);
        expect(request?.content).toEqual({ fraction: 0.5, text: '50%' });
        expect(request?.icon).toBe('audio-volume-medium-symbolic');
        expect(request?.tone).toBeUndefined();
    });

    it('says muted in place of an empty bar', () => {
        expect(osdRequest('muted', 0, '', DEFAULTS)?.content).toEqual({ fraction: null, text: 'Muted' });
    });

    it('leaves the volume and the brightness to Windows when replace_osd is off', () => {
        const behavior = behaviorFrom({ replace_osd: false });
        expect(osdRequest('volume', 0.5, '', behavior)).toBeNull();
        expect(osdRequest('brightness', 0.5, '', behavior)).toBeNull();
        expect(osdRequest('caps-lock', 1, '', behavior)).not.toBeNull();
    });

    it('shows the lock keys and the layout as their settings say', () => {
        expect(osdRequest('caps-lock', 1, '', DEFAULTS)?.content.text).toBe('Caps Lock on');
        // Num Lock is off by default.
        expect(osdRequest('num-lock', 1, '', DEFAULTS)).toBeNull();
        expect(osdRequest('num-lock', 0, '', behaviorFrom({ show_num_lock: true }))?.content.text).toBe('Num Lock off');
        expect(osdRequest('layout', -1, 'English (United States)', DEFAULTS)?.content.text).toBe('English (United States)');
        expect(osdRequest('layout', -1, '', DEFAULTS)).toBeNull();
        expect(osdRequest('eject', 1, '', DEFAULTS)).toBeNull();
    });
});

describe('deviceRequest', () => {
    it('glows green for the charger and fills the battery', () => {
        const request = deviceRequest('charger-plugged', '', 64, DEFAULTS, true);
        expect(request?.content).toMatchObject({ text: 'Charging', detail: '64%', battery: 64 });
        expect(request?.tone).toBe('success');
        expect(request?.motion).toBe('fill');
        expect(request?.durationMs).toBe(DEFAULTS.alertDurationMs);
    });

    it('pulses red for a battery nearly out', () => {
        const request = deviceRequest('battery-critical', '', 8, DEFAULTS, true);
        expect(request?.content.urgent).toBe(true);
        expect(request?.tone).toBe('urgent');
        expect(request?.motion).toBe('pulse');
        expect(request?.kind).toBe('battery');
    });

    it('kicks without the motions, and shows nothing with device alerts off', () => {
        expect(deviceRequest('bluetooth-connected', 'Buds', -1, DEFAULTS, false)?.motion).toBe('kick');
        expect(deviceRequest('charger-plugged', '', 64, behaviorFrom({ device_alerts: false }), true)).toBeNull();
        expect(deviceRequest('dock-attached', '', 64, DEFAULTS, true)).toBeNull();
    });
});

describe('alerts in the notch', () => {
    it('shows the volume for osd_duration_ms, then goes back', async () => {
        vi.useFakeTimers();
        const { bridge, root, shown, text } = await mount();
        bridge.signal('Osd1', 'Show', 'volume', 0.3, '');
        expect(shown()).toBe('nokta-osd');
        expect(text()).toBe('30%');
        expect(root.querySelector<HTMLElement>('.nokta-osd-fill')?.style.transform).toBe('scaleX(0.3)');
        vi.advanceTimersByTime(DEFAULTS.osdDurationMs);
        expect(shown()).toBe('nokta-idle');
    });

    it('shows a device alert with its battery over the player', async () => {
        vi.useFakeTimers();
        const { bridge, root, shown, text } = await mount({
            Media1: { Available: true, PlaybackStatus: 'Playing', Title: 'Song' },
        });
        bridge.signal('Devices1', 'Alert', 'bluetooth-connected', 'WH-1000XM5', 80);
        expect(shown()).toBe('nokta-osd');
        expect(text()).toBe('WH-1000XM5');
        expect(root.querySelector('.nokta-osd-detail')?.textContent).toBe('80%');
        expect(root.querySelector<HTMLElement>('.nokta-osd-battery')?.hidden).toBe(false);
        vi.advanceTimersByTime(DEFAULTS.alertDurationMs);
        expect(shown()).toBe('nokta-collapsed');
    });

    it('turns an urgent alert red', async () => {
        const { bridge, root } = await mount();
        bridge.signal('Devices1', 'Alert', 'battery-critical', '', 8);
        expect(root.querySelector('.nokta-osd')?.classList.contains('nokta-osd-urgent')).toBe(true);
    });
});
