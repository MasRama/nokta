import { moveItem, orderItems, switchItem } from '@ext/features/settings/logic/order.js';
import { _ } from '@ext/shared/logic/i18n.js';

import { icon } from '../icons.js';
import { feedLabel, isFeed, type PrefRow } from './logic.js';

/** What `Settings1.Set` takes. */
export type SettingValue = boolean | number | string | string[];

/** One row of the window, bound to one key of config.toml. */
export interface SettingRow {
    readonly row: PrefRow;
    readonly element: HTMLElement;
    /** Shows a value from the core without sending it back. */
    show(value: unknown): void;
    /** Moves a number row's lowest value, for a floor that follows another key. */
    setMin?(min: number): void;
}

export interface RowHost {
    /** Asks for a picture in Windows' file dialog; null when cancelled. */
    pickPicture(): Promise<string | null>;
}

/** Decimals that a step needs, so 0.1 steps send 1.3 rather than 1.3000000000000003. */
const decimals = (step: number): number => Math.max(0, Math.ceil(-Math.log10(step)));

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
    const el = document.createElement(tag);
    el.className = className;
    if (text !== undefined) el.textContent = text;
    return el;
}

/** A switch: a button that is on or off. */
function toggle(onToggle: (on: boolean) => void): { element: HTMLButtonElement; set(on: boolean, enabled?: boolean): void } {
    const button = element('button', 'nokta-prefs-switch');
    button.type = 'button';
    button.setAttribute('role', 'switch');
    button.append(element('span', 'nokta-prefs-knob'));
    button.addEventListener('click', () => onToggle(button.getAttribute('aria-checked') !== 'true'));
    return {
        element: button,
        set(on, enabled = true) {
            button.setAttribute('aria-checked', String(on));
            button.disabled = !enabled;
        },
    };
}

/** A flat button with an icon, for moving and removing. */
function iconButton(name: string, label: string, onClick: () => void): HTMLButtonElement {
    const button = element('button', 'nokta-prefs-icon-button');
    button.type = 'button';
    button.title = label;
    button.setAttribute('aria-label', label);
    button.append(icon(name, 16));
    button.addEventListener('click', onClick);
    return button;
}

