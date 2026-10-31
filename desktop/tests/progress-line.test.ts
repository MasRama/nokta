import { afterEach, describe, expect, it } from 'vitest';

import type { Props } from '../src/bridge/bridge.js';
import { MockBridge } from '../src/bridge/mock.js';
import { MonitorNotch } from '../src/monitor-notch.js';
import type { Frames } from '../src/notch/notch.js';

/** Frames that never come: the springs stay put, the views still switch. */
const STILL: Frames = { now: () => 0, request: () => 1, cancel: () => {} };

/** A focus session 25 minutes long with 17:42 left. */
function focus(state = 'running'): Props {
    return {
        State: state,
        Phase: 'focus',
        DurationUs: 1_500_000_000,
        RemainingUs: 1_062_000_000,
        TimestampUs: Date.now() * 1000,
        Clocks: [],
    };
}

/** A song 200 s long, 50 s in. */
function song(status = 'Playing'): Props {
    return {
        Available: true,
        PlayerId: 'Spotify.exe',
        PlaybackStatus: status,
        Title: 'Golden Hour Drive',
        LengthUs: 200_000_000,
        PositionUs: 50_000_000,
        PositionTimestampUs: Date.now() * 1000,
        Rate: 1,
    };
}

const mounted: MonitorNotch[] = [];

async function mount(initial: Record<string, Props> = {}) {
    const bridge = new MockBridge(initial);
    const root = document.createElement('div');
    document.body.append(root);
    const notch = new MonitorNotch(bridge, { systemUses24h: () => true, setHit: () => {}, onPointer: () => {} }, root, STILL);
    mounted.push(notch);
    await notch.start(600);
    const line = root.querySelector<HTMLElement>('.nokta-progress-line')!;
    const fill = line.querySelector<HTMLElement>('.nokta-progress-line-fill')!;
    return { bridge, notch, line, fill };
}

afterEach(() => {
    mounted.splice(0).forEach((notch) => notch.stop());
    document.body.replaceChildren();
});

describe('the progress line', () => {
    it('fills with the focus session, to its end', async () => {
        const { line, fill } = await mount({ Timer1: focus() });
        expect(line.hidden).toBe(false);
        expect(fill.style.transform).toBe('scaleX(1)');
        expect(fill.style.transition).toMatch(/^transform 106\d{4}ms linear$/);
    });

    it('stands still while the session is paused', async () => {
        const { line, fill } = await mount({ Timer1: focus('paused') });
        expect(line.hidden).toBe(false);
        expect(parseFloat(fill.style.transform.slice('scaleX('.length))).toBeCloseTo(0.292);
        expect(fill.style.transition).toBe('none');
    });

    it('follows the song beside the cover, and only while the notch is closed', async () => {
        const { notch, line, fill } = await mount({ Media1: song('Paused') });
        expect(line.hidden).toBe(false);
        expect(fill.style.transform).toBe('scaleX(0.25)');
        notch.open(true);
        expect(line.hidden).toBe(true);
    });

    it('gives way to a call', async () => {
        const call: Props = {
            Microphone: true,
            MicrophoneApp: 'Zoom',
            MicrophoneSinceUs: Date.now() * 1000,
            MicrophoneMuted: false,
        };
        const { line } = await mount({ Timer1: focus(), Media1: song(), Privacy1: call });
        expect(line.hidden).toBe(true);
    });

    it('hides with nothing to follow, or when turned off', async () => {
        const { bridge, line } = await mount();
        expect(line.hidden).toBe(true);
        bridge.set('Timer1', focus());
        expect(line.hidden).toBe(false);
        bridge.set('Settings1', { Appearance: { progress_line: false } });
        expect(line.hidden).toBe(true);
    });

    it('sits inside the corners', async () => {
        const { bridge, line } = await mount({ Timer1: focus() });
        bridge.set('Settings1', { Appearance: { corner_radius: 14 } });
        expect(line.style.left).toBe('14px');
        expect(line.style.right).toBe('14px');
    });
});
