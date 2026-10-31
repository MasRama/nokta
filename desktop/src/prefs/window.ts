import { rowMin, rowValue, type Row, type Table } from '@ext/features/settings/logic/schema.js';
import { pageIcon } from '@ext/prefs/logic/look.js';
import { _ } from '@ext/shared/logic/i18n.js';

import type { Bridge } from '../bridge/bridge.js';
import { Follower } from '../follower.js';
import { icon } from '../icons.js';
import { windowsPages, type PrefPage, type PrefRow } from './logic.js';
import { buildRow, type RowHost, type SettingRow, type SettingValue } from './rows.js';
import WORDMARK from '../../../extension/icons/nokta-wordmark-reverse.svg?raw';

/** A change is sent after this long without another one, so a dragged slider sends one value. */
export const SEND_DELAY_MS = 250;
/** How long a message stays. */
const TOAST_MS = 5000;

export interface PrefsHost extends RowHost {
    /** Opens config.toml in the app Windows opens it with. */
    openConfig(): void;
    /** Shows the first-run tour again in the primary monitor's notch. */
    showTour(): Promise<void>;
}

const TABLES: Record<Table, string> = {
    appearance: 'Appearance',
    behavior: 'Behavior',
    media: 'Media',
    lyrics: 'Lyrics',
    timer: 'Timer',
    notifications: 'Notifications',
    activities: 'Activities',
    weather: 'Weather',
    calendar: 'Calendar',
    clipboard: 'Clipboard',
    downloads: 'Downloads',
    system: 'System',
    updates: 'Updates',
    home: 'Home',
};

/** Settings1's tables, by their name in config.toml. */
class SettingsTables extends Follower {
    tables: Partial<Record<Table, unknown>> = {};

    constructor(bridge: Bridge, onChanged: () => void) {
        super(bridge, 'Settings1', onChanged);
    }

    protected override read(): void {
        const tables: Partial<Record<Table, unknown>> = {};
        for (const [table, property] of Object.entries(TABLES) as [Table, string][]) tables[table] = this.props[property];
        this.tables = tables;
    }
}

const nameOf = (row: Pick<Row, 'table' | 'key'>) => `${row.table}.${row.key}`;
/** `rowValue` and `rowMin` read only a row's table, key and kind; a feeds row has no floor. */
const asRow = (row: PrefRow): Row => (row.kind.type === 'feeds' ? { ...row, kind: { type: 'text' } } : (row as Row));

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
    const el = document.createElement(tag);
    el.className = className;
    if (text !== undefined) el.textContent = text;
    return el;
}

/**
 * The settings window on Windows: every setting of config.toml, from the
 * extension's schema, in Nokta's own dark window with a sidebar of pages,
 * as the extension's GTK window. Each change goes to `Settings1.Set`; a
 * value the core refuses shows its message and the core's value again.
 */
export class SettingsWindow {
    private readonly settings: SettingsTables;
    private readonly rows: SettingRow[] = [];
    private readonly pending = new Map<string, { timer: number; send: () => void }>();
    private readonly navs = new Map<string, HTMLButtonElement>();
    private readonly sections = new Map<string, HTMLElement>();
    private readonly heading: HTMLHeadingElement;
    private readonly content: HTMLElement;
    private readonly toasts: HTMLElement;
    private readonly confirm: HTMLElement;

    constructor(
        private readonly bridge: Bridge,
        private readonly host: PrefsHost,
        root: HTMLElement,
        private readonly pages: readonly PrefPage[] = windowsPages(),
    ) {
        this.settings = new SettingsTables(bridge, () => this.showAll());
        const frame = element('div', 'nokta-prefs');
        const sidebar = element('nav', 'nokta-prefs-sidebar');
        const brand = element('div', 'nokta-prefs-brand');
        brand.innerHTML = WORDMARK;
        sidebar.append(brand);
        this.content = element('main', 'nokta-prefs-content');
        this.heading = element('h1', 'nokta-prefs-heading');
        this.content.append(this.heading);
        for (const page of pages) {
            const nav = element('button', 'nokta-prefs-nav');
            nav.type = 'button';
            nav.append(icon(pageIcon(page.name) ?? 'settings', 18), element('span', '', _(page.title))); // i18n: runtime
            nav.addEventListener('click', () => this.show(page.name));
            sidebar.append(nav);
            this.navs.set(page.name, nav);
            const section = element('section', 'nokta-prefs-page');
            for (const group of page.groups) section.append(this.group(group.title, group.description, group.rows));
            if (page.name === 'behavior') section.append(this.tourGroup(), this.configGroup());
            this.content.append(section);
            this.sections.set(page.name, section);
        }
        this.toasts = element('div', 'nokta-prefs-toasts');
        this.confirm = this.resetDialog();
        frame.append(sidebar, this.content, this.toasts, this.confirm);
        root.append(frame);
        this.show(pages[0].name);
    }

    async start(): Promise<void> {
        await this.settings.attach();
    }

    /** Sends what is still waiting and stops following the settings. */
    stop(): void {
        for (const { timer, send } of [...this.pending.values()]) {
            window.clearTimeout(timer);
            send();
        }
        this.settings.detach();
    }

