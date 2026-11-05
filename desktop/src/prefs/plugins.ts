import {
    CATALOG_URL,
    catalogFrom,
    catalogState,
    optionText,
    PLUGIN_ICON,
    pluginsFrom,
    statusText,
    type CatalogPlugin,
    type Plugin,
    type PluginOption,
} from '@ext/features/plugins/logic/plugins.js';
import { _ } from '@ext/shared/logic/i18n.js';

import type { Bridge } from '../bridge/bridge.js';
import { Follower } from '../follower.js';
import { hasIcon, icon } from '../icons.js';

/** A number or a text is sent after this long without another change, as the extension's window. */
const SEND_DELAY_MS = 600;

export interface PluginsHost {
    /** Asks for a plugin's folder in Windows' folder dialog; null when cancelled. */
    pickPluginFolder(): Promise<string | null>;
    /** Opens the plugins folder in Explorer. */
    openPluginsFolder(): void;
    openUri(uri: string): void;
}

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
    const el = document.createElement(tag);
    el.className = className;
    if (text !== undefined) el.textContent = text;
    return el;
}

function button(text: string, onClick: () => void, extra = ''): HTMLButtonElement {
    const b = element('button', `nokta-prefs-button${extra}`, text);
    b.type = 'button';
    b.addEventListener('click', onClick);
    return b;
}

/** What makes the rows differ: rebuilt when it changes, else updated in place. */
const shapeOf = (plugins: readonly Plugin[]): string =>
    JSON.stringify(plugins.map((p) => [p.id, p.runsHere, p.options.map((o) => [o.key, o.type, o.choices])]));

/** One plugin's row, updated in place while its shape stays. */
interface Shown {
    update(plugin: Plugin): void;
}

/**
 * The Plugins page's added plugins, as the extension's prefs/plugins.ts:
 * each with its switch, what it is doing or why it failed, its options,
 * where it is from and a button to remove it; Add from Folder copies one
 * in, off. Under it, the catalog's plugins, asked for only on Browse.
 */
export class AddedPlugins extends Follower {
    readonly element: HTMLElement;
    /** The catalog's group, shown under this one. */
    readonly catalogElement: HTMLElement;
    private readonly card: HTMLElement;
    private readonly catalogCard: HTMLElement;
    private readonly browseButton: HTMLButtonElement;
    /** The catalog's plugins once Browse was pressed. */
    private listings: CatalogPlugin[] | null = null;
    /** The ones being installed. */
    private readonly busy = new Set<string>();
    private list: Plugin[] = [];
    private shape = '';
    private readonly shown = new Map<string, Shown>();
    /** The plugins opened to their options, kept across a rebuild. */
    private readonly opened = new Set<string>();

    constructor(
        bridge: Bridge,
        private readonly host: PluginsHost,
        private readonly toast: (text: string) => void,
    ) {
        super(bridge, 'Plugins1', () => this.show());
        this.element = element('div', 'nokta-prefs-group');
        const head = element('div', 'nokta-prefs-group-head');
        const actions = element('div', 'nokta-prefs-group-actions');
        actions.append(
            button(_('Open the plugins folder'), () => host.openPluginsFolder()),
            button(_('Add from Folder…'), () => void this.add()),
        );
        head.append(element('h2', 'nokta-prefs-group-title', _('Added')), actions);
        this.element.append(
            head,
            element(
                'p',
                'nokta-prefs-group-description',
                _('Plugins run as you and can read your files: only add ones you trust. A new one starts off.'),
            ),
        );
        this.card = element('div', 'nokta-prefs-card');
        this.element.append(this.card);

        this.catalogElement = element('div', 'nokta-prefs-group nokta-prefs-catalog');
        const catalogHead = element('div', 'nokta-prefs-group-head');
        const catalogActions = element('div', 'nokta-prefs-group-actions');
        this.browseButton = button(_('Browse'), () => void this.browse());
        catalogActions.append(this.browseButton);
        catalogHead.append(element('h2', 'nokta-prefs-group-title', _('Catalog')), catalogActions);
        this.catalogCard = element('div', 'nokta-prefs-card');
        this.catalogElement.append(
            catalogHead,
            element(
                'p',
                'nokta-prefs-group-description',
                _('Plugins shared on github.com/MasRama/nokta-plugins. Nokta checks every file against the catalog before it installs one.'),
            ),
            this.catalogCard,
        );
        this.show();
    }

