import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Props } from '../src/bridge/bridge.js';
import { MockBridge } from '../src/bridge/mock.js';
import { MonitorNotch } from '../src/monitor-notch.js';
import type { Frames } from '../src/notch/notch.js';
import { Shelf } from '../src/shelf.js';

/** Frames that never come: the springs stay put, the views still switch. */
const STILL: Frames = { now: () => 0, request: () => 1, cancel: () => {} };

/** Alerts without their motion, which happy-dom cannot run. */
const QUIET: Props = { Appearance: { alert_motion: false } };

const NOTES = 'file:///C:/Users/ren/notes.txt';
const PHOTO = 'file:///C:/Users/ren/photo.png';
const SHELF: Props = {
    Items: [
        [NOTES, 'notes.txt', 'text-x-generic'],
        [PHOTO, 'photo.png', 'image-x-generic'],
    ],
    Thumbnails: { [PHOTO]: 'C:\\cache\\thumbnails\\photo.png' },
};
const REPORT = ['file:///C:/Users/ren/Downloads/report.pdf', 'report.pdf', 'x-office-document', 2_400_000, ''];

const mounted: MonitorNotch[] = [];

async function mount(shelf: Props = SHELF, settings: Props = {}) {
    const bridge = new MockBridge({ Settings1: { ...QUIET, ...settings }, Shelf1: shelf });
    const root = document.createElement('div');
    document.body.append(root);
    const openFile = vi.fn();
    const dragFiles = vi.fn(() => Promise.resolve());
    let drop: (dropping: boolean) => void = () => {};
    const notch = new MonitorNotch(
        bridge,
        {
            systemUses24h: () => true,
            setHit: () => {},
            onPointer: () => {},
            openFile,
            dragFiles,
            onDrop: (cb) => (drop = cb),
        },
        root,
        STILL,
    );
    mounted.push(notch);
    await notch.start(600);
    const shown = () => root.querySelector<HTMLElement>('.nokta-shown');
    /** The slots of the row that shows: their titles, left to right. */
    const slots = () =>
        [...(shown()?.querySelectorAll<HTMLElement>('.nokta-shelf-open') ?? [])].map((slot) => slot.title);
    const slot = (title: string) =>
        [...shown()!.querySelectorAll<HTMLElement>('.nokta-shelf-slot')].find(
            (s) => s.querySelector<HTMLElement>('.nokta-shelf-open')!.title === title,
        )!;
    const calls = () => bridge.calls.filter((c) => c.iface === 'Shelf1').map((c) => [c.method, ...c.args]);
    return { bridge, notch, root, shown, slots, slot, calls, openFile, dragFiles, drop: (on: boolean) => drop(on) };
}

afterEach(() => {
    mounted.splice(0).forEach((notch) => notch.stop());
    document.body.replaceChildren();
});

describe('Shelf1 over the bridge', () => {
    it('reads the items with their thumbnails and sends the changes', async () => {
        const bridge = new MockBridge({ Shelf1: SHELF });
        const shelf = new Shelf(bridge, () => {});
        await shelf.attach();
        expect(shelf.items.map((item) => [item.name, item.thumbnail])).toEqual([
            ['notes.txt', null],
            ['photo.png', 'C:\\cache\\thumbnails\\photo.png'],
        ]);
        shelf.add([NOTES]);
        shelf.remove(NOTES);
        shelf.clear();
        expect(bridge.calls.map((c) => [c.method, ...c.args])).toEqual([['Add', [NOTES]], ['Remove', NOTES], ['Clear']]);
    });
});

