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

async function mount(settings: Props = {}, answers: Record<string, unknown> = {}) {
    vi.useFakeTimers();
    const bridge = new MockBridge({ Settings1: settings }, answers);
    const pickPicture = vi.fn(() => Promise.resolve<string | null>('C:\\Users\\me\\Pictures\\beach.jpg'));
    const openConfig = vi.fn();
    const showTour = vi.fn(() => Promise.resolve());
    const root = document.createElement('div');
    document.body.append(root);
    const pickPluginFolder = vi.fn(() => Promise.resolve<string | null>('C:\\Users\\me\\hello'));
    const openPluginsFolder = vi.fn();
    const openUri = vi.fn();
    const prefs = new SettingsWindow(
        bridge,
        { pickPicture, openConfig, showTour, fileUrl: (path: string) => path, pickPluginFolder, openPluginsFolder, openUri },
        root,
    );
    windows.push(prefs);
    await prefs.start();
    /** The row titled `title` on any page. */
    const row = (title: string) =>
        [...root.querySelectorAll<HTMLElement>('.nokta-prefs-row')].find(
            (r) => r.querySelector('.nokta-prefs-title')?.textContent === title,
        )!;
    const sets = () => bridge.calls.filter((c) => c.method === 'Set').map((c) => c.args);
    return { bridge, root, prefs, row, sets, pickPicture, openConfig, showTour, pickPluginFolder, openPluginsFolder, openUri };
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
        expect(navs).toEqual(['Appearance', 'Behavior', 'Plugins', 'Home']);
        expect(row('Open on').querySelector('select')!.value).toBe('click');
        expect(row('Show a new song').querySelector('[role=switch]')!.getAttribute('aria-checked')).toBe('false');
        expect(row('Show the clock').querySelector('[role=switch]')!.getAttribute('aria-checked')).toBe('true');

        (root.querySelectorAll<HTMLElement>('.nokta-prefs-nav')[1]).click();
        expect(root.querySelector('.nokta-prefs-heading')!.textContent).toBe('Behavior');
        const shown = [...root.querySelectorAll<HTMLElement>('.nokta-prefs-page')].filter((p) => !p.hidden);
        expect(shown).toHaveLength(1);
    });

    it("lists the built-ins with their switch, and opens one's settings while it is on", async () => {
        const { root, sets } = await mount({ Weather: { enabled: false } });
        const plugin = (title: string) =>
            [...root.querySelectorAll<HTMLElement>('.nokta-prefs-plugin')].find(
                (p) => p.querySelector('.nokta-prefs-plugin-head .nokta-prefs-title')!.textContent === title,
            )!;
        const weather = plugin('Weather');
        const details = weather.querySelector<HTMLElement>('.nokta-prefs-plugin-details')!;
        const sw = weather.querySelector<HTMLElement>('.nokta-prefs-plugin-head [role=switch]')!;
        expect(sw.getAttribute('aria-checked')).toBe('false');
        weather.querySelector<HTMLElement>('.nokta-prefs-plugin-head')!.click();
        expect(details.hidden).toBe(true);

        sw.click();
        expect(details.hidden).toBe(false);
        expect(details.textContent).toContain('Location');
        vi.advanceTimersByTime(SEND_DELAY_MS);
        expect(sets().at(-1)).toEqual(['weather', 'enabled', true]);

        // The focus timer has no switch, only its settings.
        const focus = plugin('Focus timer');
        expect(focus.querySelector('.nokta-prefs-plugin-head [role=switch]')).toBeNull();
        expect(focus.textContent).toContain('Focus length');
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

    it('opens Appearance on a preview, and its gallery picks the theme at once', async () => {
        const { root, row, sets } = await mount();
        expect(row('Theme')).toBeUndefined();
        expect(row('Theme in light style')).toBeDefined();
        const cards = () => [...root.querySelectorAll<HTMLElement>('.nokta-prefs-theme')];
        const chosen = () => cards().find((card) => card.getAttribute('aria-checked') === 'true')?.textContent;
        expect(cards().map((card) => card.textContent)).toContain('Paper');
        expect(chosen()).toBe('Midnight');
        // The sky's gradient, then the notch's.
        const body = () => root.querySelectorAll('.nokta-prefs-preview linearGradient')[1]?.querySelector('stop')?.getAttribute('stop-color');
        const before = body();
        cards().find((card) => card.textContent === 'Paper')!.click();
        expect(chosen()).toBe('Paper');
        expect(body()).not.toBe(before);
        expect(sets()).toEqual([]);
        vi.advanceTimersByTime(SEND_DELAY_MS);
        expect(sets()).toEqual([['appearance', 'theme', 'paper']]);
    });

    it("says when the core can't read the chosen picture", async () => {
        const subtitle = (r: HTMLElement) => r.querySelector('.nokta-prefs-subtitle')!.textContent;
        const unread = await mount({ Appearance: { picture: 'C:\\Users\\me\\broken.png' } });
        expect(subtitle(unread.row('Picture'))).toBe("Can't read this picture");
        windows.splice(0).forEach((prefs) => prefs.stop());
        document.body.replaceChildren();
        const read = await mount({ Appearance: { picture: 'C:\\Users\\me\\beach.jpg' }, PicturePath: 'C:\\cache\\picture.png' });
        expect(subtitle(read.row('Picture'))).not.toBe("Can't read this picture");
        expect(read.root.querySelector('.nokta-prefs-preview image')).toBeNull();
    });
});

