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

const info = (name: string) => JSON.stringify({ name, icon: 'nokta-link', every: 60, runs_here: true, options: [] });

/** Pull requests with a badge, items and a link; a deploy with progress and a button that runs it. */
function cards(): Props {
    return {
        Plugins: [
            ['pulls', true, 'ok', '', info('Pull requests')],
            ['deploy', true, 'ok', '', info('Deploy')],
        ],
        Cards: [
            [
                'pulls',
                JSON.stringify({
                    title: '3 open',
                    detail: 'nokta',
                    tone: 'blue',
                    badge: '3',
                    items: [
                        { title: 'Fix the shelf', detail: '#142', open: 'https://example.com/142' },
                        { title: 'No link' },
                    ],
                    actions: [{ label: 'Open', open: 'https://example.com/pulls' }],
                }),
            ],
            [
                'deploy',
                JSON.stringify({ title: 'Deploying', progress: 0.6, icon: 'some-gnome-icon', actions: [{ label: 'Stop', run: 'stop' }] }),
            ],
        ],
    };
}

const mounted: MonitorNotch[] = [];

async function mount(initial: Record<string, Props> = {}) {
    const bridge = new MockBridge({ Settings1: QUIET, ...initial });
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
    const rows = () => [...root.querySelectorAll<HTMLElement>('.nokta-panel-plugin')].filter((row) => !row.hidden);
    const shown = () => root.querySelector<HTMLElement>('.nokta-shown');
    return { bridge, notch, root, rows, shown, openUri };
}

afterEach(() => {
    mounted.splice(0).forEach((notch) => notch.stop());
    document.body.replaceChildren();
});

describe('plugins in the closed notch', () => {
    it("shows the first card's badge in the clock's place", async () => {
        const { root } = await mount({ Plugins1: cards() });
        const badge = root.querySelector<HTMLElement>('.nokta-idle .nokta-plugin-badge');
        expect(badge?.textContent?.trim()).toBe('3');
    });

    it('leaves the spot to a live activity', async () => {
        const activity: Props = { Activities: [['b', 'Build', '', '', 0.4, Date.now() * 1000]] };
        const { root } = await mount({ Plugins1: cards(), Activities1: activity });
        expect(root.querySelector('.nokta-idle .nokta-plugin-badge')).toBeNull();
    });
});

describe('plugins on home', () => {
    it('lists each card with a title after the update row', async () => {
        const { notch, rows } = await mount({ Plugins1: cards() });
        notch.open(true);
        const [pulls, deploy] = rows();
        expect(pulls.querySelector('.nokta-panel-activity-title')?.textContent).toBe('3 open');
        expect(pulls.querySelector<HTMLElement>('.nokta-panel-activity-track')?.hidden).toBe(true);
        expect(deploy.querySelector<HTMLElement>('.nokta-panel-activity-fill')?.style.transform).toBe('scaleX(0.6)');
        // An icon only GNOME has is Nokta's plugin icon here.
        expect(deploy.querySelector<HTMLElement>('.nokta-icon-chip .nokta-icon')?.dataset.icon).toBe('plugin');
        expect(homeRows({ toggles: [], tiles: [] }, { update: true, plugins: 5, shelf: true })).toEqual([
            'date',
            'update',
            'plugin',
            'plugin',
            'plugin',
            'shelf',
        ]);
    });

    it('opens a link button in the browser and runs a plugin for the others', async () => {
        const { bridge, notch, rows, openUri } = await mount({ Plugins1: cards() });
        notch.open(true);
        const [pulls, deploy] = rows();
        pulls.querySelector<HTMLButtonElement>('.nokta-panel-join:not([hidden])')!.click();
        expect(openUri).toHaveBeenCalledWith('https://example.com/pulls');
        deploy.querySelector<HTMLButtonElement>('.nokta-panel-join:not([hidden])')!.click();
        expect(bridge.calls).toContainEqual({ iface: 'Plugins1', method: 'Run', args: ['deploy', 'stop'] });
    });

    it("opens a card's items as a page named after the plugin", async () => {
        const { notch, root, rows, openUri } = await mount({ Plugins1: cards() });
        notch.open(true);
        const [pulls, deploy] = rows();
        expect(deploy.querySelector<HTMLButtonElement>('.nokta-panel-plugin-body')?.disabled).toBe(true);
        pulls.querySelector<HTMLButtonElement>('.nokta-panel-plugin-body')!.click();
        const page = root.querySelector<HTMLElement>('.nokta-plugin-page')!;
        expect(page.closest<HTMLElement>('.nokta-subpage')?.hidden).toBe(false);
        expect(page.closest('.nokta-subpage')?.querySelector('.nokta-subpage-title')?.textContent).toBe('Pull requests');
        const items = [...page.querySelectorAll<HTMLButtonElement>('.nokta-plugin-item')].filter((item) => !item.hidden);
        expect(items.map((item) => item.querySelector('.nokta-plugin-item-title')?.textContent)).toEqual([
            'Fix the shelf',
            'No link',
        ]);
        expect(items[1].disabled).toBe(true);
        items[0].click();
        expect(openUri).toHaveBeenCalledWith('https://example.com/142');
    });

    it('goes back home when the open card loses its items', async () => {
        const { bridge, notch, root, rows } = await mount({ Plugins1: cards() });
        notch.open(true);
        rows()[0].querySelector<HTMLButtonElement>('.nokta-panel-plugin-body')!.click();
        const page = () => root.querySelector<HTMLElement>('.nokta-plugin-page')!.closest<HTMLElement>('.nokta-subpage')!;
        expect(page().hidden).toBe(false);
        bridge.set('Plugins1', { Cards: [['pulls', JSON.stringify({ title: '0 open' })]] });
        expect(page().hidden).toBe(true);
    });
});

describe('plugin alerts', () => {
    it("shows one in the plugin's tone, an important one in red", async () => {
        const { bridge, shown } = await mount({ Plugins1: cards() });
        bridge.signal('Plugins1', 'Alert', 'pulls', 'Merged', '#142', '', 'green', false);
        expect(shown()?.textContent).toContain('Merged');
        expect(shown()?.textContent).toContain('#142');
        bridge.signal('Plugins1', 'Alert', 'pulls', 'Site is down', '', '', '', true);
        expect(shown()?.textContent).toContain('Site is down');
    });
});