describe('the shelf', () => {
    it('shows in home: the stack, then the newest files', async () => {
        const { notch, slots, shown } = await mount();
        notch.open(true);
        expect(shown()?.classList).toContain('nokta-panel');
        expect(slots()).toEqual(['File shelf', 'photo.png', 'notes.txt']);
        expect(shown()!.querySelector('.nokta-shelf-count')?.textContent).toBe('2');
        const thumbnail = shown()!.querySelector<HTMLElement>('.nokta-shelf-thumbnail')!;
        expect(thumbnail.style.backgroundImage).toContain('photo.png');
    });

    it('opens a file, takes it off, or clears the shelf from the stack', async () => {
        const { notch, slot, calls, openFile } = await mount();
        notch.open(true);
        slot('notes.txt').querySelector<HTMLElement>('.nokta-shelf-open')!.click();
        expect(openFile).toHaveBeenCalledWith(NOTES, false);
        slot('notes.txt').querySelector<HTMLElement>('.nokta-shelf-close')!.click();
        slot('File shelf').querySelector<HTMLElement>('.nokta-shelf-open')!.click();
        slot('File shelf').querySelector<HTMLElement>('.nokta-shelf-close')!.click();
        expect(openFile).toHaveBeenCalledTimes(1);
        expect(calls()).toEqual([['Remove', NOTES], ['Clear']]);
    });

    it('drags a file out, or every file from the stack, and opens nothing then', async () => {
        const { notch, slot, dragFiles, openFile } = await mount();
        notch.open(true);
        const drag = (title: string) => {
            const open = slot(title).querySelector<HTMLElement>('.nokta-shelf-open')!;
            const before = dragFiles.mock.calls.length;
            open.dispatchEvent(new PointerEvent('pointerdown', { button: 0, buttons: 1, clientX: 10, clientY: 10, bubbles: true }));
            open.dispatchEvent(new PointerEvent('pointermove', { buttons: 1, clientX: 12, clientY: 11, bubbles: true }));
            expect(dragFiles).toHaveBeenCalledTimes(before);
            open.dispatchEvent(new PointerEvent('pointermove', { buttons: 1, clientX: 30, clientY: 40, bubbles: true }));
            open.click();
        };
        drag('photo.png');
        expect(dragFiles).toHaveBeenLastCalledWith([PHOTO]);
        drag('File shelf');
        expect(dragFiles).toHaveBeenLastCalledWith([NOTES, PHOTO]);
        expect(openFile).not.toHaveBeenCalled();
    });

    it('shows under the open player, and its count in the closed notch', async () => {
        const { notch, root, slots } = await mount({ ...SHELF });
        const badge = () => root.querySelector<HTMLElement>('.nokta-shown .nokta-shelf-badge');
        expect(badge()?.textContent).toBe('2');
        notch.open(true);
        expect(slots()).toHaveLength(3);
    });

    it('goes away with the last file', async () => {
        const { bridge, notch, shown } = await mount();
        notch.open(true);
        bridge.set('Shelf1', { Items: [] });
        expect(shown()!.querySelector<HTMLElement>('.nokta-shelf-row')?.hidden).toBe(true);
    });

    it('opens the drop area while files are dragged over the notch', async () => {
        const { shown, drop } = await mount();
        drop(true);
        expect(shown()?.classList).toContain('nokta-drop');
        expect(shown()?.textContent).toContain('Drop to keep here');
        drop(false);
        expect(shown()?.classList).not.toContain('nokta-drop');
    });

    it('keeps a finished download', async () => {
        const { bridge, shown, calls } = await mount({}, { Notifications: { duration_ms: 60_000 } });
        bridge.signal('Downloads1', 'Finished', ...REPORT);
        const keep = [...shown()!.querySelectorAll<HTMLElement>('.nokta-file-preview-button')].find(
            (b) => b.textContent === 'Keep on shelf',
        )!;
        expect(keep.hidden).toBe(false);
        keep.click();
        expect(calls()).toEqual([['Add', [REPORT[0]]]]);
        expect(shown()?.classList).not.toContain('nokta-download');
    });

    it('is all gone while file_shelf is off', async () => {
        const { bridge, notch, root, shown, drop } = await mount(SHELF, {
            Behavior: { file_shelf: false },
            Notifications: { duration_ms: 60_000 },
        });
        expect(root.querySelector('.nokta-shown .nokta-shelf-badge')).toBeNull();
        notch.open(true);
        expect(shown()!.querySelector<HTMLElement>('.nokta-shelf-row')?.hidden).toBe(true);
        notch.close();
        drop(true);
        expect(shown()?.classList).not.toContain('nokta-drop');
        bridge.signal('Downloads1', 'Finished', ...REPORT);
        const keep = [...shown()!.querySelectorAll<HTMLElement>('.nokta-file-preview-button')].find(
            (b) => b.textContent === 'Keep on shelf',
        )!;
        expect(keep.hidden).toBe(true);
    });
});
