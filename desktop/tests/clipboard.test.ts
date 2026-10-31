import { afterEach, describe, expect, it, vi } from 'vitest';

import { pageHeight } from '@ext/features/clipboard/logic/entries.js';

import type { Props } from '../src/bridge/bridge.js';
import { MockBridge } from '../src/bridge/mock.js';
import { Clipboard } from '../src/clipboard.js';
import { MonitorNotch } from '../src/monitor-notch.js';
import type { Frames } from '../src/notch/notch.js';
import { ClipboardPage } from '../src/views/clipboard.js';

/** Frames that never come: the springs stay put, the views still switch. */
const STILL: Frames = { now: () => 0, request: () => 1, cancel: () => {} };

const NOW_US = 1_800_000_000_000_000;
const MINUTE_US = 60_000_000;

/** Seven copies, newest first: the second pinned, the third a picture. */
const ITEMS = [
    ['7', 'text', 'https://example.com/a', '', false, NOW_US],
    ['6', 'text', 'Café au lait', '', true, NOW_US - 5 * MINUTE_US],
    ['5', 'image', '640 × 480', 'C:\\cache\\clipboard\\5.png', false, NOW_US - 2 * 60 * MINUTE_US],
    ['4', 'text', 'four', '', false, NOW_US - 3 * 24 * 60 * MINUTE_US],
    ['3', 'text', 'three', '', false, NOW_US],
    ['2', 'text', 'two', '', false, NOW_US],
    ['1', 'text', 'one', '', false, NOW_US],
];
const HOME: Props = { Home: { toggles: [], tiles: ['clipboard', 'timer'] }, Appearance: { alert_motion: false } };

const mounted: MonitorNotch[] = [];

async function mount(clipboard: Props = { Items: ITEMS, Paused: false }, settings: Props = {}) {
    vi.spyOn(Date, 'now').mockReturnValue(NOW_US / 1000);
    const bridge = new MockBridge({ Settings1: { ...HOME, ...settings }, Clipboard1: clipboard });
    const root = document.createElement('div');
    document.body.append(root);
    const takeKeyboard = vi.fn();
    const notch = new MonitorNotch(
        bridge,
        { systemUses24h: () => true, setHit: () => {}, onPointer: () => {}, takeKeyboard },
        root,
        STILL,
    );
    mounted.push(notch);
    await notch.start(600);
    notch.open(true);
    const shown = () => root.querySelector<HTMLElement>('.nokta-shown')!;
    const tile = () => shown().querySelector<HTMLElement>('[data-tile="clipboard"]');
    const page = () => root.querySelector<HTMLElement>('.nokta-clip-page')!;
    const rows = () => [...page().querySelectorAll<HTMLElement>('.nokta-clip-preview')].map((p) => p.textContent);
    const row = (text: string) =>
        [...page().querySelectorAll<HTMLElement>('.nokta-clip-row')].find(
            (r) => r.querySelector('.nokta-clip-preview')?.textContent === text,
        )!;
    const actions = () => [...root.querySelectorAll<HTMLButtonElement>('.nokta-subpage-actions .nokta-clip-button')];
    const field = () => page().querySelector<HTMLInputElement>('.nokta-clip-search-field')!;
    const calls = () => bridge.calls.filter((c) => c.iface === 'Clipboard1').map((c) => [c.method, ...c.args]);
    return { bridge, notch, root, shown, tile, page, rows, row, actions, field, calls, takeKeyboard };
}

afterEach(() => {
    mounted.splice(0).forEach((notch) => notch.stop());
    document.body.replaceChildren();
    vi.restoreAllMocks();
});

describe('Clipboard1 over the bridge', () => {
    it('reads the history and sends the changes, with Copy for the app to write', async () => {
        const bridge = new MockBridge({ Clipboard1: { Items: ITEMS, Paused: true } });
        const clipboard = new Clipboard(bridge, () => {});
        await clipboard.attach();
        expect(clipboard.entries.map((e) => e.id)).toEqual(['7', '6', '5', '4', '3', '2', '1']);
        expect(clipboard.entries[2]).toMatchObject({ kind: 'image', thumbnail: 'C:\\cache\\clipboard\\5.png' });
        expect(clipboard.paused).toBe(true);
        clipboard.copy('7');
        clipboard.pin('6', false);
        clipboard.remove('5');
        clipboard.clear();
        clipboard.setPaused(false);
        expect(bridge.calls.map((c) => [c.method, ...c.args])).toEqual([
            ['Copy', '7'],
            ['Pin', '6', false],
            ['Remove', '5'],
            ['Clear'],
            ['SetPaused', false],
        ]);
    });
});

