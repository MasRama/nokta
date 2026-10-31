import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Props } from '../src/bridge/bridge.js';
import { MockBridge } from '../src/bridge/mock.js';
import { Lyrics, Media } from '../src/media.js';
import { MonitorNotch } from '../src/monitor-notch.js';
import type { Frames } from '../src/notch/notch.js';

/** Frames that never come: the springs stay put, the views still switch. */
const STILL: Frames = { now: () => 0, request: () => 1, cancel: () => {} };

const NOW_US = 1_767_225_600_000_000;

function media(props: Props = {}): Props {
    return {
        Available: true,
        PlayerId: 'Spotify.exe',
        PlayerName: 'Spotify',
        Players: [['Spotify.exe', 'Spotify']],
        PlaybackStatus: 'Playing',
        Title: 'Song',
        Artists: ['Band'],
        LengthUs: 200_000_000,
        PositionUs: 30_000_000,
        PositionTimestampUs: NOW_US - 2_000_000,
        Rate: 1,
        CanPlayPause: true,
        CanGoNext: true,
        CanGoPrevious: true,
        CanSeek: true,
        ...props,
    };
}

async function mount(initial: Record<string, Props>) {
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
    return { bridge, root, notch, shown };
}

afterEach(() => vi.useRealTimers());

describe('Media', () => {
    it('reads the player and moves its position on with the wall clock', async () => {
        const bridge = new MockBridge({ Media1: media() });
        const m = new Media(bridge, () => {});
        await m.attach();
        expect(m.snapshot.title).toBe('Song');
        // Two seconds since the position was read.
        expect(m.positionNow(NOW_US)).toBe(32_000_000);
        m.setPosition(12_345_678.4);
        expect(bridge.calls.at(-1)).toEqual({ iface: 'Media1', method: 'SetPosition', args: [12_345_678] });
    });

    it('follows changes', async () => {
        const bridge = new MockBridge({ Media1: media() });
        let changes = 0;
        const m = new Media(bridge, () => changes++);
        await m.attach();
        bridge.set('Media1', { PlaybackStatus: 'Paused' });
        expect(m.snapshot.playbackStatus).toBe('Paused');
        expect(m.positionNow(NOW_US)).toBe(30_000_000);
        expect(changes).toBe(2);
    });
});

describe('Lyrics', () => {
    it('keeps only well-formed lines', async () => {
        const bridge = new MockBridge({
            Lyrics1: { Status: 'synced', Lines: [[0, 'one'], ['x', 'two'], [2_000_000, 'three']], OffsetMs: 250 },
        });
        const l = new Lyrics(bridge, () => {});
        await l.attach();
        expect(l.status).toBe('synced');
        expect(l.lines).toEqual([
            [0, 'one'],
            [2_000_000, 'three'],
        ]);
        expect(l.offsetMs).toBe(250);
    });
});

describe('the player in the notch', () => {
    it('closes on the cover and opens on the player', async () => {
        const { root, notch, shown, bridge } = await mount({ Media1: media() });
        expect(shown()).toBe('nokta-collapsed');
        notch.open(true);
        expect(shown()).toBe('nokta-expanded');
        expect(root.querySelector('.nokta-title')?.textContent).toBe('Song');
        root.querySelector<HTMLButtonElement>('.nokta-play')?.click();
        expect(bridge.calls.some((c) => c.iface === 'Media1' && c.method === 'PlayPause')).toBe(true);
    });

    it('goes to home and back to the player', async () => {
        const { root, notch, shown } = await mount({ Media1: media() });
        notch.open(true);
        root.querySelector<HTMLButtonElement>('.nokta-expanded .nokta-home-button')?.click();
        expect(shown()).toBe('nokta-panel');
        root.querySelector<HTMLButtonElement>('.nokta-panel-music')?.click();
        expect(shown()).toBe('nokta-expanded');
    });

    it('shows home without a player, and idle once it goes', async () => {
        const { notch, shown, bridge } = await mount({ Media1: media() });
        bridge.set('Media1', { Available: false });
        expect(shown()).toBe('nokta-idle');
        notch.open(true);
        expect(shown()).toBe('nokta-panel');
    });

    it('peeks at a new song while closed', async () => {
        vi.useFakeTimers();
        const { shown, bridge } = await mount({ Media1: media() });
        bridge.set('Media1', { Title: 'Next song' });
        expect(shown()).toBe('nokta-peek');
        vi.advanceTimersByTime(3000);
        expect(shown()).toBe('nokta-collapsed');
    });

    it('grows for the lyric row only with synced lyrics', async () => {
        const lyrics = { Status: 'synced', Lines: [[0, 'la la']], OffsetMs: 0 };
        const { root, notch } = await mount({ Media1: media(), Lyrics1: lyrics });
        notch.open(true);
        const row = root.querySelector<HTMLElement>('.nokta-lyric-row');
        expect(row?.hidden).toBe(false);
        expect(row?.textContent).toContain('la la');
    });
});
