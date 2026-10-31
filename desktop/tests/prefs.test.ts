import { afterEach, describe, expect, it, vi } from 'vitest';

import { allRows } from '@ext/features/settings/logic/schema.js';

import type { Props } from '../src/bridge/bridge.js';
import { MockBridge } from '../src/bridge/mock.js';
import { feedLabel, isFeed, windowsPages, type PrefRow } from '../src/prefs/logic.js';
import { SEND_DELAY_MS, SettingsWindow } from '../src/prefs/window.js';

const GOOGLE = 'https://calendar.google.com/calendar/ical/me%40gmail.com/private-abc/basic.ics';
const OUTLOOK = 'webcal://outlook.office365.com/owa/calendar/x/reachcalendar.ics';

const rows = (): PrefRow[] => windowsPages().flatMap((page) => page.groups.flatMap((group) => group.rows));
const find = (name: string) => rows().find((row) => `${row.table}.${row.key}` === name);

const windows: SettingsWindow[] = [];

async function mount(settings: Props = {}) {
    vi.useFakeTimers();
    const bridge = new MockBridge({ Settings1: settings });
    const pickPicture = vi.fn(() => Promise.resolve<string | null>('C:\\Users\\me\\Pictures\\beach.jpg'));
    const openConfig = vi.fn();
    const showTour = vi.fn(() => Promise.resolve());
    const root = document.createElement('div');
    document.body.append(root);
    const prefs = new SettingsWindow(bridge, { pickPicture, openConfig, showTour }, root);
    windows.push(prefs);
    await prefs.start();
    /** The row titled `title` on any page. */
    const row = (title: string) =>
        [...root.querySelectorAll<HTMLElement>('.nokta-prefs-row')].find(
            (r) => r.querySelector('.nokta-prefs-title')?.textContent === title,
        )!;
    const sets = () => bridge.calls.filter((c) => c.method === 'Set').map((c) => c.args);
    return { bridge, root, prefs, row, sets, pickPicture, openConfig, showTour };
}

afterEach(() => {
    windows.splice(0).forEach((prefs) => prefs.stop());
    document.body.replaceChildren();
    vi.useRealTimers();
});

describe('the settings on Windows', () => {
    it("keeps the extension's rows, without GNOME's", () => {
        const names = rows().map((row) => `${row.table}.${row.key}`);
        const hidden = ['behavior.move_clock', 'behavior.all_monitors', 'behavior.gestures', 'timer.quiet_notifications', 'activities.auto_progress'];
        for (const row of allRows()) {
            const name = `${row.table}.${row.key}`;
            expect(names.includes(name)).toBe(!hidden.includes(name));
        }
        expect(names.indexOf('calendar.feeds')).toBe(names.indexOf('calendar.countdown') + 1);
    });

    it('names Windows where the extension names GNOME', () => {
        const all = JSON.stringify(rows());
        expect(all).not.toMatch(/GNOME|Files or|Quick Settings/);
        const clock = find('behavior.clock_format')!.kind;
        expect(clock.type === 'choice' && clock.options[0].label).toBe('Follow Windows');
        const toggles = find('home.toggles')!.kind;
        expect(toggles.type === 'order' && toggles.options.map((o) => o.value)).toEqual(['caffeine', 'dark_style']);
        expect(find('behavior.replace_osd')!.subtitle).toBeUndefined();
    });

    it('takes https:// and webcal:// calendars, and shows only their host', () => {
        expect([GOOGLE, OUTLOOK, ' https://a.example/x.ics '].map(isFeed)).toEqual([true, true, true]);
        expect(['http://a.example/x.ics', 'https://', 'file:///C:/a.ics', 'calendar'].map(isFeed)).toEqual([false, false, false, false]);
        expect(feedLabel(GOOGLE)).toBe('calendar.google.com');
        expect(feedLabel(OUTLOOK)).toBe('outlook.office365.com');
    });
});