describe('added plugins on Windows', () => {
    const info = JSON.stringify({
        name: 'Site status',
        version: '1.0.0',
        author: 'Ren',
        homepage: 'https://example.com/site',
        runs_here: true,
        options: [
            { key: 'url', title: 'Address', type: 'text', value: 'https://example.com' },
            { key: 'every', title: 'Minutes', type: 'int', min: 1, max: 60, value: 5 },
            { key: 'badge', title: 'Badge', type: 'bool', value: false },
        ],
    });
    const plugins = (enabled: boolean, status = 'off', message = ''): Props => ({
        Plugins: [['site-status', enabled, status, message, info]],
        Cards: [],
    });

    async function mountPlugins(props: Props, answers: Record<string, unknown> = {}) {
        const mounted = await mount({}, answers);
        mounted.bridge.set('Plugins1', props);
        const item = () => mounted.root.querySelector<HTMLElement>('[data-plugin="site-status"]')!;
        const pluginCalls = () => mounted.bridge.calls.filter((c) => c.iface === 'Plugins1').map((c) => [c.method, ...c.args]);
        return { ...mounted, item, pluginCalls };
    }

    it('says what each one is doing, and turns it on with its switch', async () => {
        const { item, bridge, pluginCalls } = await mountPlugins(plugins(false));
        expect(item().querySelector('.nokta-prefs-title')?.textContent).toBe('Site status');
        const sw = item().querySelector<HTMLButtonElement>('.nokta-prefs-plugin-head .nokta-prefs-switch')!;
        expect(sw.getAttribute('aria-checked')).toBe('false');
        sw.click();
        expect(pluginCalls()).toContainEqual(['SetEnabled', 'site-status', true]);
        // The details stay closed: the switch is not the row.
        expect(item().querySelector<HTMLElement>('.nokta-prefs-plugin-details')?.hidden).toBe(true);
        bridge.set('Plugins1', plugins(true, 'error', 'exited with 1'));
        const subtitle = item().querySelector('.nokta-prefs-plugin-head .nokta-prefs-subtitle');
        expect(subtitle?.textContent).toBe('Failed: exited with 1');
        expect(subtitle?.classList).toContain('nokta-prefs-warning');
    });

    it('sends an option once typing stops, and a switch at once', async () => {
        const { item, pluginCalls } = await mountPlugins(plugins(false));
        item().querySelector<HTMLElement>('.nokta-prefs-plugin-head')!.click();
        expect(item().querySelector<HTMLElement>('.nokta-prefs-plugin-details')?.hidden).toBe(false);
        const text = item().querySelector<HTMLInputElement>('.nokta-prefs-text')!;
        expect(text.value).toBe('https://example.com');
        text.value = 'https://nokta.io';
        text.dispatchEvent(new Event('input'));
        expect(pluginCalls()).toEqual([]);
        await vi.advanceTimersByTimeAsync(1000);
        expect(pluginCalls()).toContainEqual(['SetOption', 'site-status', 'url', 'https://nokta.io']);
        item().querySelector<HTMLButtonElement>('.nokta-prefs-plugin-details .nokta-prefs-switch')!.click();
        expect(pluginCalls()).toContainEqual(['SetOption', 'site-status', 'badge', 'true']);
        expect(item().querySelector<HTMLInputElement>('.nokta-prefs-number')?.value).toBe('5');
    });

    it('adds one from a folder and removes one after asking', async () => {
        const { root, item, pickPluginFolder, openPluginsFolder, pluginCalls } = await mountPlugins(plugins(false));
        const button = (text: string) =>
            [...root.querySelectorAll<HTMLButtonElement>('.nokta-prefs-button')].find((b) => b.textContent === text)!;
        button('Add from Folder…').click();
        await vi.advanceTimersByTimeAsync(0);
        expect(pickPluginFolder).toHaveBeenCalled();
        expect(pluginCalls()).toContainEqual(['Install', 'C:\\Users\\me\\hello']);
        button('Open the plugins folder').click();
        expect(openPluginsFolder).toHaveBeenCalled();
        item().querySelector<HTMLElement>('.nokta-prefs-plugin-head')!.click();
        [...item().querySelectorAll<HTMLButtonElement>('.nokta-prefs-destructive')][0].click();
        expect(pluginCalls().some(([method]) => method === 'Remove')).toBe(false);
        const dialog = root.querySelector<HTMLElement>('.nokta-prefs-dialog')!;
        [...dialog.querySelectorAll<HTMLButtonElement>('.nokta-prefs-destructive')][0].click();
        expect(pluginCalls()).toContainEqual(['Remove', 'site-status']);
    });

    it('points to the examples when none is added', async () => {
        const { root, openUri } = await mountPlugins({ Plugins: [], Cards: [] });
        const examples = [...root.querySelectorAll<HTMLButtonElement>('.nokta-prefs-button')].find((b) => b.textContent === 'Examples')!;
        examples.click();
        expect(openUri).toHaveBeenCalledWith(expect.stringContaining('examples/plugins'));
    });

    it('asks the catalog only on Browse, then installs or updates from it', async () => {
        const listing = (id: string, version: string, runs_here = true) => ({ id, name: id, version, runs_here });
        const catalog = JSON.stringify([
            listing('site-status', '1.1.0'),
            listing('days-until', '1.0.0'),
            listing('mac-battery', '0.2.0', false),
        ]);
        const { root, pluginCalls } = await mountPlugins(plugins(false), { 'Plugins1.Catalog': catalog });
        const group = root.querySelector<HTMLElement>('.nokta-prefs-catalog')!;
        expect(pluginCalls().some(([method]) => method === 'Catalog')).toBe(false);
        expect(group.textContent).toContain('Press Browse to see the plugins');
        const browse = group.querySelector<HTMLButtonElement>('.nokta-prefs-group-actions .nokta-prefs-button')!;
        browse.click();
        await vi.advanceTimersByTimeAsync(0);
        expect(browse.textContent).toBe('Refresh');
        const control = (id: string) => group.querySelector(`[data-plugin="${id}"] .nokta-prefs-control`)!;
        expect(control('mac-battery').textContent).toBe('Not for this system');
        control('site-status').querySelector<HTMLButtonElement>('button')!.click();
        control('days-until').querySelector<HTMLButtonElement>('button')!.click();
        await vi.advanceTimersByTimeAsync(0);
        expect(pluginCalls()).toContainEqual(['InstallFromCatalog', 'site-status']);
        expect(pluginCalls()).toContainEqual(['InstallFromCatalog', 'days-until']);
        expect(root.textContent).toContain('Updated');
    });
});
