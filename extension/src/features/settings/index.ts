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
export { moveItem, orderItems, switchItem, type OrderItem } from './logic/order.js';
export { allRows, rowValue, SETTINGS_PAGES, variantType, type Row, type Table } from './logic/schema.js';
