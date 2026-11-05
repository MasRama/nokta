import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';

import {
    optionText,
    pluginsFrom,
    statusText,
    type Plugin,
    type PluginOption,
} from '../features/plugins/logic/plugins.js';
import { PLUGINS1_XML } from '../generated/contracts.js';
import { BUS_NAME, PATHS } from '../shared/contracts.js';
import { newProxy } from '../shared/dbus.js';
import { noktaIconName } from '../shared/logic/icon-names.js';
import { _ } from '../shared/logic/i18n.js';

/** Where noktad keeps the plugins on Linux. */
const PLUGINS_DIR = GLib.build_filenamev([GLib.get_user_data_dir(), 'nokta', 'plugins']);
const PLUGINS_DOCS = 'https://github.com/MasRama/nokta/tree/main/examples/plugins';

/** io.nokta.Plugins1 for the settings window; `onChanged` runs when the plugins or the daemon change. */
class PluginsService {
    plugins: Plugin[] = [];
    available = false;
    private proxy: Gio.DBusProxy | null = null;
    private readonly ids: number[] = [];
    private readonly cancellable = new Gio.Cancellable();

    constructor(private readonly onChanged: () => void) {
        newProxy(
            PLUGINS1_XML,
            Gio.DBus.session,
            BUS_NAME,
            PATHS.Plugins1,
            (proxy: Gio.DBusProxy | null, error: unknown) => {
                if (error || !proxy) {
                    if (!this.cancellable.is_cancelled()) console.warn('Nokta: no plugins service', error);
                    return;
                }
                this.proxy = proxy;
                this.ids.push(proxy.connect('g-properties-changed', () => this.read()));
                this.ids.push(proxy.connect('notify::g-name-owner', () => this.read()));
                this.read();
            },
            this.cancellable,
            Gio.DBusProxyFlags.NONE,
        );
    }

    setEnabled(id: string, enabled: boolean): Promise<unknown> {
        return this.call('SetEnabled', new GLib.Variant('(sb)', [id, enabled]));
    }

    setOption(id: string, key: string, value: string): Promise<unknown> {
        return this.call('SetOption', new GLib.Variant('(sss)', [id, key, value]));
    }

    install(path: string): Promise<unknown> {
        return this.call('Install', new GLib.Variant('(s)', [path]));
    }

    remove(id: string): Promise<unknown> {
        return this.call('Remove', new GLib.Variant('(s)', [id]));
    }

    destroy(): void {
        this.cancellable.cancel();
        for (const id of this.ids) this.proxy?.disconnect(id);
        this.ids.length = 0;
        this.proxy = null;
    }

    private read(): void {
        const proxy = this.proxy;
        if (!proxy) return;
        const raw = proxy.get_cached_property('Plugins')?.recursiveUnpack();
        this.available = proxy.g_name_owner !== null && raw !== undefined;
        this.plugins = this.available ? pluginsFrom(raw) : [];
        this.onChanged();
    }

    private call(method: string, params: GLib.Variant): Promise<unknown> {
        const proxy = this.proxy;
        if (!proxy) return Promise.reject(new Error(_('Nokta is not running')));
        return new Promise((resolve, reject) => {
            proxy.call(method, params, Gio.DBusCallFlags.NONE, -1, null, (source, result) => {
                try {
                    resolve(source?.call_finish(result));
                } catch (error) {
                    reject(error);
                }
            });
        });
    }
}

export interface InstalledGroup {
    readonly group: Adw.PreferencesGroup;
    destroy(): void;
}

interface Hooks {
    /** The extension's folder, for Nokta's icons. */
    path: string;
    toast(title: string): void;
    errorMessage(error: unknown): string;
    openUri(uri: string): void;
}

/** One installed plugin's row: shown again in place while only its state or values change. */
interface PluginRow {
    widget: Adw.ExpanderRow;
    update(plugin: Plugin): void;
}

/** What makes the rows be built again: a plugin coming or going, or its options changing shape. */
function shape(plugins: readonly Plugin[]): string {
    return JSON.stringify(
        plugins.map((p) => [
            p.id,
            p.name,
            p.icon,
            p.version,
            p.author,
            p.homepage,
            p.runsHere,
            p.status === 'broken',
            p.options.map((o) => [o.key, o.title, o.subtitle, o.type, o.min, o.max, o.choices]),
        ]),
    );
}

/**
 * The plugins added to Nokta, under the built-ins: each with its switch,
 * what it is doing, its options and a Remove button; and buttons to install
 * one from a folder or open the plugins folder.
 */
