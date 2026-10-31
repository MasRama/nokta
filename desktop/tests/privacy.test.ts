import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Props } from '../src/bridge/bridge.js';
import { MockBridge } from '../src/bridge/mock.js';
import { MonitorNotch } from '../src/monitor-notch.js';
import type { Frames } from '../src/notch/notch.js';
import { homeRows } from '../src/views/home.js';

/** Frames that never come: the springs stay put, the views still switch. */
const STILL: Frames = { now: () => 0, request: () => 1, cancel: () => {} };

/** Zoom has had the microphone for 65 s, with the camera on. */
function onCall(muted = false): Props {
    return {
        Camera: true,
        CameraApp: 'Zoom',
        Microphone: true,
        MicrophoneApp: 'Zoom',
        MicrophoneSinceUs: Date.now() * 1000 - 65_000_000,
        MicrophoneMuted: muted,
    };
}

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
    const dots = () => root.querySelector<HTMLElement>('.nokta-privacy-dots');
    const call = (view: string) => root.querySelector<HTMLElement>(`.nokta-${view} .nokta-call`);
    const clock = () => root.querySelector<HTMLElement>('.nokta-clock');
    return { bridge, notch, root, dots, call, clock };
}

afterEach(() => vi.useRealTimers());

describe('privacy dots', () => {
    it('shows a green dot for the camera and an orange one for the microphone', async () => {
        const { dots } = await mount({ Privacy1: onCall() });
        expect(dots()?.hidden).toBe(false);
        const colors = [...(dots()?.children ?? [])].map((d) => (d as HTMLElement).style.background);
        expect(colors).toEqual(['#33d17a', '#ff9500']);
    });

    it('shows none when nothing is in use or the setting is off', async () => {
        expect((await mount()).dots()?.hidden).toBe(true);
        const off = await mount({
            Privacy1: onCall(),
            Settings1: { Behavior: { privacy_dots: false } },
        });
        expect(off.dots()?.hidden).toBe(true);
    });

    it('makes room for the dots beside the cover', async () => {
        const { root } = await mount({
            Privacy1: onCall(),
            Media1: { Available: true, PlaybackStatus: 'Playing', Title: 'Song' },
        });
        expect(root.querySelector<HTMLElement>('.nokta-collapsed')?.style.paddingLeft).not.toBe('');
    });
});

describe('the call', () => {
    it('takes the clock’s place with how long the microphone has been on', async () => {
        const { call, clock } = await mount({ Privacy1: onCall() });
        expect(call('idle')?.querySelector('.nokta-call-time')?.textContent).toBe('1:05');
        expect(clock()?.hidden).toBe(true);
        expect(call('idle')?.querySelector<HTMLElement>('.nokta-icon')?.dataset.icon).toBe('mic');
    });

    it('turns its microphone red while muted, and counts on', async () => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
        const { bridge, call } = await mount({ Privacy1: onCall() });
        bridge.set('Privacy1', { MicrophoneMuted: true });
        expect(call('idle')?.querySelector<HTMLElement>('.nokta-icon')?.dataset.icon).toBe('mic-off');
        vi.advanceTimersByTime(1000);
        expect(call('idle')?.querySelector('.nokta-call-time')?.textContent).toBe('1:06');
    });

    it('takes the equalizer’s place while a player is there', async () => {
        const { root, call } = await mount({
            Privacy1: onCall(),
            Media1: { Available: true, PlaybackStatus: 'Playing', Title: 'Song' },
        });
        expect(call('collapsed')).not.toBeNull();
        expect(root.querySelector<HTMLElement>('.nokta-collapsed .nokta-equalizer')?.hidden).toBe(true);
    });

    it('goes when the microphone goes off, or with the setting off', async () => {
        const { bridge, call, clock } = await mount({ Privacy1: onCall() });
        bridge.set('Privacy1', { Microphone: false });
        expect(call('idle')).toBeNull();
        expect(clock()?.hidden).toBe(false);
        const off = await mount({ Privacy1: onCall(), Settings1: { Behavior: { call_indicator: false } } });
        expect(off.call('idle')).toBeNull();
    });

    it('stays hidden until the microphone comes on again', async () => {
        const { bridge, notch, call } = await mount({ Privacy1: onCall() });
        notch.privacy.hideCall();
        bridge.set('Privacy1', { MicrophoneMuted: true });
        expect(call('idle')).toBeNull();
        bridge.set('Privacy1', { Microphone: false });
        bridge.set('Privacy1', { Microphone: true });
        expect(call('idle')).not.toBeNull();
    });

    it('mutes the microphone through the core', async () => {
        const { bridge, notch } = await mount({ Privacy1: onCall() });
        notch.privacy.toggleMute();
        expect(bridge.calls).toContainEqual({ iface: 'Privacy1', method: 'ToggleMute', args: [] });
    });
});

describe('the call on home', () => {
    const row = (root: HTMLElement) => root.querySelector<HTMLElement>('.nokta-panel-call')!;

    it('names the app with how long the microphone has been on', async () => {
        const { notch, root } = await mount({ Privacy1: onCall() });
        notch.open(true);
        expect(row(root).hidden).toBe(false);
        expect(row(root).querySelector('.nokta-panel-call-title')?.textContent).toBe('Zoom');
        expect(row(root).querySelector('.nokta-panel-call-detail')?.textContent).toBe('Microphone · 1:05');
    });

    it('mutes through the core, and says so while muted', async () => {
        const { bridge, notch, root } = await mount({ Privacy1: onCall() });
        notch.open(true);
        const [mute] = row(root).querySelectorAll('button');
        mute.click();
        expect(bridge.calls).toContainEqual({ iface: 'Privacy1', method: 'ToggleMute', args: [] });
        bridge.set('Privacy1', { MicrophoneMuted: true });
        expect(mute.getAttribute('aria-pressed')).toBe('true');
        expect(row(root).querySelector('.nokta-panel-call-detail')?.textContent).toBe('Muted · 1:05');
    });

    it('hides the call from home and the closed notch until the microphone comes on again', async () => {
        const { notch, root, call } = await mount({ Privacy1: onCall() });
        notch.open(true);
        const [, hide] = row(root).querySelectorAll('button');
        hide.click();
        expect(row(root).hidden).toBe(true);
        expect(call('idle')).toBeNull();
    });

    it('is not there without a call, or with the call indicator off', async () => {
        const { bridge, notch, root } = await mount();
        notch.open(true);
        expect(row(root).hidden).toBe(true);
        bridge.set('Privacy1', onCall());
        expect(row(root).hidden).toBe(false);
        bridge.set('Settings1', { Behavior: { call_indicator: false } });
        expect(row(root).hidden).toBe(true);
    });

    it('counts a row for the call above the clocks', () => {
        const layout = { toggles: [], tiles: [] };
        expect(homeRows(layout, { call: true, clocks: 1 })).toEqual(['date', 'call', 'clock']);
    });
});