    protected override read(): void {
        this.list = pluginsFrom(this.props.Plugins);
    }

    private async add(): Promise<void> {
        const folder = await this.host.pickPluginFolder();
        if (!folder) return;
        try {
            await this.bridge.call('Plugins1', 'Install', folder);
            this.toast(_('Added. Turn it on when you are ready.'));
        } catch (error) {
            this.toast(message(error));
        }
    }

    private send(method: string, ...args: unknown[]): void {
        this.bridge.call('Plugins1', method, ...args).catch((error: unknown) => {
            this.toast(message(error));
            // The core's state again, over what was clicked.
            this.shape = '';
            this.show();
        });
    }

    private async browse(): Promise<void> {
        this.browseButton.disabled = true;
        try {
            const json = await this.bridge.call('Plugins1', 'Catalog');
            this.listings = catalogFrom(typeof json === 'string' ? json : '[]');
            this.browseButton.textContent = _('Refresh');
            this.showCatalog();
        } catch (error) {
            this.toast(message(error));
        } finally {
            this.browseButton.disabled = false;
        }
    }

    private async install(listing: CatalogPlugin, update: boolean): Promise<void> {
        this.busy.add(listing.id);
        this.showCatalog();
        try {
            await this.bridge.call('Plugins1', 'InstallFromCatalog', listing.id);
            this.toast(update ? _('Updated') : _('Added. Turn it on when you are ready.'));
        } catch (error) {
            this.toast(message(error));
        } finally {
            this.busy.delete(listing.id);
            this.showCatalog();
        }
    }

    private showCatalog(): void {
        const listings = this.listings;
        if (listings === null) {
            this.catalogCard.replaceChildren(
                this.infoRow(_('Press Browse to see the plugins'), _('Nokta asks the catalog only then')),
            );
            return;
        }
        if (listings.length === 0) {
            const row = this.infoRow(_('The catalog has no plugins yet'), '');
            row.querySelector('.nokta-prefs-control')?.append(button(_('Website'), () => this.host.openUri(CATALOG_URL)));
            this.catalogCard.replaceChildren(row);
            return;
        }
        this.catalogCard.replaceChildren(...listings.map((listing) => this.catalogRow(listing)));
    }

    private infoRow(title: string, subtitle: string): HTMLElement {
        const row = element('div', 'nokta-prefs-row');
        const label = element('div', 'nokta-prefs-label');
        label.append(element('span', 'nokta-prefs-title', title));
        if (subtitle) label.append(element('span', 'nokta-prefs-subtitle', subtitle));
        row.append(label, element('div', 'nokta-prefs-control'));
        return row;
    }

    private catalogRow(listing: CatalogPlugin): HTMLElement {
        const row = element('div', 'nokta-prefs-row nokta-prefs-catalog-row');
        row.dataset.plugin = listing.id;
        const chip = element('span', 'nokta-prefs-plugin-icon');
        chip.append(icon(hasIcon(listing.icon) ? listing.icon : PLUGIN_ICON, 18));
        const about = [listing.description, listing.version && `${_('Version')} ${listing.version}`, listing.author];
        const label = element('div', 'nokta-prefs-label');
        label.append(
            element('span', 'nokta-prefs-title', listing.name),
            element('span', 'nokta-prefs-subtitle', about.filter(Boolean).join(' · ')),
        );
        const control = element('div', 'nokta-prefs-control');
        const state = catalogState(listing, this.list);
        if (state === 'installed' || state === 'unsupported') {
            const text = state === 'installed' ? _('Installed') : _('Not for this system');
            control.append(element('span', 'nokta-prefs-dim', text));
        } else {
            const update = state === 'update';
            const action = button(
                update ? _('Update') : _('Install'),
                () => void this.install(listing, update),
                update ? ' nokta-prefs-suggested' : '',
            );
            action.disabled = this.busy.has(listing.id);
            control.append(action);
        }
        row.append(chip, label, control);
        return row;
    }

