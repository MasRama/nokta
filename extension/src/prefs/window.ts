import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk';

import { appearanceFrom, rowMin, rowValue, SETTINGS_PAGES, type Row } from '../features/settings/index.js';
import { pageIcon, previewModel } from './logic/look.js';
import { BRAND_LOGO, brandCss, PREFS_CLASS, PREFS_CSS } from './logic/style.js';
import { NotchPreview } from './preview.js';
import { buildRow, type SettingRow } from './rows.js';
import { errorMessage, SettingsService } from './service.js';
import { ThemeGallery } from './themes.js';
import { _ } from '../shared/logic/i18n.js';

/** A change is sent after this long without another one, so a dragged slider sends one value. */
const SEND_DELAY_MS = 250;

const CONFIG_FILE = GLib.build_filenamev([GLib.get_user_config_dir(), 'nokta', 'config.toml']);
const INSTALL_URL = 'https://github.com/MasRama/nokta#install';

interface Pending {
    source: number;
    send: () => void;
}

/** Shown until the window is narrower than this; then the sidebar and a page take turns. */
const COLLAPSE_BELOW = 'max-width: 640sp';

/**
 * Fills the extension's preferences window with every setting of config.toml,
 * in a window of Nokta's own: a sidebar with Nokta's pages and icons, and
 * Appearance opening on a live preview and the theme gallery. `path` is the
 * extension's folder, for its icons; `showTour` has the shell show the
 * first-run tour again.
 */
