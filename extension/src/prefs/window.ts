import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';

import { rowValue, SETTINGS_PAGES, type Row } from '../features/settings/index.js';
import { buildRow, type SettingRow } from './rows.js';
import { errorMessage, SettingsService } from './service.js';

/** A change is sent after this long without another one, so a dragged slider sends one value. */
const SEND_DELAY_MS = 250;

const CONFIG_FILE = GLib.build_filenamev([GLib.get_user_config_dir(), 'nokta', 'config.toml']);

interface Pending {
    source: number;
    send: () => void;
}

/** Fills the extension's preferences window with every setting of config.toml. */
export function fillWindow(window: Adw.PreferencesWindow): void {
    const rows: SettingRow[] = [];
    const banners: Adw.PreferencesGroup[] = [];
    const pending = new Map<string, Pending>();
    const nameOf = (row: Row) => `${row.table}.${row.key}`;

    const toast = (title: string) => window.add_toast(new Adw.Toast({ title, use_markup: false, timeout: 5 }));
    const resetRow = resetAllRow(window, () => service.reset(), toast);

    const service = new SettingsService(() => {
        for (const banner of banners) banner.visible = !service.available;
        for (const setting of rows) {
            setting.widget.sensitive = service.available;
            // A row the user is still changing keeps their value.
            if (!pending.has(nameOf(setting.row))) setting.show(rowValue(setting.row, service.tables));
        }
        resetRow.sensitive = service.available;
    });

    const queue = (setting: SettingRow, value: GLib.Variant) => {
        const name = nameOf(setting.row);
        const send = () => {
            pending.delete(name);
            service.set(setting.row.table, setting.row.key, value).catch((error) => {
                toast(errorMessage(error));
                setting.show(rowValue(setting.row, service.tables));
            });
        };
        const old = pending.get(name);
        if (old) GLib.source_remove(old.source);
        const source = GLib.timeout_add(GLib.PRIORITY_DEFAULT, SEND_DELAY_MS, () => {
            send();
            return GLib.SOURCE_REMOVE;
        });
        pending.set(name, { source, send });
    };

    for (const spec of SETTINGS_PAGES) {
        const page = new Adw.PreferencesPage({ name: spec.name, title: spec.title, icon_name: spec.icon });
        // Shown only while the daemon is away; an empty group would still take space.
        const banner = new Adw.PreferencesGroup();
        banner.add(new Adw.Banner({ title: "Nokta's service is not running, so changes can't be saved", revealed: true }));
        banners.push(banner);
        page.add(banner);

        for (const groupSpec of spec.groups) {
            const group = new Adw.PreferencesGroup({ title: groupSpec.title });
            for (const row of groupSpec.rows) {
                const setting: SettingRow = buildRow(row, (value) => queue(setting, value));
                setting.show(rowValue(row, {}));
                setting.widget.sensitive = false;
                rows.push(setting);
                group.add(setting.widget);
            }
            page.add(group);
        }
        if (spec.name === 'behavior') {
            const group = new Adw.PreferencesGroup({ title: 'Config file' });
            group.add(openConfigRow(window, toast));
            group.add(resetRow);
            page.add(group);
        }
        window.add(page);
    }
    resetRow.sensitive = false;

    window.connect('close-request', () => {
        // Changes still waiting are sent now rather than lost.
        for (const { source, send } of [...pending.values()]) {
            GLib.source_remove(source);
            send();
        }
        service.destroy();
        return false;
    });
}

function openConfigRow(window: Gtk.Window, toast: (title: string) => void): Adw.ActionRow {
    const row = new Adw.ActionRow({ title: 'Open config.toml', subtitle: CONFIG_FILE, activatable: true });
    row.add_suffix(new Gtk.Image({ icon_name: 'adw-external-link-symbolic' }));
    row.connect('activated', () => {
        const uri = Gio.File.new_for_path(CONFIG_FILE).get_uri();
        const context = window.get_display().get_app_launch_context();
        Gio.AppInfo.launch_default_for_uri_async(uri, context, null, (_source, result) => {
            try {
                Gio.AppInfo.launch_default_for_uri_finish(result);
            } catch (error) {
                toast(errorMessage(error));
            }
        });
    });
    return row;
}

function resetAllRow(window: Gtk.Widget, reset: () => Promise<void>, toast: (title: string) => void): Adw.ActionRow {
    const button = new Gtk.Button({ label: 'Reset', valign: Gtk.Align.CENTER, css_classes: ['destructive-action'] });
    const row = new Adw.ActionRow({
        title: 'Reset all settings',
        subtitle: 'Replace config.toml with the default one',
        activatable_widget: button,
    });
    row.add_suffix(button);
    button.connect('clicked', () => {
        const dialog = new Adw.AlertDialog({
            heading: 'Reset all settings?',
            body: 'Every setting goes back to its default. config.toml is replaced, including any comments you added.',
            default_response: 'cancel',
            close_response: 'cancel',
        });
        dialog.add_response('cancel', 'Cancel');
        dialog.add_response('reset', 'Reset');
        dialog.set_response_appearance('reset', Adw.ResponseAppearance.DESTRUCTIVE);
        dialog.connect('response', (_dialog, response) => {
            if (response === 'reset') reset().catch((error) => toast(errorMessage(error)));
        });
        dialog.present(window);
    });
    return row;
}