    /** Shows the page named `name`. */
    show(name: string): void {
        const page = this.pages.find((p) => p.name === name);
        if (!page) return;
        this.heading.textContent = _(page.title); // i18n: runtime
        for (const [n, nav] of this.navs) nav.classList.toggle('nokta-prefs-nav-chosen', n === name);
        for (const [n, section] of this.sections) section.hidden = n !== name;
        this.content.scrollTop = 0;
    }

    /** Shows `text` for a few seconds at the bottom of the window. */
    toast(text: string): void {
        const toast = element('div', 'nokta-prefs-toast', text);
        this.toasts.append(toast);
        window.setTimeout(() => toast.remove(), TOAST_MS);
    }

    private group(title: string, description: string | undefined, rows: readonly PrefRow[]): HTMLElement {
        const group = element('div', 'nokta-prefs-group');
        group.append(element('h2', 'nokta-prefs-group-title', _(title))); // i18n: runtime
        if (description) group.append(element('p', 'nokta-prefs-group-description', _(description))); // i18n: runtime
        const card = element('div', 'nokta-prefs-card');
        for (const row of rows) {
            const setting: SettingRow = buildRow(row, (value) => this.queue(setting, value), this.host);
            setting.show(rowValue(asRow(row), {}));
            this.rows.push(setting);
            card.append(setting.element);
        }
        group.append(card);
        return group;
    }

    /** Show the tour again. */
    private tourGroup(): HTMLElement {
        const group = element('div', 'nokta-prefs-group');
        group.append(element('h2', 'nokta-prefs-group-title', _('Getting started')));
        const card = element('div', 'nokta-prefs-card');
        card.append(
            this.actionRow(_('Show the tour again'), _('The notch walks you through Nokta once more'), _('Show'), false, () => {
                this.host
                    .showTour()
                    .then(() => this.toast(_('The tour shows in the notch')))
                    .catch((error: unknown) => this.toast(message(error)));
            }),
        );
        group.append(card);
        return group;
    }

    /** Open config.toml, and Reset all settings. */
    private configGroup(): HTMLElement {
        const group = element('div', 'nokta-prefs-group');
        group.append(element('h2', 'nokta-prefs-group-title', _('Config file')));
        const card = element('div', 'nokta-prefs-card');
        card.append(
            this.actionRow(_('Open config.toml'), '', _('Open'), false, () => this.host.openConfig()),
            this.actionRow(_('Reset all settings'), _('Replace config.toml with the default one'), _('Reset'), true, () => {
                this.confirm.hidden = false;
            }),
        );
        group.append(card);
        return group;
    }

    private actionRow(title: string, subtitle: string, action: string, destructive: boolean, onClick: () => void): HTMLElement {
        const row = element('div', 'nokta-prefs-row');
        const label = element('div', 'nokta-prefs-label');
        label.append(element('span', 'nokta-prefs-title', title));
        if (subtitle) label.append(element('span', 'nokta-prefs-subtitle', subtitle));
        const button = element('button', `nokta-prefs-button${destructive ? ' nokta-prefs-destructive' : ''}`, action);
        button.type = 'button';
        button.addEventListener('click', onClick);
        const control = element('div', 'nokta-prefs-control');
        control.append(button);
        row.append(label, control);
        return row;
    }

    private resetDialog(): HTMLElement {
        const scrim = element('div', 'nokta-prefs-scrim');
        scrim.hidden = true;
        const dialog = element('div', 'nokta-prefs-dialog');
        dialog.setAttribute('role', 'alertdialog');
        dialog.append(
            element('h2', 'nokta-prefs-dialog-title', _('Reset all settings?')),
            element(
                'p',
                'nokta-prefs-dialog-body',
                _('Every setting goes back to its default. config.toml is replaced, including any comments you added.'),
            ),
        );
        const buttons = element('div', 'nokta-prefs-dialog-buttons');
        const cancel = element('button', 'nokta-prefs-button', _('Cancel'));
        const reset = element('button', 'nokta-prefs-button nokta-prefs-destructive', _('Reset'));
        cancel.type = reset.type = 'button';
        cancel.addEventListener('click', () => (scrim.hidden = true));
        reset.addEventListener('click', () => {
            scrim.hidden = true;
            this.bridge.call('Settings1', 'Reset').catch((error: unknown) => this.toast(message(error)));
        });
        buttons.append(cancel, reset);
        dialog.append(buttons);
        scrim.append(dialog);
        return scrim;
    }

    /** Sends `value` once the user stops changing it. */
    private queue(setting: SettingRow, value: SettingValue): void {
        const { row } = setting;
        const name = nameOf(row);
        const send = () => {
            this.pending.delete(name);
            this.bridge.call('Settings1', 'Set', row.table, row.key, value).catch((error: unknown) => {
                this.toast(message(error));
                if (!this.pending.has(name)) setting.show(rowValue(asRow(row), this.settings.tables));
            });
        };
        const old = this.pending.get(name);
        if (old) window.clearTimeout(old.timer);
        this.pending.set(name, { timer: window.setTimeout(send, SEND_DELAY_MS), send });
    }

    private showAll(): void {
        const { tables } = this.settings;
        for (const setting of this.rows) {
            const row = asRow(setting.row);
            setting.setMin?.(rowMin(row, tables));
            if (!this.pending.has(nameOf(row))) setting.show(rowValue(row, tables));
        }
    }
}

/** The core's message for a refused call. */
function message(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
