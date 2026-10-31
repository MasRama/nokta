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

/** A build 40 % done, 92 s in, and a sync of unknown progress, 12 s in. */
function running(): Props {
    const now = Date.now() * 1000;
    return {
        Activities: [
            ['build', 'Build', 'cargo build', '', 0.4, now - 92_000_000],
            ['sync', 'Sync', 'Photos', 'emblem-synchronizing-symbolic', -1, now - 12_000_000],
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
    const shown = () => root.querySelector<HTMLElement>('.nokta-shown');
    const rows = () => [...root.querySelectorAll<HTMLElement>('.nokta-panel-activity')].filter((row) => !row.hidden);
    return { bridge, notch, root, shown, rows, openUri };
}

afterEach(() => {
    mounted.splice(0).forEach((notch) => notch.stop());
    document.body.replaceChildren();
});

describe('live activities in the closed notch', () => {
    it("shows the newest one's progress in the clock's place", async () => {
        const { root } = await mount({ Activities1: running() });
        const badge = root.querySelector<HTMLElement>('.nokta-idle .nokta-activity-badge');
        expect(badge?.textContent?.trim()).toBe('40%');
        expect(root.querySelector<HTMLElement>('.nokta-idle .nokta-clock')?.hidden).toBe(true);
    });

    it('pulses its icon while the progress is unknown', async () => {
        const { bridge, root } = await mount({ Activities1: running() });
        bridge.set('Activities1', { Activities: [['sync', 'Sync', '', '', -1, Date.now() * 1000]] });
        const badge = root.querySelector<HTMLElement>('.nokta-idle .nokta-activity-badge')!;
        expect(badge.querySelector('.nokta-activity-badge-label')?.hasAttribute('hidden')).toBe(true);
        expect(badge.querySelector('.nokta-pulse')).not.toBeNull();
    });

    it('fills the progress line with it', async () => {
        const { root } = await mount({ Activities1: running() });
        const fill = root.querySelector<HTMLElement>('.nokta-progress-line-fill')!;
        expect(fill.style.transform).toBe('scaleX(0.4)');
    });

    it('gives the spot to the focus timer, and goes with the setting off', async () => {
        const focus: Props = { State: 'running', Phase: 'focus', DurationUs: 60_000_000, RemainingUs: 30_000_000, TimestampUs: Date.now() * 1000 };
        const { bridge, root } = await mount({ Activities1: running(), Timer1: focus });
        expect(root.querySelector('.nokta-idle .nokta-activity-badge')).toBeNull();
        bridge.set('Timer1', { State: 'idle' });
        expect(root.querySelector('.nokta-idle .nokta-activity-badge')).not.toBeNull();
        bridge.set('Settings1', { Behavior: { live_activities: false } });
        expect(root.querySelector('.nokta-idle .nokta-activity-badge')).toBeNull();
    });

    it('alerts when one ends, in red when it failed', async () => {
        const { bridge, shown } = await mount();
        bridge.signal('Activities1', 'Ended', 'build', 'Build', true, '', 65_000_000);
        expect(shown()?.textContent).toContain('Build');
        expect(shown()?.textContent).toContain('Done in 1 min 5 s');
        bridge.signal('Activities1', 'Ended', 'build', 'Build', false, 'Tests failed', 5_000_000);
        expect(shown()?.textContent).toContain('Tests failed');
        expect(shown()?.classList).toContain('nokta-osd-urgent');
    });
});

describe('live activities and updates on home', () => {
    it('lists each activity with its time and progress', async () => {
        const { notch, rows } = await mount({ Activities1: running() });
        notch.open(true);
        const [build, sync] = rows();
        expect(build.querySelector('.nokta-panel-activity-title')?.textContent).toBe('Build');
        expect(build.querySelector('.nokta-panel-activity-elapsed')?.textContent).toBe('1 min 32 s');
        expect(build.querySelector<HTMLElement>('.nokta-panel-activity-fill')?.style.transform).toBe('scaleX(0.4)');
        expect(sync.querySelector<HTMLElement>('.nokta-panel-activity-track')?.style.visibility).toBe('hidden');
    });

    it('offers a newer Nokta, whose row opens its release page', async () => {
        const url = 'https://github.com/MasRama/nokta/releases/tag/v0.12.0';
        const { notch, root, openUri } = await mount({ Updates1: { Latest: '0.12.0', ReleaseUrl: url } });
        notch.open(true);
        const row = root.querySelector<HTMLElement>('.nokta-panel-update')!;
        expect(row.hidden).toBe(false);
        expect(row.textContent?.trim()).toBe('Nokta 0.12.0 is available');
        row.click();
        expect(openUri).toHaveBeenCalledWith(url);
    });

    it('has no update row while this one is the newest', async () => {
        const { notch, root } = await mount({ Updates1: { Latest: '', ReleaseUrl: '' } });
        notch.open(true);
        expect(root.querySelector<HTMLElement>('.nokta-panel-update')?.hidden).toBe(true);
    });

    it('counts the activities after the call and the update after the clocks', () => {
        const layout = { toggles: [], tiles: [] };
        expect(homeRows(layout, { call: true, activities: 4, clocks: 1, update: true })).toEqual([
            'date',
            'call',
            'activity',
            'activity',
            'activity',
            'clock',
            'update',
        ]);
    });
});
