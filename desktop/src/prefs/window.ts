import { appearanceFrom } from '@ext/features/settings/logic/parse.js';
import { rowMin, rowValue, type Row, type Table } from '@ext/features/settings/logic/schema.js';
import { pageIcon, previewModel } from '@ext/prefs/logic/look.js';
import { _ } from '@ext/shared/logic/i18n.js';
import type { PictureState } from '@ext/shared/logic/theme.js';

import type { Bridge } from '../bridge/bridge.js';
import { Follower } from '../follower.js';
import { icon } from '../icons.js';
import { windowsPages, type PrefGroup, type PrefPage, type PrefRow } from './logic.js';
import { NotchPreview, ThemeGallery } from './look.js';
import { AddedPlugins, type PluginsHost } from './plugins.js';
import { buildRow, type RowHost, type SettingRow, type SettingValue } from './rows.js';
import WORDMARK from '../../../extension/icons/nokta-wordmark-reverse.svg?raw';

/** A change is sent after this long without another one, so a dragged slider sends one value. */
export const SEND_DELAY_MS = 250;
/** How long a message stays. */
const TOAST_MS = 5000;

export interface PrefsHost extends RowHost, PluginsHost {
    /** Opens config.toml in the app Windows opens it with. */
    openConfig(): void;
    /** Shows the first-run tour again in the primary monitor's notch. */
    showTour(): Promise<void>;
    /** A file's path as a URL the page loads, for the picture theme's image. */
    fileUrl(path: string): string;
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

/** Settings1's tables, by their name in config.toml, and the picture the core prepared. */
class SettingsTables extends Follower {
    tables: Partial<Record<Table, unknown>> = {};
    picture = { path: '', color: '', tone: '' };

    constructor(bridge: Bridge, onChanged: () => void) {
        super(bridge, 'Settings1', onChanged);
    }

    protected override read(): void {
        const tables: Partial<Record<Table, unknown>> = {};
        for (const [table, property] of Object.entries(TABLES) as [Table, string][]) tables[table] = this.props[property];
        this.tables = tables;
        const text = (name: string): string => (typeof this.props[name] === 'string' ? this.props[name] : '');
        this.picture = { path: text('PicturePath'), color: text('PictureColor'), tone: text('PictureTone') };
    }
}

const nameOf = (row: Pick<Row, 'table' | 'key'>) => `${row.table}.${row.key}`;
/** The gallery picks the theme, so its row does not show, as in the extension's window. */
const isTheme = (row: Pick<Row, 'table' | 'key'>) => nameOf(row) === 'appearance.theme';
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
    /** Changes waiting to be sent, with their value: the preview shows them at once. */
    private readonly pending = new Map<string, { timer: number; send: () => void; value: SettingValue }>();
    private readonly navs = new Map<string, HTMLButtonElement>();
    private readonly sections = new Map<string, HTMLElement>();
    private readonly heading: HTMLHeadingElement;
    private readonly content: HTMLElement;
    private readonly toasts: HTMLElement;
    private readonly confirm: HTMLElement;
    private readonly preview: NotchPreview;
    private readonly gallery: ThemeGallery;
    private readonly added: AddedPlugins;

    constructor(
        private readonly bridge: Bridge,
        private readonly host: PrefsHost,
        root: HTMLElement,
        private readonly pages: readonly PrefPage[] = windowsPages(),
    ) {
        this.settings = new SettingsTables(bridge, () => this.showAll());
        this.added = new AddedPlugins(bridge, host, (text) => this.toast(text));
        this.preview = new NotchPreview((path) => host.fileUrl(path));
        const themeRow = pages.flatMap((page) => page.groups.flatMap((group) => group.rows)).find(isTheme);
        const theme: SettingRow | null = themeRow ? { row: themeRow, element: document.body, show: () => this.showLook() } : null;
        this.gallery = new ThemeGallery((name) => theme && this.queue(theme, name), (path) => host.fileUrl(path));
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
            if (page.name === 'appearance') section.append(this.lookGroup());
            if (page.name === 'plugins') {
                section.append(this.builtIns(page.groups), this.added.element, this.added.catalogElement, this.added.creatorElement);
            } else for (const group of page.groups) section.append(this.group(group.title, group.description, group.rows));
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
        await Promise.all([this.settings.attach(), this.added.attach()]);
    }

    /** Sends what is still waiting and stops following the settings. */
    stop(): void {
        for (const { timer, send } of [...this.pending.values()]) {
            window.clearTimeout(timer);
            send();
        }
        this.settings.detach();
        this.added.detach();
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
        for (const row of rows.filter((r) => !isTheme(r))) {
            const setting: SettingRow = buildRow(row, (value) => this.queue(setting, value), this.host);
            setting.show(rowValue(asRow(row), {}));
            this.rows.push(setting);
            card.append(setting.element);
        }
        group.append(card);
        return group;
    }