    private show(): void {
        this.browseButton.disabled = this.props.Plugins === undefined;
        this.showCatalog();
        const shape = shapeOf(this.list);
        if (shape !== this.shape) {
            this.shape = shape;
            this.shown.clear();
            this.card.replaceChildren(...(this.list.length ? this.list.map((p) => this.row(p)) : [this.empty()]));
        }
        for (const plugin of this.list) this.shown.get(plugin.id)?.update(plugin);
    }

    private empty(): HTMLElement {
        const row = element('div', 'nokta-prefs-row');
        const label = element('div', 'nokta-prefs-label');
        label.append(
            element('span', 'nokta-prefs-title', _('No plugins added yet')),
            element('span', 'nokta-prefs-subtitle', _('Add one from a folder, or write your own: see the examples')),
        );
        const control = element('div', 'nokta-prefs-control');
        control.append(button(_('Examples'), () => this.host.openUri(EXAMPLES)));
        row.append(label, control);
        return row;
    }

    private row(plugin: Plugin): HTMLElement {
        const item = element('div', 'nokta-prefs-plugin');
        item.dataset.plugin = plugin.id;
        const head = element('div', 'nokta-prefs-row nokta-prefs-plugin-head nokta-prefs-clickable');
        const chip = element('span', 'nokta-prefs-plugin-icon');
        chip.append(icon(hasIcon(plugin.icon) ? plugin.icon : PLUGIN_ICON, 18));
        const label = element('div', 'nokta-prefs-label');
        const title = element('span', 'nokta-prefs-title', plugin.name);
        const subtitle = element('span', 'nokta-prefs-subtitle');
        label.append(title, subtitle);
        const control = element('div', 'nokta-prefs-control');
        const chevron = icon('chevron-down', 16);
        chevron.classList.add('nokta-prefs-plugin-chevron');
        const sw = element('button', 'nokta-prefs-switch');
        sw.type = 'button';
        sw.setAttribute('role', 'switch');
        sw.setAttribute('aria-label', plugin.name);
        sw.append(element('span', 'nokta-prefs-knob'));
        sw.hidden = !plugin.runsHere;
        sw.addEventListener('click', (event) => {
            event.stopPropagation();
            const on = sw.getAttribute('aria-checked') !== 'true';
            sw.setAttribute('aria-checked', String(on));
            this.send('SetEnabled', plugin.id, on);
        });
        control.append(chevron, sw);
        head.append(chip, label, control);
        const details = element('div', 'nokta-prefs-plugin-details');
        const fold = () => {
            const open = this.opened.has(plugin.id);
            item.classList.toggle('nokta-prefs-plugin-open', open);
            details.hidden = !open;
            head.setAttribute('aria-expanded', String(open));
        };
        head.addEventListener('click', () => {
            if (!this.opened.delete(plugin.id)) this.opened.add(plugin.id);
            fold();
        });
        const options = plugin.options.map((option) => this.optionRow(plugin.id, option));
        details.append(...options.map((o) => o.element), this.aboutRow(plugin));
        fold();
        item.append(head, details);
        this.shown.set(plugin.id, {
            update: (p) => {
                title.textContent = p.name;
                subtitle.textContent = statusText(p);
                subtitle.classList.toggle('nokta-prefs-warning', p.status === 'error' || p.status === 'broken');
                sw.setAttribute('aria-checked', String(p.enabled));
                item.classList.toggle('nokta-prefs-plugin-off', !p.enabled);
                p.options.forEach((o, i) => options[i]?.show(o.value));
            },
        });
        return item;
    }

