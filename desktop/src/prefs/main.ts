import { MockBridge } from '../bridge/mock.js';
import { TauriBridge } from '../bridge/tauri.js';
import { useSystemLanguage } from '../i18n.js';
import { inTauri, openConfig, pickPicture } from '../platform.js';
import { SettingsWindow } from './window.js';

// Outside the app the window shows the defaults, for shots; `?page=` picks the page.
useSystemLanguage();
const app = inTauri();
const mock = new MockBridge({
    Settings1: { Calendar: { feeds: ['https://calendar.google.com/calendar/ical/me%40gmail.com/private-abc/basic.ics'] } },
});
const prefs = new SettingsWindow(app ? new TauriBridge() : mock, { openConfig, pickPicture }, document.body);
const page = new URLSearchParams(location.search).get('page');
if (page) prefs.show(page);
window.addEventListener('pagehide', () => prefs.stop());
await prefs.start();