/** Builds the element for `row`; `onChange` gets each value the user picks. */
export function buildRow(row: PrefRow, onChange: (value: SettingValue) => void, host: RowHost): SettingRow {
    const { kind } = row;
    const el = element('div', 'nokta-prefs-row');
    const label = element('div', 'nokta-prefs-label');
    label.append(element('span', 'nokta-prefs-title', _(row.title))); // i18n: runtime
    const subtitle = element('span', 'nokta-prefs-subtitle', _(row.subtitle ?? '')); // i18n: runtime
    subtitle.hidden = !row.subtitle;
    label.append(subtitle);
    const control = element('div', 'nokta-prefs-control');
    el.append(label, control);

    switch (kind.type) {
        case 'bool': {
            const sw = toggle((on) => {
                sw.set(on);
                onChange(on);
            });
            control.append(sw.element);
            label.addEventListener('click', () => sw.element.click());
            el.classList.add('nokta-prefs-clickable');
            return { row, element: el, show: (value) => sw.set(value === true) };
        }
        case 'int':
        case 'float': {
            if (kind.type === 'float' && kind.percent) {
                const range = element('input', 'nokta-prefs-range');
                range.type = 'range';
                range.min = String(kind.min * 100);
                range.max = String(kind.max * 100);
                range.step = String(kind.step * 100);
                const output = element('output', 'nokta-prefs-value');
                const showPercent = () => (output.textContent = `${Math.round(Number(range.value))}%`);
                range.addEventListener('input', () => {
                    showPercent();
                    onChange(Math.round(Number(range.value)) / 100);
                });
                control.append(output, range);
                return {
                    row,
                    element: el,
                    show: (value) => {
                        range.value = String(Number(value) * 100);
                        showPercent();
                    },
                };
            }
            const input = element('input', 'nokta-prefs-number');
            input.type = 'number';
            input.min = String(kind.min);
            input.max = String(kind.max);
            input.step = String(kind.step);
            const digits = kind.type === 'float' ? decimals(kind.step) : 0;
            let shown = 0;
            input.addEventListener('change', () => {
                const typed = Number(input.value);
                if (input.value.trim() === '' || !Number.isFinite(typed)) {
                    input.value = String(shown);
                    return;
                }
                const value = Math.min(Number(input.max), Math.max(Number(input.min), typed));
                const sent = Number(value.toFixed(digits));
                input.value = String(sent);
                onChange(sent);
            });
            control.append(input);
            return {
                row,
                element: el,
                show: (value) => {
                    shown = Number(value);
                    input.value = String(shown);
                },
                setMin: (min) => (input.min = String(min)),
            };
        }
        case 'color': {
            const input = element('input', 'nokta-prefs-color');
            input.type = 'color';
            input.addEventListener('input', () => onChange(input.value.toLowerCase()));
            control.append(input);
            return { row, element: el, show: (value) => (input.value = String(value ?? '#000000')) };
        }
        case 'choice': {
            const select = element('select', 'nokta-prefs-select');
            for (const option of kind.options) {
                const item = element('option', '', _(option.label)); // i18n: runtime
                item.value = option.value;
                select.append(item);
            }
            select.addEventListener('change', () => onChange(select.value));
            control.append(select);
            return {
                row,
                element: el,
                show: (value) => {
                    const known = kind.options.some((option) => option.value === value);
                    select.value = known ? String(value) : kind.options[0].value;
                },
            };
        }
        case 'text': {
            const input = element('input', 'nokta-prefs-text');
            input.type = 'text';
            input.spellcheck = false;
            input.addEventListener('change', () => onChange(input.value.trim()));
            input.addEventListener('keydown', (event) => {
                if (event.key === 'Enter') input.blur();
            });
            control.append(input);
            return { row, element: el, show: (value) => (input.value = String(value ?? '')) };
        }
        case 'file': {
            const name = element('span', 'nokta-prefs-file');
            const choose = element('button', 'nokta-prefs-button', _('Choose…'));
            choose.type = 'button';
            choose.addEventListener('click', () => {
                void host.pickPicture().then((path) => {
                    if (path) onChange(path);
                });
            });
            const remove = iconButton('clear', _('Remove'), () => onChange(''));
            control.append(name, choose, remove);
            return {
                row,
                element: el,
                show: (value) => {
                    const path = String(value ?? '');
                    name.textContent = path.split(/[\\/]/).pop() ?? '';
                    name.title = path;
                    remove.disabled = path === '';
                },
            };
        }
        case 'order': {
            // Its group says what it is, as in the extension's window.
            el.classList.add('nokta-prefs-list');
            label.hidden = true;
            const list = element('div', 'nokta-prefs-items');
            el.append(list);
            let chosen: string[] = [];
            // Each change shows at once; the core's copy arrives after the send delay.
            const change = (next: string[]) => {
                chosen = next;
                render();
                onChange(chosen);
            };
            const render = () => {
                list.replaceChildren();
                for (const item of orderItems(chosen, kind.options, kind.max)) {
                    const entry = element('div', 'nokta-prefs-item');
                    entry.append(element('span', 'nokta-prefs-item-title', _(item.label))); // i18n: runtime
                    const up = iconButton('chevron-up', _('Move up'), () => change(moveItem(chosen, item.value, -1)));
                    const down = iconButton('chevron-down', _('Move down'), () => change(moveItem(chosen, item.value, 1)));
                    up.disabled = !item.canUp;
                    down.disabled = !item.canDown;
                    const sw = toggle((on) => change(switchItem(chosen, item.value, on, kind.max)));
                    sw.set(item.on, item.canSwitch);
                    entry.append(up, down, sw.element);
                    list.append(entry);
                }
            };
            return {
                row,
                element: el,
                show: (value) => {
                    chosen = Array.isArray(value) ? value.map(String) : [];
                    render();
                },
            };
        }
        case 'feeds': {
            el.classList.add('nokta-prefs-list');
            const list = element('div', 'nokta-prefs-items');
            const input = element('input', 'nokta-prefs-text nokta-prefs-feed-input');
            input.type = 'text';
            input.spellcheck = false;
            input.placeholder = 'https://…/basic.ics';
            const add = element('button', 'nokta-prefs-button', _('Add'));
            add.type = 'button';
            const adder = element('div', 'nokta-prefs-item nokta-prefs-feed-add');
            adder.append(input, add);
            el.append(list, adder);
            let feeds: string[] = [];
            const update = () => {
                const full = feeds.length >= kind.max;
                input.disabled = full;
                add.disabled = full || !isFeed(input.value);
            };
            const change = (next: string[]) => {
                feeds = next;
                render();
                onChange(feeds);
            };
            const submit = () => {
                const feed = input.value.trim();
                if (!isFeed(feed) || feeds.length >= kind.max) return;
                input.value = '';
                if (!feeds.includes(feed)) change([...feeds, feed]);
                update();
            };
            input.addEventListener('input', update);
            input.addEventListener('keydown', (event) => {
                if (event.key === 'Enter') submit();
            });
            add.addEventListener('click', submit);
            const render = () => {
                list.replaceChildren();
                feeds.forEach((feed, i) => {
                    const entry = element('div', 'nokta-prefs-item');
                    entry.append(icon('calendar', 16), element('span', 'nokta-prefs-item-title', feedLabel(feed)));
                    entry.append(iconButton('close', _('Remove'), () => change(feeds.filter((_f, j) => j !== i))));
                    list.append(entry);
                });
                list.hidden = feeds.length === 0;
                update();
            };
            return {
                row,
                element: el,
                show: (value) => {
                    feeds = Array.isArray(value) ? value.map(String) : [];
                    render();
                },
            };
        }
    }
}
