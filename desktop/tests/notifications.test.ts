import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Props } from '../src/bridge/bridge.js';
import { MockBridge } from '../src/bridge/mock.js';
import { MonitorNotch } from '../src/monitor-notch.js';
import type { Frames } from '../src/notch/notch.js';
import { toastFrom } from '../src/notifications.js';

/** Frames that never come: the springs stay put, the views still switch. */
const STILL: Frames = { now: () => 0, request: () => 1, cancel: () => {} };

/** Alerts without their motion, which happy-dom cannot run. */
const QUIET: Props = { Appearance: { alert_motion: false } };

const WHATSAPP = '5319275A.WhatsAppDesktop_cv1g1gvanyjgm!App';
const AVATAR = 'C:\\cache\\notifications\\toasts\\41-1.png';

/** `Posted`'s arguments. */
const posted = (
    id: string,
    { app = WHATSAPP, title = 'Rani', body = 'Sudah sampai', icon = AVATAR, round = true, buttons = ['Reply'] } = {},
): unknown[] => [id, app, 'WhatsApp', title, body, icon, round, buttons];

const mounted: MonitorNotch[] = [];

async function mount(settings: Props = {}) {
    vi.useFakeTimers();
    const bridge = new MockBridge({ Settings1: { ...QUIET, ...settings } });
    const root = document.createElement('div');
    document.body.append(root);
    let pointer: (inside: boolean) => void = () => {};
    let fullscreen: (on: boolean) => void = () => {};
    const notch = new MonitorNotch(
        bridge,
        {
            systemUses24h: () => true,
            setHit: () => {},
            onPointer: (cb) => (pointer = cb),
            onFullscreen: (cb) => (fullscreen = cb),
        },
        root,
        STILL,
    );
    mounted.push(notch);
    await notch.start(600);
    const view = () => root.querySelector<HTMLElement>('.nokta-notification')!;
    const shows = () => view().classList.contains('nokta-shown');
    const text = (part: string) => view().querySelector<HTMLElement>(`.nokta-notification-${part}`)!;
    const buttons = () =>
        [...view().querySelectorAll<HTMLButtonElement>('.nokta-notification-button')]
            .filter((b) => !b.hidden)
            .map((b) => b.textContent);
    const calls = () => bridge.calls.filter((c) => c.iface === 'Notifications1').map((c) => [c.method, ...c.args]);
    const post = (...args: unknown[]) => bridge.signal('Notifications1', 'Posted', ...args);
    return { bridge, notch, view, shows, text, buttons, calls, post, pointer: (on: boolean) => pointer(on), fullscreen: (on: boolean) => fullscreen(on) };
}

afterEach(() => {
    mounted.splice(0).forEach((notch) => notch.stop());
    document.body.replaceChildren();
    vi.useRealTimers();
});

describe('Notifications1 over the bridge', () => {
    it("reads Posted's arguments, and nothing else", () => {
        expect(toastFrom(posted('41'))).toEqual({
            id: '41',
            appId: WHATSAPP,
            app: 'WhatsApp',
            title: 'Rani',
            body: 'Sudah sampai',
            icon: AVATAR,
            round: true,
            buttons: ['Reply'],
        });
        expect(toastFrom(posted('41', { icon: '' }))?.icon).toBeNull();
        expect(toastFrom(['41', WHATSAPP, 'WhatsApp', 'Rani'])).toBeNull();
        expect(toastFrom([41, WHATSAPP, 'WhatsApp', 'Rani', '', '', true, []])).toBeNull();
    });
});