export function installedGroup(window: Gtk.Window, hooks: Hooks): InstalledGroup {
    const group = new Adw.PreferencesGroup({
        title: _('Added'),
        description: _('Plugins run as you and can read your files: only add ones you trust. A new one starts off.'),
    });
    const buttons = new Gtk.Box({ spacing: 6, valign: Gtk.Align.CENTER });
    const openFolder = new Gtk.Button({
        icon_name: 'folder-open-symbolic',
        tooltip_text: _('Open the plugins folder'),
        css_classes: ['flat'],
    });
    const install = new Gtk.Button({ label: _('Add from Folder…'), css_classes: ['suggested-action'] });
    buttons.append(openFolder);
    buttons.append(install);
    group.header_suffix = buttons;

    let rows: Gtk.Widget[] = [];
    const byId = new Map<string, PluginRow>();
    const expanded = new Set<string>();
    let built = '';

    const service = new PluginsService(() => {
        install.sensitive = service.available;
        const next = shape(service.plugins);
        if (next !== built) {
            built = next;
            for (const row of rows) group.remove(row);
            rows = [];
            byId.clear();
            if (service.plugins.length === 0) rows.push(emptyRow(hooks, service.available));
            for (const plugin of service.plugins) {
                const row = pluginRow(window, plugin, service, hooks);
                row.widget.expanded = expanded.has(plugin.id);
                row.widget.connect('notify::expanded', () => {
                    if (row.widget.expanded) expanded.add(plugin.id);
                    else expanded.delete(plugin.id);
                });
                byId.set(plugin.id, row);
                rows.push(row.widget);
            }
            for (const row of rows) group.add(row);
        }
        for (const plugin of service.plugins) byId.get(plugin.id)?.update(plugin);
    });

    openFolder.connect('clicked', () => {
        GLib.mkdir_with_parents(PLUGINS_DIR, 0o755);
        hooks.openUri(Gio.File.new_for_path(PLUGINS_DIR).get_uri());
    });
    install.connect('clicked', () => {
        const dialog = new Gtk.FileDialog({ title: _('Add a Plugin'), modal: true });
        // The typings lack the callback form, which GJS has.
        const select = dialog.select_folder.bind(dialog) as unknown as (
            parent: Gtk.Window | null,
            cancellable: null,
            callback: (source: Gtk.FileDialog | null, result: Gio.AsyncResult) => void,
        ) => void;
        select(window, null, (_source, result) => {
            const path = chosenFolder(() => dialog.select_folder_finish(result));
            if (!path) return;
            service
                .install(path)
                .then(() => hooks.toast(_('Added. Turn it on when you are ready.')))
                .catch((error) => hooks.toast(hooks.errorMessage(error)));
        });
    });
    return { group, destroy: () => service.destroy() };
}

/** The folder picked, or null when the dialog was cancelled. */
function chosenFolder(finish: () => Gio.File | null): string | null {
    try {
        return finish()?.get_path() ?? null;
    } catch {
        return null;
    }
}

function emptyRow(hooks: Hooks, available: boolean): Adw.ActionRow {
    const row = new Adw.ActionRow({
        title: available ? _('No plugins added yet') : _("Nokta's service is not running"),
        subtitle: _('Add one from a folder, or write your own: see the examples'),
        activatable: true,
    });
    row.add_suffix(new Gtk.Image({ icon_name: 'adw-external-link-symbolic' }));
    row.connect('activated', () => hooks.openUri(PLUGINS_DOCS));
    return row;
}

function pluginIcon(plugin: Plugin, path: string): Gtk.Image {
    const own = noktaIconName(plugin.icon || 'nokta-plugin');
    if (own === null) return new Gtk.Image({ icon_name: plugin.icon });
    const file = Gio.File.new_for_path(GLib.build_filenamev([path, 'icons', `nokta-${own}-symbolic.svg`]));
    return new Gtk.Image({ gicon: Gio.FileIcon.new(file) });
}