    /**
     * The Plugins page's built-ins, one card: each one's icon, name and what
     * it does with its on/off switch, and its settings under it, shown while
     * it is on and opened.
     */
    private builtIns(groups: readonly PrefGroup[]): HTMLElement {
        const group = element('div', 'nokta-prefs-group');
        group.append(
            element('h2', 'nokta-prefs-group-title', _('Built in')),
            element('p', 'nokta-prefs-group-description', _('Part of Nokta. Turn off what you do not use; open one for its settings.')),
        );
        const card = element('div', 'nokta-prefs-card');
        for (const spec of groups) {
            const item = element('div', 'nokta-prefs-plugin');
            const head = element('div', 'nokta-prefs-row nokta-prefs-plugin-head nokta-prefs-clickable');
            const label = element('div', 'nokta-prefs-label');
            label.append(
                element('span', 'nokta-prefs-title', _(spec.title)), // i18n: runtime
                element('span', 'nokta-prefs-subtitle', _(spec.description ?? '')), // i18n: runtime
            );
            const chip = element('span', 'nokta-prefs-plugin-icon');
            chip.append(icon(spec.icon ?? 'settings', 18));
            const control = element('div', 'nokta-prefs-control');
            const chevron = icon('chevron-down', 16);
            chevron.classList.add('nokta-prefs-plugin-chevron');
            head.append(chip, label, control);
            const details = element('div', 'nokta-prefs-plugin-details');
            details.hidden = true;
            let on = true;
            const fold = () => {
                details.hidden = !on || !item.classList.contains('nokta-prefs-plugin-open');
                head.setAttribute('aria-expanded', String(!details.hidden));
            };
            const [first, ...others] = spec.rows;
            const rest = spec.master ? others : spec.rows;
            if (spec.master) {
                const master = buildRow(first, (value) => this.queue(setting, value), this.host);
                const setting: SettingRow = {
                    row: first,
                    element: master.element,
                    show: (value) => {
                        master.show(value);
                        on = value === true;
                        item.classList.toggle('nokta-prefs-plugin-off', !on);
                        fold();
                    },
                };
                const sw = master.element.querySelector('.nokta-prefs-switch');
                if (sw) {
                    sw.addEventListener('click', (event) => {
                        event.stopPropagation();
                        on = sw.getAttribute('aria-checked') === 'true';
                        item.classList.toggle('nokta-prefs-plugin-off', !on);
                        fold();
                    });
                    sw.setAttribute('aria-label', _(spec.title)); // i18n: runtime
                    control.append(sw);
                }
                setting.show(rowValue(asRow(first), {}));
                this.rows.push(setting);
            }
            if (rest.length) {
                control.prepend(chevron);
                head.addEventListener('click', () => {
                    item.classList.toggle('nokta-prefs-plugin-open');
                    fold();
                });
            } else head.classList.remove('nokta-prefs-clickable');
            for (const row of rest) {
                const setting: SettingRow = buildRow(row, (value) => this.queue(setting, value), this.host);
                setting.show(rowValue(asRow(row), {}));
                this.rows.push(setting);
                details.append(setting.element);
            }
            fold();
            item.append(head, details);
            card.append(item);
        }
        group.append(card);
        return group;
    }

    /** The live preview over the theme gallery, first on Appearance. */
    private lookGroup(): HTMLElement {
        const group = element('div', 'nokta-prefs-group nokta-prefs-look');
        group.append(this.preview.element, this.gallery.element);
        this.showLook();
        return group;
    }

    /** Draws the preview and the gallery from the core's appearance, with the changes not sent yet. */
    private showLook(): void {
        const raw: Record<string, unknown> = { ...((this.settings.tables.appearance as Record<string, unknown> | undefined) ?? {}) };
        for (const [name, { value }] of this.pending) if (name.startsWith('appearance.')) raw[name.slice(11)] = value;
        const appearance = appearanceFrom(raw);
        const picture: PictureState = { ...this.settings.picture, darken: appearance.pictureDarken };
        this.preview.update(previewModel(appearance, picture));
        this.gallery.update(appearance, appearance.theme, picture);
    }

    /** A picture chosen but not prepared by the core could not be read: its row says so. */
    private warnUnreadablePicture(): void {
        const setting = this.rows.find((r) => nameOf(r.row) === 'appearance.picture');
        const subtitle = setting?.element.querySelector<HTMLElement>('.nokta-prefs-subtitle');
        if (!setting || !subtitle) return;
        const chosen = rowValue(asRow(setting.row), this.settings.tables);
        const unreadable = Boolean(chosen) && !this.settings.picture.path && !this.pending.has('appearance.picture');
        subtitle.textContent = unreadable ? _("Can't read this picture") : _(setting.row.subtitle ?? ''); // i18n: runtime
        subtitle.hidden = !subtitle.textContent;
        subtitle.classList.toggle('nokta-prefs-warning', unreadable);
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
        this.pending.set(name, { timer: window.setTimeout(send, SEND_DELAY_MS), send, value });
        if (row.table === 'appearance') this.showLook();
    }

    private showAll(): void {
        const { tables } = this.settings;
        for (const setting of this.rows) {
            const row = asRow(setting.row);
            setting.setMin?.(rowMin(row, tables));
            if (!this.pending.has(nameOf(row))) setting.show(rowValue(row, tables));
        }
        this.warnUnreadablePicture();
        this.showLook();
    }
}

/** The core's message for a refused call. */
function message(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