describe("another app's toast", () => {
    it('shows its picture, title, body and buttons, for as long as a notification', async () => {
        const { post, shows, text, buttons } = await mount({ Notifications: { duration_ms: 5000 } });
        post(...posted('41', { buttons: ['Reply', 'Mark as read', 'Call', 'Block'] }));
        expect(shows()).toBe(true);
        expect(text('title').textContent).toBe('Rani');
        expect(text('detail').textContent).toBe('Sudah sampai');
        const picture = text('picture');
        expect(picture.style.backgroundImage).toContain('41-1.png');
        expect(picture.classList).toContain('nokta-notification-round');
        expect(buttons()).toEqual(['Reply', 'Mark as read', 'Call']);
        vi.advanceTimersByTime(5000);
        expect(shows()).toBe(false);
    });

    it('stays under the pointer and goes a moment after it leaves', async () => {
        const { post, shows, pointer } = await mount({ Notifications: { duration_ms: 5000 } });
        post(...posted('41'));
        pointer(true);
        vi.advanceTimersByTime(10_000);
        expect(shows()).toBe(true);
        pointer(false);
        vi.advanceTimersByTime(1500);
        expect(shows()).toBe(false);
    });

    it('names the app under the title without a body or with show_body off, and keeps < and & as written', async () => {
        const { post, text } = await mount({ Notifications: { show_body: false } });
        post(...posted('41', { title: 'a < b & <c>', body: 'hidden' }));
        expect(text('title').textContent).toBe('a < b & <c>');
        expect(text('detail').textContent).toBe('WhatsApp');
    });

    it('draws a bell on the accent for an app with no picture', async () => {
        const { post, text, view } = await mount();
        post(...posted('41', { icon: '', round: false }));
        expect(text('picture').hidden).toBe(true);
        expect(view().querySelector<HTMLElement>('.nokta-notification-square .nokta-icon')!.hidden).toBe(false);
    });

    it('stacks toasts from one app, keeps the count for an update, and starts again for another app', async () => {
        const { post, view } = await mount();
        const badge = () => {
            const b = view().querySelector<HTMLElement>('.nokta-notification-badge')!;
            return b.hidden ? null : b.textContent;
        };
        post(...posted('41'));
        expect(badge()).toBeNull();
        post(...posted('42'));
        expect(badge()).toBe('2');
        post(...posted('42', { body: 'updated' }));
        expect(badge()).toBe('2');
        post(...posted('7', { app: 'Chrome' }));
        expect(badge()).toBeNull();
    });

    it('opens it from a click on it or its picture, opens a button, and closes without opening', async () => {
        const { post, shows, view, calls } = await mount();
        post(...posted('41', { buttons: ['Reply', 'Open site'] }));
        view().querySelector<HTMLElement>('.nokta-notification-main')!.click();
        expect(shows()).toBe(false);
        post(...posted('42', { buttons: ['Reply', 'Open site'] }));
        view().querySelector<HTMLElement>('.nokta-notification-square')!.click();
        post(...posted('43', { buttons: ['Reply', 'Open site'] }));
        view().querySelectorAll<HTMLElement>('.nokta-notification-button')[1]!.click();
        post(...posted('44'));
        view().querySelector<HTMLElement>('.nokta-notification-close')!.click();
        expect(shows()).toBe(false);
        expect(calls()).toEqual([
            ['Activate', '41', -1],
            ['Activate', '42', -1],
            ['Activate', '43', 1],
        ]);
    });

    it('is held back over a fullscreen app, as Windows holds back its banner', async () => {
        const { post, shows, fullscreen } = await mount();
        fullscreen(true);
        post(...posted('41'));
        expect(shows()).toBe(false);
    });

    it('takes the place of a download, and a download takes its place', async () => {
        const { post, shows, notch, bridge } = await mount();
        const drawn = () => notch.notch.element.querySelector('.nokta-shown')?.classList;
        bridge.signal('Downloads1', 'Finished', 'file:///C:/d/a.pdf', 'a.pdf', 'x-office-document', 1000, '');
        post(...posted('41'));
        expect(shows()).toBe(true);
        bridge.signal('Downloads1', 'Finished', 'file:///C:/d/a.pdf', 'a.pdf', 'x-office-document', 1000, '');
        expect(drawn()).toContain('nokta-download');
    });
});