    /** An option's row; it shows the core's value unless it is being typed in. */
    private optionRow(id: string, option: PluginOption): { element: HTMLElement; show(value: PluginOption['value']): void } {
        const row = element('div', 'nokta-prefs-row');
        const label = element('div', 'nokta-prefs-label');
        label.append(element('span', 'nokta-prefs-title', option.title));
        if (option.subtitle) label.append(element('span', 'nokta-prefs-subtitle', option.subtitle));
        const control = element('div', 'nokta-prefs-control');
        row.append(label, control);
        let timer = 0;
        const later = (value: string) => {
            window.clearTimeout(timer);
            timer = window.setTimeout(() => this.send('SetOption', id, option.key, value), SEND_DELAY_MS);
        };
        switch (option.type) {
            case 'bool': {
                const sw = element('button', 'nokta-prefs-switch');
                sw.type = 'button';
                sw.setAttribute('role', 'switch');
                sw.setAttribute('aria-label', option.title);
                sw.append(element('span', 'nokta-prefs-knob'));
                sw.addEventListener('click', () => {
                    const on = sw.getAttribute('aria-checked') !== 'true';
                    sw.setAttribute('aria-checked', String(on));
                    this.send('SetOption', id, option.key, String(on));
                });
                control.append(sw);
                return { element: row, show: (value) => sw.setAttribute('aria-checked', String(value === true)) };
            }
            case 'choice': {
                const select = element('select', 'nokta-prefs-select');
                for (const choice of option.choices) select.append(element('option', '', choice));
                select.addEventListener('change', () => this.send('SetOption', id, option.key, select.value));
                control.append(select);
                return { element: row, show: (value) => (select.value = String(value)) };
            }
            case 'int': {
                const input = element('input', 'nokta-prefs-number');
                input.type = 'number';
                input.min = String(option.min);
                input.max = String(option.max);
                input.step = '1';
                input.addEventListener('input', () => {
                    if (input.validity.valid && input.value !== '') later(optionText(Number(input.value)));
                });
                control.append(input);
                return {
                    element: row,
                    show: (value) => {
                        if (document.activeElement !== input) input.value = optionText(value);
                    },
                };
            }
            default: {
                const input = element('input', 'nokta-prefs-text');
                input.type = 'text';
                input.spellcheck = false;
                input.addEventListener('input', () => later(input.value));
                control.append(input);
                return {
                    element: row,
                    show: (value) => {
                        if (document.activeElement !== input) input.value = String(value);
                    },
                };
            }
        }
    }

    /** Its version and author, a link to its page, and Remove. */
    private aboutRow(plugin: Plugin): HTMLElement {
        const row = element('div', 'nokta-prefs-row');
        const label = element('div', 'nokta-prefs-label');
        const about = [plugin.version && `${_('Version')} ${plugin.version}`, plugin.author].filter(Boolean).join(' · ');
        label.append(element('span', 'nokta-prefs-title', _('About')));
        label.append(element('span', 'nokta-prefs-subtitle', about || plugin.id));
        const control = element('div', 'nokta-prefs-control');
        if (/^https?:\/\//.test(plugin.homepage)) {
            control.append(button(_('Website'), () => this.host.openUri(plugin.homepage)));
        }
        control.append(button(_('Remove'), () => this.confirmRemove(plugin), ' nokta-prefs-destructive'));
        row.append(label, control);
        return row;
    }

    private confirmRemove(plugin: Plugin): void {
        const dialog = element('div', 'nokta-prefs-dialog');
        dialog.setAttribute('role', 'alertdialog');
        dialog.append(
            element('h2', 'nokta-prefs-dialog-title', _('Remove this plugin?')),
            element('p', 'nokta-prefs-dialog-body', _('Deletes its folder and its settings')),
        );
        const scrim = element('div', 'nokta-prefs-scrim');
        const close = () => scrim.remove();
        const buttons = element('div', 'nokta-prefs-dialog-buttons');
        buttons.append(
            button(_('Cancel'), close),
            button(
                _('Remove'),
                () => {
                    close();
                    this.opened.delete(plugin.id);
                    this.send('Remove', plugin.id);
                },
                ' nokta-prefs-destructive',
            ),
        );
        dialog.append(buttons);
        scrim.append(dialog);
        this.element.append(scrim);
    }
}

/** The plugins to start from. */
const EXAMPLES = 'https://github.com/MasRama/nokta/tree/main/examples/plugins';

/** The core's message for a refused call. */
function message(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
