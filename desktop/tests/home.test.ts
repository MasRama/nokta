import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Props } from '../src/bridge/bridge.js';
import { MockBridge } from '../src/bridge/mock.js';
import { MonitorNotch } from '../src/monitor-notch.js';
import type { Frames } from '../src/notch/notch.js';
import { windowsControls } from '../src/toggles.js';
import { homeRows } from '../src/views/home.js';

/** Frames that never come: the springs stay put, the views still switch. */
const STILL: Frames = { now: () => 0, request: () => 1, cancel: () => {} };

/** A ready reading for Jakarta. */
const JAKARTA: Props = {
    Status: 'ready',
    Units: 'celsius',
    Place: 'Jakarta',
    Temperature: 31.4,
    High: 33,
    Low: 25,
    Condition: 'rain',
    IsDay: true,
};

const mounted: MonitorNotch[] = [];

async function mount(initial: Record<string, Props> = {}) {
    const bridge = new MockBridge(initial);
    const root = document.createElement('div');
    document.body.append(root);
    const openUri = vi.fn();
    const notch = new MonitorNotch(
        bridge,
        { systemUses24h: () => true, setHit: () => {}, onPointer: () => {}, openUri },
        root,
        STILL,
    );
    mounted.push(notch);
    await notch.start(600);
    notch.open(true);
    const panel = () => root.querySelector<HTMLElement>('.nokta-panel')!;
    const shown = (selector: string) =>
        [...panel().querySelectorAll<HTMLElement>(selector)].filter((e) => !e.closest('[hidden]'));
    const labels = (selector: string) => shown(selector).map((e) => e.textContent);
    return { bridge, notch, root, openUri, panel, shown, labels };
}

afterEach(() => {
    mounted.splice(0).forEach((notch) => notch.stop());
    document.body.replaceChildren();
});

describe('home on Windows', () => {
    it('shows the weather beside the date, and none without a ready reading', async () => {
        const { bridge, panel, shown } = await mount({ Weather1: JAKARTA });
        expect(panel().querySelector('.nokta-panel-weather-temperature')?.textContent).toBe('31°');
        expect(panel().querySelector('.nokta-panel-weather-detail')?.textContent).toBe('Jakarta · 33° / 25°');
        expect(panel().querySelector('.nokta-panel-weather svg')).not.toBeNull();
        bridge.set('Weather1', { Status: 'error' });
        expect(shown('.nokta-panel-weather')).toEqual([]);
    });

    it('asks for new weather when the notch opens', async () => {
        const { bridge } = await mount();
        expect(bridge.calls).toContainEqual({ iface: 'Weather1', method: 'Refresh', args: [] });
    });

    it('offers only the toggles and tiles Windows has, in the layout order', async () => {
        const { labels } = await mount({
            Settings1: {
                Home: {
                    toggles: ['dark_style', 'do_not_disturb', 'caffeine', 'night_light'],
                    tiles: ['screenshot', 'timer', 'notifications'],
                },
            },
        });
        expect(labels('.nokta-pill-label')).toEqual(['Dark Style', 'Caffeine']);
        expect(labels('.nokta-tile-label')).toEqual(['Screenshot', 'Notifications']);
    });

    it('turns a toggle the other way through the app', async () => {
        const { bridge, shown } = await mount({ Toggles1: { DarkStyle: true, Caffeine: false } });
        const caffeine = shown('.nokta-pill').find((pill) => pill.querySelector('.nokta-pill-label')?.textContent === 'Caffeine')!;
        expect(caffeine.getAttribute('aria-pressed')).toBe('false');
        caffeine.click();
        expect(bridge.calls).toContainEqual({ iface: 'Toggles1', method: 'Set', args: ['caffeine', true] });
        bridge.set('Toggles1', { Caffeine: true });
        expect(caffeine.getAttribute('aria-pressed')).toBe('true');
    });

    it("closes, then opens Windows' own panel for a tile", async () => {
        const { root, openUri, shown } = await mount({ Settings1: { Home: { toggles: [], tiles: ['screenshot'] } } });
        shown('.nokta-tile')[0].click();
        expect(openUri).toHaveBeenCalledWith('ms-screenclip:');
        expect(root.querySelector('.nokta-shown')?.classList).toContain('nokta-idle');
    });

    it("takes the light theme under Windows' light style when the notch follows it", async () => {
        const { root, bridge } = await mount({
            Settings1: { Appearance: { follow_system_style: true, light_theme: 'paper' } },
            Toggles1: { DarkStyle: false },
        });
        const notch = () => root.querySelector('.nokta-notch')!;
        expect(notch().classList).toContain('nokta-light');
        bridge.set('Toggles1', { DarkStyle: true });
        expect(notch().classList).not.toContain('nokta-light');
    });
});

describe('home controls', () => {
    it('drops the toggles and tiles Windows has not', () => {
        expect(
            windowsControls({ toggles: ['do_not_disturb', 'caffeine'], tiles: ['focus', 'notifications', 'system'] }),
        ).toEqual({ toggles: ['caffeine'], tiles: ['notifications'] });
    });

    it('counts a row for the toggles and one for the tiles, only when there are some', () => {
        expect(homeRows({ toggles: [], tiles: [] })).toEqual(['date']);
        expect(homeRows({ toggles: ['caffeine'], tiles: ['notifications'] })).toEqual(['date', 'toggles', 'tiles']);
        expect(homeRows({ toggles: [], tiles: ['screenshot'] })).toEqual(['date', 'tiles']);
    });
});