function pluginRow(window: Gtk.Window, first: Plugin, service: PluginsService, hooks: Hooks): PluginRow {
    const { id } = first;
    const widget = new Adw.ExpanderRow({ title: first.name, show_enable_switch: true });
    widget.add_prefix(pluginIcon(first, hooks.path));
    const canRun = first.runsHere && first.status !== 'broken';
    let showing = false;
    const quietly = (apply: () => void) => {
        showing = true;
        try {
            apply();
        } finally {
            showing = false;
        }
    };
    widget.connect('notify::enable-expansion', () => {
        if (showing) return;
        service.setEnabled(id, widget.enable_expansion).catch((error) => {
            hooks.toast(hooks.errorMessage(error));
            quietly(() => (widget.enable_expansion = !widget.enable_expansion));
        });
    });

    const options = first.options.map((option) => optionRow(option, (value) => {
        service.setOption(id, option.key, value).catch((error) => hooks.toast(hooks.errorMessage(error)));
    }));
    for (const option of options) widget.add_row(option.widget);

    const about = [first.version && `${_('Version')} ${first.version}`, first.author].filter(Boolean).join(' · ');
    const info = new Adw.ActionRow({ title: _('About'), subtitle: about || id, activatable: first.homepage !== '' });
    if (first.homepage) {
        info.add_suffix(new Gtk.Image({ icon_name: 'adw-external-link-symbolic' }));
        info.connect('activated', () => hooks.openUri(first.homepage));
    }
    widget.add_row(info);

    const remove = new Gtk.Button({ label: _('Remove'), valign: Gtk.Align.CENTER, css_classes: ['destructive-action'] });
    const removeRow = new Adw.ActionRow({
        title: _('Remove this plugin'),
        subtitle: _('Deletes its folder and its settings'),
        activatable_widget: remove,
    });
    removeRow.add_suffix(remove);
    remove.connect('clicked', () => {
        const dialog = new Adw.AlertDialog({
            heading: _('Remove this plugin?'),
            body: first.name,
            default_response: 'cancel',
            close_response: 'cancel',
        });
        dialog.add_response('cancel', _('Cancel'));
        dialog.add_response('remove', _('Remove'));
        dialog.set_response_appearance('remove', Adw.ResponseAppearance.DESTRUCTIVE);
        dialog.connect('response', (_dialog, response) => {
            if (response === 'remove') service.remove(id).catch((error) => hooks.toast(hooks.errorMessage(error)));
        });
        dialog.present(window);
    });
    widget.add_row(removeRow);

    return {
        widget,
        update: (plugin) => {
            widget.subtitle = statusText(plugin);
            // A plugin that cannot run keeps its switch off and still opens for Remove.
            quietly(() => (widget.enable_expansion = canRun ? plugin.enabled : true));
            widget.show_enable_switch = canRun;
            plugin.options.forEach((option, i) => options[i]?.show(option.value));
        },
    };
}

interface OptionRow {
    widget: Gtk.Widget;
    show(value: string | number | boolean): void;
}

/** One option's row; `send` gets the value as SetOption takes it. */
function optionRow(option: PluginOption, send: (value: string) => void): OptionRow {
    let showing = false;
    const quietly = (apply: () => void) => {
        showing = true;
        try {
            apply();
        } finally {
            showing = false;
        }
    };
    const changed = (value: string | number | boolean) => {
        if (!showing) send(optionText(value));
    };
    switch (option.type) {
        case 'bool': {
            const widget = new Adw.SwitchRow({ title: option.title, subtitle: option.subtitle });
            widget.connect('notify::active', () => changed(widget.active));
            return { widget, show: (value) => quietly(() => (widget.active = value === true)) };
        }
        case 'int': {
            const widget = Adw.SpinRow.new_with_range(option.min, option.max, 1);
            Object.assign(widget, { title: option.title, subtitle: option.subtitle });
            // Sent once the value stops changing, so holding a button restarts the plugin once.
            let source = 0;
            widget.connect('notify::value', () => {
                if (showing) return;
                if (source) GLib.source_remove(source);
                source = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 600, () => {
                    source = 0;
                    send(optionText(widget.value));
                    return GLib.SOURCE_REMOVE;
                });
            });
            return { widget, show: (value) => quietly(() => (widget.value = Number(value))) };
        }
        case 'choice': {
            const widget = new Adw.ComboRow({
                title: option.title,
                subtitle: option.subtitle,
                model: Gtk.StringList.new(option.choices),
            });
            widget.connect('notify::selected', () => changed(option.choices[widget.selected] ?? ''));
            const show = (value: string | number | boolean) =>
                quietly(() => (widget.selected = Math.max(0, option.choices.indexOf(String(value)))));
            return { widget, show };
        }
        default: {
            const widget = new Adw.EntryRow({ title: option.title, show_apply_button: true, tooltip_text: option.subtitle });
            // What the user is typing stays until they apply it.
            let typing = false;
            widget.connect('changed', () => {
                if (!showing) typing = true;
            });
            widget.connect('apply', () => {
                typing = false;
                changed(widget.text.trim());
            });
            const show = (value: string | number | boolean) => {
                if (!typing && widget.text !== String(value)) quietly(() => (widget.text = String(value)));
            };
            return { widget, show };
        }
    }
}
