import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Props } from '../src/bridge/bridge.js';
import { MockBridge } from '../src/bridge/mock.js';
import { MonitorNotch } from '../src/monitor-notch.js';
import type { Frames } from '../src/notch/notch.js';

/** Frames that never come: the springs stay put, the views still switch. */
const STILL: Frames = { now: () => 0, request: () => 1, cancel: () => {} };

/** Alerts without their motion, which happy-dom cannot run. */
const QUIET: Props = { Appearance: { alert_motion: false } };

const REPORT = ['file:///C:/Users/ren/Downloads/report.pdf', 'report.pdf', 'x-office-document', 2_400_000, ''];
const PHOTO = ['file:///C:/Users/ren/Downloads/photo.png', 'photo.png', 'image-x-generic', 830_000, 'C:\\cache\\downloads\\photo.png'];

const mounted: MonitorNotch[] = [];

async function mount(settings: Props = {}) {
    vi.useFakeTimers();
    const bridge = new MockBridge({ Settings1: { ...QUIET, ...settings } });
    const root = document.createElement('div');
    document.body.append(root);
    const openFile = vi.fn();
    let pointer: (inside: boolean) => void = () => {};
    let fullscreen: (on: boolean) => void = () => {};
    const notch = new MonitorNotch(
        bridge,
        {
            systemUses24h: () => true,
            setHit: () => {},
            onPointer: (cb) => (pointer = cb),
            onFullscreen: (cb) => (fullscreen = cb),
            openFile,
        },
        root,
        STILL,
    );
    mounted.push(notch);
    await notch.start(600);
    const shown = () => root.querySelector<HTMLElement>('.nokta-shown');
    const button = (label: string) =>
        [...root.querySelectorAll<HTMLElement>('.nokta-file-preview-button')].find((b) => b.textContent === label);
    return { bridge, root, shown, button, openFile, pointer: (inside: boolean) => pointer(inside), fullscreen: (on: boolean) => fullscreen(on) };
}

afterEach(() => {
    mounted.splice(0).forEach((notch) => notch.stop());
    document.body.replaceChildren();
    vi.useRealTimers();
});

describe('a finished download', () => {
    it('shows its name, size and kind with Open, Show in Explorer and Keep on shelf', async () => {
        const { bridge, shown, button } = await mount();
        bridge.signal('Downloads1', 'Finished', ...REPORT);
        expect(shown()?.classList).toContain('nokta-download');
        expect(shown()?.querySelector('.nokta-file-preview-title')?.textContent).toBe('report.pdf');
        expect(shown()?.querySelector('.nokta-file-preview-detail')?.textContent).toBe('2.4 MB');
        expect(shown()?.querySelector<HTMLElement>('.nokta-file-preview-thumb [data-icon]')?.dataset.icon).toBe('x-office-document');
        expect(button('Open')?.hidden).toBe(false);
        expect(button('Show in Explorer')?.hidden).toBe(false);
        expect(button('Keep on shelf')?.hidden).toBe(false);
    });

    it("shows a picture's thumbnail", async () => {
        const { bridge, shown } = await mount();
        bridge.signal('Downloads1', 'Finished', ...PHOTO);
        const thumb = shown()!.querySelector<HTMLElement>('.nokta-file-preview-thumb')!;
        expect(thumb.style.backgroundImage).toContain('photo.png');
        expect(thumb.querySelector<HTMLElement>('.nokta-icon')?.hidden).toBe(true);
    });

    it('opens it, from its button or its picture, or shows it in Explorer', async () => {
        const { bridge, shown, button, openFile } = await mount();
        bridge.signal('Downloads1', 'Finished', ...REPORT);
        button('Show in Explorer')!.click();
        expect(openFile).toHaveBeenLastCalledWith(REPORT[0], true);
        expect(shown()?.classList).not.toContain('nokta-download');
        bridge.signal('Downloads1', 'Finished', ...REPORT);
        shown()!.querySelector<HTMLElement>('.nokta-file-preview-thumb')!.click();
        expect(openFile).toHaveBeenLastCalledWith(REPORT[0], false);
    });

    it('goes after the notification time, but not while the pointer is on it', async () => {
        const { bridge, shown, pointer } = await mount({ Notifications: { duration_ms: 5000 } });
        bridge.signal('Downloads1', 'Finished', ...REPORT);
        pointer(true);
        vi.advanceTimersByTime(10_000);
        expect(shown()?.classList).toContain('nokta-download');
        pointer(false);
        vi.advanceTimersByTime(2000);
        expect(shown()?.classList).not.toContain('nokta-download');
    });

    it('stays away from a fullscreen app unless every alert may show there', async () => {
        const { bridge, shown, fullscreen } = await mount({ Behavior: { fullscreen_alerts: 'important' } });
        fullscreen(true);
        bridge.signal('Downloads1', 'Finished', ...REPORT);
        expect(shown()?.classList).not.toContain('nokta-download');
    });
});

describe('a new screenshot', () => {
    const SHOT = [
        'file:///C:/Users/ren/Pictures/Screenshots/Screenshot%201.png',
        'Screenshot 1.png',
        'image-x-generic',
        412_000,
        'C:\\cache\\screenshots\\1.png',
    ];

    it('shows as a screenshot with its file under it, its picture and the same buttons', async () => {
        const { bridge, shown, button, openFile } = await mount();
        bridge.signal('Screenshots1', 'Taken', ...SHOT);
        expect(shown()?.classList).toContain('nokta-download');
        expect(shown()?.querySelector('.nokta-file-preview-title')?.textContent).toBe('Screenshot');
        expect(shown()?.querySelector('.nokta-file-preview-detail')?.textContent).toBe('Screenshot 1.png');
        expect(shown()!.querySelector<HTMLElement>('.nokta-file-preview-thumb')!.style.backgroundImage).toContain('1.png');
        expect(button('Keep on shelf')?.hidden).toBe(false);
        button('Open')!.click();
        expect(openFile).toHaveBeenLastCalledWith(SHOT[0], false);
    });
});