export function fillWindow(window: Adw.PreferencesWindow, path: string, showTour: () => void): void {
    const rows: SettingRow[] = [];
    const banners: Adw.PreferencesGroup[] = [];
    const pending = new Map<string, Pending>();
    /** Appearance values sent but not yet back from the daemon, so the preview shows them at once. */
    const local = new Map<string, unknown>();
    /** Sent and answered: the daemon's next values replace these in `local`. */
    const settled = new Set<string>();
    const nameOf = (row: Pick<Row, 'table' | 'key'>) => `${row.table}.${row.key}`;

    const overlay = new Adw.ToastOverlay();
    const toast = (title: string) => overlay.add_toast(new Adw.Toast({ title, use_markup: false, timeout: 5 }));
    const resetRow = resetAllRow(window, () => service.reset(), toast);
    const unstyle = style(window, path);

    const preview = new NotchPreview();
    const gallery = new ThemeGallery((theme) =>
        queue({ table: 'appearance', key: 'theme' }, new GLib.Variant('s', theme), showLook),
    );
    const showLook = () => {
        const raw = { ...((service.tables.appearance as Record<string, unknown> | undefined) ?? {}) };
        for (const [name, value] of local) if (name.startsWith('appearance.')) raw[name.slice(11)] = value;
        const appearance = appearanceFrom(raw);
        const picture = { ...service.picture, darken: appearance.pictureDarken };
        preview.update(previewModel(appearance, picture));
        gallery.update(appearance, picture);
    };

    const service = new SettingsService(() => {
        for (const name of settled) local.delete(name);
        settled.clear();
        for (const banner of banners) banner.visible = !service.available;
        for (const setting of rows) {
            setting.widget.sensitive = service.available;
            setting.setMin?.(rowMin(setting.row, service.tables));
            // A row the user is still changing keeps their value.
            if (!pending.has(nameOf(setting.row))) setting.show(rowValue(setting.row, service.tables));
        }
        warnUnreadablePicture();
        gallery.widget.sensitive = service.available;
        resetRow.sensitive = service.available;
        showLook();
    });

    /** A picture set but not published by the daemon could not be read: say so on its row. */
    const warnUnreadablePicture = () => {
        const setting = rows.find((r) => r.row.table === 'appearance' && r.row.key === 'picture');
        const chosen = rowValue({ table: 'appearance', key: 'picture', title: '', kind: { type: 'file' } }, service.tables);
        if (setting?.widget instanceof Adw.ActionRow && service.available && chosen && !service.picture.path)
            setting.widget.subtitle = _("Can't read this picture");
    };

    /** Sends `value` once the user stops changing it; `refused` shows the daemon's value again. */
    const queue = (row: Pick<Row, 'table' | 'key'>, value: GLib.Variant, refused: () => void) => {
        const name = nameOf(row);
        local.set(name, value.recursiveUnpack());
        if (row.table === 'appearance') showLook();
        const send = () => {
            pending.delete(name);
            service
                .set(row.table, row.key, value)
                .catch((error) => {
                    toast(errorMessage(error));
                    local.delete(name);
                    refused();
                    showLook();
                })
                .finally(() => {
                    if (!pending.has(name)) settled.add(name);
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

    const stack = new Gtk.Stack({ transition_type: Gtk.StackTransitionType.CROSSFADE });
    for (const spec of SETTINGS_PAGES) {
        const page = new Adw.PreferencesPage({ name: spec.name, title: _(spec.title) }); // i18n: runtime
        // Shown only while the daemon is away; an empty group would still take space.
        const banner = new Adw.PreferencesGroup();
        const notice = new Adw.Banner({
            title: _("Nokta's service is not running, so changes can't be saved"),
            button_label: _('How to Install'),
            revealed: true,
        });
        notice.connect('button-clicked', () => openUri(window, INSTALL_URL, toast));
        banner.add(notice);
        banners.push(banner);
        page.add(banner);

        if (spec.name === 'appearance') page.add(lookGroup(preview, gallery));
        for (const groupSpec of spec.groups) {
            const group = new Adw.PreferencesGroup({
                title: _(groupSpec.title), // i18n: runtime
                description: _(groupSpec.description ?? ''), // i18n: runtime
            });
            for (const row of groupSpec.rows) {
                // The gallery above picks the theme.
                if (row.table === 'appearance' && row.key === 'theme') continue;
                const setting: SettingRow = buildRow(row, (value) =>
                    queue(row, value, () => setting.show(rowValue(row, service.tables))),
                );
                setting.show(rowValue(row, {}));
                setting.widget.sensitive = false;
                rows.push(setting);
                group.add(setting.widget);
            }
            page.add(group);
        }
        if (spec.name === 'behavior') {
            const tour = new Adw.PreferencesGroup({ title: _('Getting started') });
            tour.add(tourRow(showTour, toast));
            page.add(tour);
            const group = new Adw.PreferencesGroup({ title: _('Config file') });
            group.add(openConfigRow(window, toast));
            group.add(resetRow);
            page.add(group);
        }
        stack.add_named(page, spec.name);
    }
    resetRow.sensitive = false;
    gallery.widget.sensitive = false;
    showLook();

    const content = new Adw.NavigationPage({ title: _(SETTINGS_PAGES[0].title), child: toolbar(stack) }); // i18n: runtime
    const split = new Adw.NavigationSplitView({
        sidebar: new Adw.NavigationPage({ title: 'Nokta', child: toolbar(sidebar(stack, content, path), brand()) }),
        content,
        min_sidebar_width: 200,
        max_sidebar_width: 240,
    });
    overlay.child = split;
    const narrow = new Adw.Breakpoint({ condition: Adw.BreakpointCondition.parse(COLLAPSE_BELOW) });
    const collapsed = new GObject.Value();
    collapsed.init(GObject.TYPE_BOOLEAN);
    collapsed.set_boolean(true);
    narrow.add_setter(split, 'collapsed', collapsed);
    window.add_breakpoint(narrow);
    window.set_default_size(920, 700);
    // Breakpoints need a smallest size to measure against.
    window.set_size_request(360, 420);
    // GNOME's dialog checks that the extension gave it a page; the window shows ours instead.
    window.add(new Adw.PreferencesPage());
    window.set_content(overlay);

    window.connect('close-request', () => {
        // Changes still waiting are sent now rather than lost.
        for (const { source, send } of [...pending.values()]) {
            GLib.source_remove(source);
            send();
        }
        service.destroy();
        unstyle();
        return false;
    });
}

/** Adds the window's stylesheet, with the logo from the extension's `path`; returns what takes it away again. */
function style(window: Gtk.Window, path: string): () => void {
    const display = window.get_display();
    const provider = new Gtk.CssProvider();
    const logo = GLib.filename_to_uri(GLib.build_filenamev([path, 'icons', BRAND_LOGO]), null);
    provider.load_from_string(PREFS_CSS + brandCss(logo));
    // Above the user's own gtk.css too: the window is dark whatever theme the system has.
    Gtk.StyleContext.add_provider_for_display(display, provider, Gtk.STYLE_PROVIDER_PRIORITY_USER + 1);
    window.add_css_class(PREFS_CLASS);
    return () => Gtk.StyleContext.remove_provider_for_display(display, provider);
}

/** A page with a header bar over `child`; `title` replaces the header's title. */
function toolbar(child: Gtk.Widget, title?: Gtk.Widget): Adw.ToolbarView {
    const view = new Adw.ToolbarView({ content: child });
    const header = new Adw.HeaderBar();
    if (title) header.title_widget = title;
    view.add_top_bar(header);
    return view;
}

/** Nokta's wordmark at the top of the sidebar, drawn by `brandCss`. */
function brand(): Gtk.Box {
    const box = new Gtk.Box({ halign: Gtk.Align.START, hexpand: true, margin_start: 10 });
    const logo = new Gtk.Box({
        css_classes: ['nokta-brand'],
        valign: Gtk.Align.CENTER,
        accessible_role: Gtk.AccessibleRole.IMG,
    });
    logo.update_property([Gtk.AccessibleProperty.LABEL], ['Nokta']);
    box.append(logo);
    return box;
}

/** The pages with Nokta's icons from the extension's `path`; picking one shows it in `content`. */
function sidebar(stack: Gtk.Stack, content: Adw.NavigationPage, path: string): Gtk.Widget {
    const list = new Gtk.ListBox({ css_classes: ['navigation-sidebar'] });
    for (const spec of SETTINGS_PAGES) {
        const box = new Gtk.Box({ spacing: 12 });
        const icon = pageIcon(spec.name);
        // Found by name in a search path GTK would not recolor them; as files it does.
        const file = Gio.File.new_for_path(GLib.build_filenamev([path, 'icons', `nokta-${icon}-symbolic.svg`]));
        box.append(icon ? new Gtk.Image({ gicon: Gio.FileIcon.new(file) }) : new Gtk.Image({ icon_name: spec.icon }));
        box.append(new Gtk.Label({ label: _(spec.title), xalign: 0, hexpand: true })); // i18n: runtime
        list.append(new Gtk.ListBoxRow({ child: box }));
    }
    list.connect('row-selected', (_list, row) => {
        if (!row) return;
        const spec = SETTINGS_PAGES[row.get_index()];
        stack.visible_child_name = spec.name;
        content.title = _(spec.title); // i18n: runtime
    });
    // When collapsed, a click on the page already picked opens it again.
    list.connect('row-activated', () => {
        const split = content.get_ancestor(Adw.NavigationSplitView.$gtype) as Adw.NavigationSplitView | null;
        if (split) split.show_content = true;
    });
    list.select_row(list.get_row_at_index(0));
    return new Gtk.ScrolledWindow({ child: list, hscrollbar_policy: Gtk.PolicyType.NEVER, vexpand: true });
}

/** The live preview over the theme gallery, first on Appearance; the Theme group follows it. */
function lookGroup(preview: NotchPreview, gallery: ThemeGallery): Adw.PreferencesGroup {
    const group = new Adw.PreferencesGroup();
    const box = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 14 });
    box.append(preview.widget);
    box.append(gallery.widget);
    group.add(box);
    return group;
}

function openConfigRow(window: Gtk.Window, toast: (title: string) => void): Adw.ActionRow {
    const row = new Adw.ActionRow({ title: _('Open config.toml'), subtitle: CONFIG_FILE, activatable: true });
    row.add_suffix(new Gtk.Image({ icon_name: 'adw-external-link-symbolic' }));
    row.connect('activated', () => openUri(window, Gio.File.new_for_path(CONFIG_FILE).get_uri(), toast));
    return row;
}

/** Opens `uri` in the default app; a failure shows as a toast. */
function openUri(window: Gtk.Widget, uri: string, toast: (title: string) => void): void {
    const context = window.get_display().get_app_launch_context();
    Gio.AppInfo.launch_default_for_uri_async(uri, context, null, (_source, result) => {
        try {
            Gio.AppInfo.launch_default_for_uri_finish(result);
        } catch (error) {
            toast(errorMessage(error));
        }
    });
}

/** Works without noktad: the tour is the shell's own. */
function tourRow(showTour: () => void, toast: (title: string) => void): Adw.ActionRow {
    const button = new Gtk.Button({ label: _('Show'), valign: Gtk.Align.CENTER });
    const row = new Adw.ActionRow({
        title: _('Show the tour again'),
        subtitle: _('The notch walks you through Nokta once more'),
        activatable_widget: button,
    });
    row.add_suffix(button);
    button.connect('clicked', () => {
        showTour();
        toast(_('The tour shows in the notch'));
    });
    return row;
}

function resetAllRow(window: Gtk.Widget, reset: () => Promise<void>, toast: (title: string) => void): Adw.ActionRow {
    const button = new Gtk.Button({ label: _('Reset'), valign: Gtk.Align.CENTER, css_classes: ['destructive-action'] });
    const row = new Adw.ActionRow({
        title: _('Reset all settings'),
        subtitle: _('Replace config.toml with the default one'),
        activatable_widget: button,
    });
    row.add_suffix(button);
    button.connect('clicked', () => {
        const dialog = new Adw.AlertDialog({
            heading: _('Reset all settings?'),
            body: _('Every setting goes back to its default. config.toml is replaced, including any comments you added.'),
            default_response: 'cancel',
            close_response: 'cancel',
        });
        dialog.add_response('cancel', _('Cancel'));
        dialog.add_response('reset', _('Reset'));
        dialog.set_response_appearance('reset', Adw.ResponseAppearance.DESTRUCTIVE);
        dialog.connect('response', (_dialog, response) => {
            if (response === 'reset') reset().catch((error) => toast(errorMessage(error)));
        });
        dialog.present(window);
    });
    return row;
}