describe('the clipboard page', () => {
    it('opens from its tile with the five newest copies and how old they are', async () => {
        const { tile, page, rows, shown } = await mount();
        tile()!.click();
        expect(shown().classList).toContain('nokta-pages');
        expect(rows()).toEqual(['https://example.com/a', 'Café au lait', 'Picture · 640 × 480', 'four', 'three']);
        const ages = [...page().querySelectorAll('.nokta-clip-age')].map((a) => a.textContent);
        expect(ages).toEqual(['now', '5 min', '2 h', '3 d', 'now']);
        expect(page().querySelector<HTMLElement>('.nokta-clip-thumbnail')!.style.backgroundImage).toContain('5.png');
    });

    it('scrolls to older copies with the wheel, and no further than the last', async () => {
        const { tile, page, rows } = await mount();
        tile()!.click();
        const list = page().querySelector<HTMLElement>('.nokta-clip-list')!;
        list.dispatchEvent(new WheelEvent('wheel', { deltaY: 100, deltaMode: 0, cancelable: true }));
        expect(rows()[0]).toBe('Café au lait');
        list.dispatchEvent(new WheelEvent('wheel', { deltaY: 30, deltaMode: 1, cancelable: true }));
        expect(rows()).toEqual(['Picture · 640 × 480', 'four', 'three', 'two', 'one']);
    });

    it('copies a row, pins or unpins it, and removes it; the header pauses and clears', async () => {
        const { tile, row, actions, calls } = await mount();
        tile()!.click();
        row('four').querySelector<HTMLElement>('.nokta-clip-entry')!.click();
        row('four').querySelector<HTMLElement>('.nokta-clip-pin')!.click();
        row('Café au lait').querySelector<HTMLElement>('.nokta-clip-pin')!.click();
        const buttons = row('four').querySelectorAll<HTMLElement>('.nokta-clip-button');
        buttons[buttons.length - 1]!.click();
        const [, pause, clear] = actions();
        pause!.click();
        clear!.click();
        expect(calls()).toEqual([
            ['Copy', '4'],
            ['Pin', '4', true],
            ['Pin', '6', false],
            ['Remove', '4'],
            ['SetPaused', true],
            ['Clear'],
        ]);
    });

    it('searches as you type, takes the keyboard, and copies the first match on Enter', async () => {
        const { tile, actions, field, rows, calls, takeKeyboard, notch } = await mount();
        tile()!.click();
        actions()[0]!.click();
        expect(takeKeyboard).toHaveBeenCalledOnce();
        expect(document.activeElement).toBe(field());
        field().value = 'CAFE';
        field().dispatchEvent(new Event('input'));
        expect(rows()).toEqual(['Café au lait']);
        field().value = 'zzz';
        field().dispatchEvent(new Event('input'));
        expect(rows()).toEqual([]);
        expect(notch.notch.element.textContent).toContain('No match');
        field().value = 'lait';
        field().dispatchEvent(new Event('input'));
        field().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        expect(calls()).toEqual([['Copy', '6']]);
        expect(field().closest('label')!.hidden).toBe(true);
    });

    it('closes the search on Escape and leaves the notch open', async () => {
        const { tile, actions, field, rows, shown } = await mount();
        tile()!.click();
        actions()[0]!.click();
        field().value = 'two';
        field().dispatchEvent(new Event('input'));
        field().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        expect(field().closest('label')!.hidden).toBe(true);
        expect(rows()).toHaveLength(5);
        expect(shown().classList).toContain('nokta-pages');
    });

    it('says when nothing was copied, or that the history is paused', async () => {
        const { tile, page, bridge } = await mount({ Items: [], Paused: false });
        tile()!.click();
        expect(page().textContent).toContain('Nothing copied yet');
        bridge.set('Clipboard1', { Paused: true });
        expect(page().textContent).toContain('Paused: copies are not kept');
    });

    it('has no tile while the history is off, and closes when it is turned off', async () => {
        const { tile, bridge, shown } = await mount();
        tile()!.click();
        bridge.set('Settings1', { Clipboard: { enabled: false } });
        expect(shown().classList).not.toContain('nokta-pages');
        expect(tile()).toBeNull();
    });

    it('is as tall as its rows, and the search field over them', () => {
        const handlers = {
            copy: () => {},
            pin: () => {},
            remove: () => {},
            clear: () => {},
            setPaused: () => {},
            searching: () => {},
            resized: vi.fn(),
        };
        const page = new ClipboardPage(handlers, (path) => path, () => NOW_US);
        expect(page.height).toBe(pageHeight(0, false));
        page.show(
            ITEMS.slice(0, 2).map(([id, kind, preview, , pinned, timeUs]) => ({
                id: id as string,
                kind: kind as 'text',
                preview: preview as string,
                thumbnail: null,
                pinned: pinned as boolean,
                timeUs: timeUs as number,
            })),
            false,
        );
        expect(page.height).toBe(pageHeight(2, false));
        page.actions[0]!.click();
        expect(page.height).toBe(pageHeight(2, true));
        expect(handlers.resized).toHaveBeenCalled();
    });
});
