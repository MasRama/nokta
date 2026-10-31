import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Props } from '../src/bridge/bridge.js';
import { MockBridge } from '../src/bridge/mock.js';
import { MonitorNotch } from '../src/monitor-notch.js';
import type { Frames } from '../src/notch/notch.js';
import { homeRows } from '../src/views/home.js';

/** Frames that never come: the springs stay put, the views still switch. */
const STILL: Frames = { now: () => 0, request: () => 1, cancel: () => {} };

/** Alerts without their motion, which happy-dom cannot run. */
const QUIET: Props = { Appearance: { alert_motion: false } };

/** A focus session with 17:42 left. */
function focus(state = 'running'): Props {
    return {
        State: state,
        Phase: 'focus',
        DurationUs: 1_500_000_000,
        RemainingUs: 1_062_000_000,
        TimestampUs: Date.now() * 1000,
        Sessions: 0,
        LongBreak: false,
        Clocks: [],
    };
}

/** A running tea countdown with 3:04 left and a paused stopwatch at 12:34. */
function clocks(): Props {
    const now = Date.now() * 1000;
    return {
        State: 'idle',
        Clocks: [
            ['c2', 'countdown', 'Tea', true, 300_000_000, 184_000_000, now, 0],
            ['c1', 'stopwatch', '', false, 0, 754_000_000, now, 0],
        ],
    };
}

const mounted: MonitorNotch[] = [];

async function mount(initial: Record<string, Props> = {}) {
    const bridge = new MockBridge({ Settings1: QUIET, ...initial });
    const root = document.createElement('div');
    document.body.append(root);
    const notch = new MonitorNotch(bridge, { systemUses24h: () => true, setHit: () => {}, onPointer: () => {} }, root, STILL);
    mounted.push(notch);
    await notch.start(600);
    const shown = () => root.querySelector<HTMLElement>('.nokta-shown');
    const visible = (selector: string) =>
        [...root.querySelectorAll<HTMLElement>(selector)].filter((e) => !e.closest('[hidden]'));
    const tile = (name: string) => root.querySelector<HTMLElement>(`[data-tile="${name}"]`)!;
    return { bridge, notch, root, shown, visible, tile };
}

afterEach(() => {
    mounted.splice(0).forEach((notch) => notch.stop());
    document.body.replaceChildren();
    vi.useRealTimers();
});

describe('the timer in the closed notch', () => {
    it("shows the focus session's time left in the clock's place, dimmed while paused", async () => {
        const { bridge, root } = await mount({ Timer1: focus() });
        const label = () => root.querySelector<HTMLElement>('.nokta-idle .nokta-timer-box');
        expect(label()?.textContent).toBe('17:42');
        expect(root.querySelector<HTMLElement>('.nokta-idle .nokta-clock')?.hidden).toBe(true);
        bridge.set('Timer1', { State: 'paused' });
        expect(label()?.style.opacity).toBe('0.5');
        bridge.set('Timer1', { State: 'idle' });
        expect(label()).toBeNull();
    });

    it('shows a clock while no focus session runs', async () => {
        const { root } = await mount({ Timer1: clocks() });
        expect(root.querySelector('.nokta-idle .nokta-timer')?.textContent).toBe('3:04');
    });

    it('gives the spot to a call first', async () => {
        const call: Props = {
            Microphone: true,
            MicrophoneApp: 'Zoom',
            MicrophoneSinceUs: Date.now() * 1000 - 65_000_000,
            MicrophoneMuted: false,
        };
        const { root } = await mount({ Timer1: focus(), Privacy1: call });
        expect(root.querySelector('.nokta-idle .nokta-call')).not.toBeNull();
        expect(root.querySelector('.nokta-idle .nokta-timer-box')).toBeNull();
    });

    it('counts down second by second', async () => {
        vi.useFakeTimers({ now: Date.now() });
        const { root } = await mount({ Timer1: focus() });
        vi.advanceTimersByTime(2_000);
        expect(root.querySelector('.nokta-idle .nokta-timer')?.textContent).toBe('17:40');
    });

    it('alerts when a focus session is done', async () => {
        const { bridge, shown } = await mount({ Timer1: focus() });
        bridge.signal('Timer1', 'Finished', 'focus');
        expect(shown()?.classList).toContain('nokta-osd');
        expect(shown()?.textContent).toContain('Focus done');
        expect(shown()?.textContent).toContain('5 min break');
    });
});

describe('the timer on home', () => {
    it('lists the clocks with their pause and remove buttons', async () => {
        const { bridge, notch, visible } = await mount({ Timer1: clocks() });
        notch.open(true);
        const rows = visible('.nokta-panel-clock');
        expect(rows.map((row) => row.querySelector('.nokta-panel-clock-title')?.textContent)).toEqual(['Tea', 'Stopwatch']);
        expect(rows[1].querySelector('.nokta-panel-clock-detail')?.textContent).toBe('Paused');
        const [pause, remove] = rows[0].querySelectorAll('button');
        pause.click();
        remove.click();
        expect(bridge.calls).toContainEqual({ iface: 'Timer1', method: 'PauseClock', args: ['c2'] });
        expect(bridge.calls).toContainEqual({ iface: 'Timer1', method: 'RemoveClock', args: ['c2'] });
    });

    it('starts focus from its tile, and stops it again', async () => {
        const { bridge, notch, tile } = await mount({
            Settings1: { ...QUIET, Home: { toggles: [], tiles: ['focus', 'timer'] } },
        });
        notch.open(true);
        tile('focus').click();
        expect(bridge.calls).toContainEqual({ iface: 'Timer1', method: 'Start', args: ['focus'] });
        bridge.set('Timer1', focus());
        expect(tile('focus').getAttribute('aria-pressed')).toBe('true');
        tile('focus').click();
        expect(bridge.calls).toContainEqual({ iface: 'Timer1', method: 'Stop', args: [] });
    });

    it("opens the timer page, whose preset starts a countdown and goes back home", async () => {
        const { bridge, notch, shown, tile } = await mount({
            Settings1: { ...QUIET, Home: { toggles: [], tiles: ['timer'] } },
        });
        notch.open(true);
        tile('timer').click();
        expect(shown()?.classList).toContain('nokta-pages');
        const preset = [...shown()!.querySelectorAll<HTMLElement>('.nokta-timer-preset')].find(
            (button) => button.textContent === '5 min',
        )!;
        preset.click();
        expect(bridge.calls).toContainEqual({ iface: 'Timer1', method: 'AddCountdown', args: ['', 300_000_000] });
        expect(shown()?.classList).toContain('nokta-panel');
    });

    it('counts a row for each clock, at most three', () => {
        const layout = { toggles: [], tiles: ['timer' as const] };
        expect(homeRows(layout, { clocks: 2 })).toEqual(['date', 'clock', 'clock', 'tiles']);
        expect(homeRows(layout, { clocks: 5 }).filter((row) => row === 'clock')).toHaveLength(3);
    });
});
