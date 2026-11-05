import { MockBridge } from '../bridge/mock.js';
import { TauriBridge } from '../bridge/tauri.js';
import { useSystemLanguage } from '../i18n.js';
import {
    fileUrl,
    hideWebMenu,
    inTauri,
    openConfig,
    openPluginsFolder,
    openUri,
    pickPicture,
    pickPluginFolder,
    showTour,
} from '../platform.js';
import { SettingsWindow } from './window.js';

// Outside the app the window shows the defaults, for shots; `?page=` picks the page.
useSystemLanguage();
hideWebMenu();
const app = inTauri();
const sample = (name: string, description: string, options: unknown[] = []) =>
    JSON.stringify({ name, description, version: '1.0.0', author: 'Ren', homepage: 'https://example.com', runs_here: true, options });
const mock = new MockBridge({
    Settings1: { Calendar: { feeds: ['https://calendar.google.com/calendar/ical/me%40gmail.com/private-abc/basic.ics'] } },
    Plugins1: {
        Plugins: [
            ['site-status', true, 'ok', '', sample('Site status', 'Checks that a website answers', [{ key: 'url', title: 'Address', type: 'text', value: 'https://example.com' }])],
            ['water', false, 'off', '', sample('Water', 'Counts the glasses you drink')],
            ['build', true, 'error', 'exited with 1', sample('Build', '')],
        ],
        Cards: [],
    },
}, {
    'Plugins1.Catalog': JSON.stringify([
        { id: 'site-status', name: 'Site status', description: 'Checks that a website answers', version: '1.1.0', author: 'Nokta', icon: 'nokta-link', runs_here: true },
        { id: 'water', name: 'Water', description: 'Counts the glasses you drink', version: '1.0.0', author: 'Nokta', runs_here: true },
        { id: 'days-until', name: 'Days until', description: 'Counts down the days to a date', version: '1.0.0', author: 'Nokta', icon: 'nokta-calendar', runs_here: true },
        { id: 'mac-battery', name: 'Mac battery', description: 'Your MacBook battery health', version: '0.2.0', author: 'Someone', runs_here: false },
    ]),
    'Plugins1.Creator': JSON.stringify({ provider: 'anthropic', model: '', default_model: 'claude-opus-5-5', base_url: '', has_key: true, ready: true }),
    'Plugins1.Create': 'my-plugin',
});
const prefs = new SettingsWindow(app ? new TauriBridge() : mock, { openConfig, pickPicture, showTour, fileUrl, pickPluginFolder, openPluginsFolder, openUri }, document.body);
const page = new URLSearchParams(location.search).get('page');
if (page) prefs.show(page);
window.addEventListener('pagehide', () => prefs.stop());
await prefs.start();
// `?browse` presses the catalog's Browse, for a shot of it.
if (!app && new URLSearchParams(location.search).has('browse')) {
    document.querySelector<HTMLButtonElement>('.nokta-prefs-catalog .nokta-prefs-button')?.click();
}