describe('the settings window', () => {
    it("lists Nokta's pages and shows the core's values", async () => {
        const { root, row } = await mount({ Behavior: { open_on: 'click', track_peek: false } });
        const navs = [...root.querySelectorAll('.nokta-prefs-nav span:not(.nokta-icon)')].map((n) => n.textContent);
        expect(navs).toEqual(['Appearance', 'Behavior', 'Home']);
        expect(row('Open on').querySelector('select')!.value).toBe('click');
        expect(row('Show a new song').querySelector('[role=switch]')!.getAttribute('aria-checked')).toBe('false');
        expect(row('Show the clock').querySelector('[role=switch]')!.getAttribute('aria-checked')).toBe('true');

        (root.querySelectorAll<HTMLElement>('.nokta-prefs-nav')[1]).click();
        expect(root.querySelector('.nokta-prefs-heading')!.textContent).toBe('Behavior');
        const shown = [...root.querySelectorAll<HTMLElement>('.nokta-prefs-page')].filter((p) => !p.hidden);
        expect(shown).toHaveLength(1);
    });

    it('sends a change once the user stops changing it', async () => {
        const { row, sets } = await mount();
        const range = row('Background opacity').querySelector('input')!;
        for (const value of ['50', '40', '35']) {
            range.value = value;
            range.dispatchEvent(new Event('input'));
        }
        expect(row('Background opacity').querySelector('output')!.textContent).toBe('35%');
        expect(sets()).toEqual([]);
        vi.advanceTimersByTime(SEND_DELAY_MS);
        expect(sets()).toEqual([['appearance', 'background_opacity', 0.35]]);

        row('Show a new song').querySelector<HTMLElement>('[role=switch]')!.click();
        vi.advanceTimersByTime(SEND_DELAY_MS);
        expect(sets().at(-1)).toEqual(['behavior', 'track_peek', false]);
    });

    it("keeps a size at or above the height, and shows the core's value again when it refuses one", async () => {
        const { bridge, root, row } = await mount({ Appearance: { height: 40 } });
        const width = row('Width when idle').querySelector('input')!;
        expect(width.min).toBe('40');
        width.value = '9999';
        width.dispatchEvent(new Event('change'));
        expect(width.value).toBe('2000');
        vi.advanceTimersByTime(SEND_DELAY_MS);

        vi.spyOn(bridge, 'call').mockRejectedValueOnce(new Error('the location is not a place'));
        const location = row('Location').querySelector('input')!;
        location.value = '  Atlantis ';
        location.dispatchEvent(new Event('change'));
        await vi.advanceTimersByTimeAsync(SEND_DELAY_MS);
        expect(root.querySelector('.nokta-prefs-toast')!.textContent).toBe('the location is not a place');
        expect(location.value).toBe('');
    });

    it('adds and removes calendars without showing their secret address', async () => {
        const { root, row, sets } = await mount({ Calendar: { feeds: [GOOGLE] } });
        const calendars = row('Calendars');
        expect(calendars.textContent).toContain('calendar.google.com');
        expect(root.textContent).not.toContain('private-abc');

        const input = calendars.querySelector<HTMLInputElement>('.nokta-prefs-feed-input')!;
        const add = calendars.querySelector<HTMLButtonElement>('.nokta-prefs-feed-add button')!;
        input.value = 'http://example.com/a.ics';
        input.dispatchEvent(new Event('input'));
        expect(add.disabled).toBe(true);
        input.value = OUTLOOK;
        input.dispatchEvent(new Event('input'));
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
        expect(input.value).toBe('');
        vi.advanceTimersByTime(SEND_DELAY_MS);
        expect(sets().at(-1)).toEqual(['calendar', 'feeds', [GOOGLE, OUTLOOK]]);
        expect([...calendars.querySelectorAll('.nokta-prefs-item-title')].map((t) => t.textContent)).toEqual([
            'calendar.google.com',
            'outlook.office365.com',
        ]);

        calendars.querySelector<HTMLElement>('.nokta-prefs-items .nokta-prefs-icon-button')!.click();
        vi.advanceTimersByTime(SEND_DELAY_MS);
        expect(sets().at(-1)).toEqual(['calendar', 'feeds', [OUTLOOK]]);
    });

    it('takes no calendar past the fifth', async () => {
        const five = [1, 2, 3, 4, 5].map((n) => `https://a.example/${n}.ics`);
        const { row } = await mount({ Calendar: { feeds: five } });
        expect(row('Calendars').querySelector<HTMLInputElement>('.nokta-prefs-feed-input')!.disabled).toBe(true);
    });

    it('chooses a picture in the file dialog and orders the home toggles', async () => {
        const { row, sets, pickPicture } = await mount({ Home: { toggles: ['caffeine', 'dark_style'] } });
        row('Picture').querySelector<HTMLElement>('.nokta-prefs-button')!.click();
        expect(pickPicture).toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(SEND_DELAY_MS);
        expect(sets().at(-1)).toEqual(['appearance', 'picture', 'C:\\Users\\me\\Pictures\\beach.jpg']);
        expect(row('Picture').querySelector('.nokta-prefs-file')!.textContent).toBe('beach.jpg');

        const toggles = row('Quick toggles');
        expect([...toggles.querySelectorAll('.nokta-prefs-item-title')].map((t) => t.textContent)).toEqual(['Caffeine', 'Dark Style']);
        toggles.querySelectorAll<HTMLElement>('[aria-label="Move up"]')[1]!.click();
        vi.advanceTimersByTime(SEND_DELAY_MS);
        expect(sets().at(-1)).toEqual(['home', 'toggles', ['dark_style', 'caffeine']]);
    });

    it('opens config.toml, and resets every setting only once asked', async () => {
        const { bridge, root, row, openConfig } = await mount();
        row('Open config.toml').querySelector<HTMLElement>('button')!.click();
        expect(openConfig).toHaveBeenCalled();
        row('Reset all settings').querySelector<HTMLElement>('button')!.click();
        const scrim = root.querySelector<HTMLElement>('.nokta-prefs-scrim')!;
        expect(scrim.hidden).toBe(false);
        scrim.querySelector<HTMLElement>('.nokta-prefs-button:not(.nokta-prefs-destructive)')!.click();
        expect(bridge.calls.some((c) => c.method === 'Reset')).toBe(false);
        row('Reset all settings').querySelector<HTMLElement>('button')!.click();
        scrim.querySelector<HTMLElement>('.nokta-prefs-destructive')!.click();
        expect(bridge.calls.at(-1)).toMatchObject({ iface: 'Settings1', method: 'Reset' });
        expect(scrim.hidden).toBe(true);
    });

    it('shows the tour again in the notch, and says why it did not', async () => {
        const { root, row, showTour } = await mount();
        const toasts = () => [...root.querySelectorAll('.nokta-prefs-toast')].map((t) => t.textContent);
        row('Show the tour again').querySelector<HTMLElement>('button')!.click();
        expect(showTour).toHaveBeenCalled();
        await vi.waitFor(() => expect(toasts()).toEqual(['The tour shows in the notch']));
        showTour.mockRejectedValueOnce(new Error('no notch shows'));
        row('Show the tour again').querySelector<HTMLElement>('button')!.click();
        await vi.waitFor(() => expect(toasts().at(-1)).toBe('no notch shows'));
    });
});
