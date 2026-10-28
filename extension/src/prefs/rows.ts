import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';

import { moveItem, orderItems, switchItem, variantType, type Row } from '../features/settings/index.js';
import { parseHexColor, toHexColor } from '../shared/logic/color.js';

/** One row of the window, bound to one key of config.toml. */
export interface SettingRow {
    readonly row: Row;
    readonly widget: Gtk.Widget;
    /** Shows a value from the daemon without sending it back. */
    show(value: unknown): void;
}

/** Decimals that a step needs, so 0.1 steps send 1.3 rather than 1.3000000000000003. */
const decimals = (step: number): number => Math.max(0, Math.ceil(-Math.log10(step)));

/** Builds the widget for `row`; `onChange` gets each value the user picks. */
export function buildRow(row: Row, onChange: (value: GLib.Variant) => void): SettingRow {
    const { title, subtitle = '', kind } = row;
    let showing = false;
    const send = (value: unknown) => {
        if (!showing) onChange(new GLib.Variant(variantType(kind), value));
    };
    const quietly = (apply: () => void) => {
        showing = true;
        try {
            apply();
        } finally {
            showing = false;
        }
    };

    switch (kind.type) {
        case 'bool': {
            const widget = new Adw.SwitchRow({ title, subtitle });
            widget.connect('notify::active', () => send(widget.active));
            return { row, widget, show: (value) => quietly(() => (widget.active = value === true)) };
        }
        case 'int': {
            const widget = Adw.SpinRow.new_with_range(kind.min, kind.max, kind.step);
            Object.assign(widget, { title, subtitle });
            widget.connect('notify::value', () => send(Math.round(widget.value)));
            return { row, widget, show: (value) => quietly(() => (widget.value = Number(value))) };
        }
        case 'float': {
            if (kind.percent) {
                const scale = Gtk.Scale.new_with_range(Gtk.Orientation.HORIZONTAL, kind.min * 100, kind.max * 100, kind.step * 100);
                scale.set_hexpand(true);
                scale.set_size_request(220, -1);
                scale.set_draw_value(true);
                scale.set_value_pos(Gtk.PositionType.LEFT);
                scale.set_digits(0);
                scale.set_format_value_func((_scale, value) => `${Math.round(value)}%`);
                const widget = new Adw.ActionRow({ title, subtitle });
                widget.add_suffix(scale);
                scale.connect('value-changed', () => send(Math.round(scale.get_value()) / 100));
                return { row, widget, show: (value) => quietly(() => scale.set_value(Number(value) * 100)) };
            }
            const digits = decimals(kind.step);
            const widget = Adw.SpinRow.new_with_range(kind.min, kind.max, kind.step);
            Object.assign(widget, { title, subtitle, digits });
            widget.connect('notify::value', () => send(Number(widget.value.toFixed(digits))));
            return { row, widget, show: (value) => quietly(() => (widget.value = Number(value))) };
        }
        case 'color': {
            const button = new Gtk.ColorDialogButton({
                dialog: new Gtk.ColorDialog({ with_alpha: false }),
                valign: Gtk.Align.CENTER,
            });
            const widget = new Adw.ActionRow({ title, subtitle, activatable_widget: button });
            widget.add_suffix(button);
            button.connect('notify::rgba', () => {
                const { red: r, green: g, blue: b } = button.rgba;
                send(toHexColor({ r, g, b }));
            });
            const show = (value: unknown) => {
                const { r, g, b } = parseHexColor(String(value));
                quietly(() => (button.rgba = new Gdk.RGBA({ red: r, green: g, blue: b, alpha: 1 })));
            };
            return { row, widget, show };
        }
        case 'choice': {
            const { options } = kind;
            const widget = new Adw.ComboRow({
                title,
                subtitle,
                model: Gtk.StringList.new(options.map((option) => option.label)),
            });
            widget.connect('notify::selected', () => send(options[widget.selected]?.value ?? options[0].value));
            const show = (value: unknown) => {
                const index = options.findIndex((option) => option.value === value);
                quietly(() => (widget.selected = Math.max(0, index)));
            };
            return { row, widget, show };
        }
        case 'text': {
            // An entry row has no subtitle; the hint goes in its tooltip.
            const widget = new Adw.EntryRow({ title, show_apply_button: true, tooltip_text: subtitle });
            widget.connect('apply', () => send(widget.text.trim()));
            return { row, widget, show: (value) => quietly(() => (widget.text = String(value ?? ''))) };
        }
        case 'order': {
            const widget = new Gtk.ListBox({ selection_mode: Gtk.SelectionMode.NONE, css_classes: ['boxed-list'] });
            let chosen: string[] = [];
            // Each change shows at once; the daemon's copy arrives after the send delay.
            const change = (next: string[]) => {
                chosen = next;
                render();
                send(chosen);
            };
            const render = () => {
                widget.remove_all();
                for (const item of orderItems(chosen, kind.options, kind.max)) {
                    const entry = new Adw.ActionRow({ title: item.label });
                    const button = (icon: string, tooltip: string, sensitive: boolean, by: -1 | 1) => {
                        const b = new Gtk.Button({
                            icon_name: icon,
                            tooltip_text: tooltip,
                            sensitive,
                            valign: Gtk.Align.CENTER,
                            css_classes: ['flat'],
                        });
                        b.connect('clicked', () => change(moveItem(chosen, item.value, by)));
                        entry.add_suffix(b);
                    };
                    button('go-up-symbolic', 'Move up', item.canUp, -1);
                    button('go-down-symbolic', 'Move down', item.canDown, 1);
                    const toggle = new Gtk.Switch({ active: item.on, sensitive: item.canSwitch, valign: Gtk.Align.CENTER });
                    toggle.connect('notify::active', () =>
                        change(switchItem(chosen, item.value, toggle.active, kind.max)),
                    );
                    entry.add_suffix(toggle);
                    entry.activatable_widget = toggle;
                    widget.append(entry);
                }
            };
            const show = (value: unknown) => {
                chosen = Array.isArray(value) ? value.map(String) : [];
                quietly(render);
            };
            return { row, widget, show };
        }
    }
}
