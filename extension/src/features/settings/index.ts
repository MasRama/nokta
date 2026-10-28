export { SettingsClient } from './client.js';
export type {
    Appearance,
    Behavior,
    CalendarSettings,
    ClipboardSettings,
    HomeSettings,
    HomeTile,
    HomeToggle,
    NotificationSettings,
    TimerSettings,
} from './logic/parse.js';
export { appearanceFrom } from './logic/parse.js';
export { themeSwatches, type ThemeSwatch } from './logic/quick.js';
export { moveItem, orderItems, switchItem, type OrderItem } from './logic/order.js';
export { allRows, rowValue, SETTINGS_PAGES, variantType, type Row, type Table } from './logic/schema.js';
// The settings window imports this index too, so the notch's settings page
// (St) is imported from './page.js' on its own.
