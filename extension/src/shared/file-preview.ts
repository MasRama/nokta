import Clutter from 'gi://Clutter';
import type Gio from 'gi://Gio';
import Pango from 'gi://Pango';
import St from 'gi://St';

import { TintedButton } from './button.js';
import { setVertical } from './compat.js';
import { SECONDARY } from './dim.js';
import { _ } from './logic/i18n.js';

/** The picture's box; an image keeps its shape inside it. */
const THUMB_WIDTH = 160;
const THUMB_HEIGHT = 90;

/** What fills the picture's box: an image the shell has, a PNG on disk, or an icon. */
export type PreviewPicture =
    | { kind: 'content'; content: Clutter.Content }
    | { kind: 'file'; uri: string }
    | { kind: 'icon'; icon: Gio.Icon };

/** One button: its id, icon and label (marked with `N_`, translated here). */
export interface PreviewButton<Id extends string> {
    id: Id;
    icon: string;
    label: string;
}

/**
 * A file in the notch: its picture, a title, an optional detail line and up
 * to three buttons, two on the first row. A click on the picture presses
 * `openId` while that button shows. `styleClass` names the kind, like
 * `nokta-screenshot`.
 */
export class FilePreview<Id extends string> {
    readonly actor: St.BoxLayout;
    private readonly thumb: St.Widget;
    private readonly icon: St.Icon;
    private readonly title: St.Label;
    private readonly detail: St.Label;
    private readonly buttons = new Map<Id, TintedButton>();
    private readonly thumbClickId: number;
    private canOpen = false;

    constructor(
        styleClass: string,
        buttons: readonly PreviewButton<Id>[],
        private readonly openId: Id,
        onPress: (id: Id) => void,
    ) {
        this.actor = new St.BoxLayout({ style_class: `nokta-file-preview ${styleClass}`, reactive: true });
        this.thumb = new St.Widget({
            style_class: 'nokta-file-preview-thumb',
            reactive: true,
            width: THUMB_WIDTH,
            height: THUMB_HEIGHT,
            y_align: Clutter.ActorAlign.CENTER,
            layout_manager: new Clutter.BinLayout(),
        });
        this.thumb.set_content_gravity(Clutter.ContentGravity.RESIZE_ASPECT);
        this.icon = new St.Icon({
            style_class: 'nokta-file-preview-icon',
            x_expand: true,
            y_expand: true,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this.thumb.add_child(this.icon);
        this.thumbClickId = this.thumb.connect('button-release-event', () => {
            if (this.canOpen) onPress(this.openId);
            return Clutter.EVENT_STOP;
        });
        const side = setVertical(
            new St.BoxLayout({ style_class: 'nokta-file-preview-side', x_expand: true, y_align: Clutter.ActorAlign.CENTER }),
        );
        this.title = new St.Label({ style_class: 'nokta-file-preview-title' });
        this.title.clutter_text.ellipsize = Pango.EllipsizeMode.MIDDLE;
        this.detail = new St.Label({ style_class: 'nokta-file-preview-detail', opacity: SECONDARY });
        const text = setVertical(new St.BoxLayout({ style_class: 'nokta-file-preview-text' }));
        text.add_child(this.title);
        text.add_child(this.detail);
        side.add_child(text);
        const rows = [
            new St.BoxLayout({ style_class: 'nokta-file-preview-buttons' }),
            new St.BoxLayout({ style_class: 'nokta-file-preview-buttons' }),
        ];
        buttons.forEach(({ id, icon, label }, i) => {
            const button = new TintedButton('nokta-file-preview-button', icon, () => onPress(id));
            button.text = _(label); // i18n: runtime
            this.buttons.set(id, button);
            rows[i < 2 ? 0 : 1].add_child(button.actor);
        });
        for (const row of rows) side.add_child(row);
        this.actor.add_child(this.thumb);
        this.actor.add_child(side);
    }

    /** Shows `picture`, `title` and `detail` (none when empty) with the buttons in `shown`. */
    show(picture: PreviewPicture, title: string, detail: string, shown: readonly Id[]): void {
        // The typings omit that content is nullable.
        this.thumb.content = (picture.kind === 'content' ? picture.content : null) as Clutter.Content;
        this.thumb.style =
            picture.kind === 'file'
                ? `background-image: url("${picture.uri}"); background-size: contain; background-position: center;`
                : picture.kind === 'icon'
                  ? 'background-color: rgba(255, 255, 255, 0.08);'
                  : '';
        this.icon.visible = picture.kind === 'icon';
        if (picture.kind === 'icon') this.icon.gicon = picture.icon;
        this.title.text = title;
        this.detail.text = detail;
        this.detail.visible = detail !== '';
        this.setButtons(shown);
    }

    /** Changes the buttons while it shows, once the file is known. */
    setButtons(shown: readonly Id[]): void {
        this.canOpen = shown.includes(this.openId);
        for (const [id, button] of this.buttons) button.actor.visible = shown.includes(id);
    }

    setForeground(color: string): void {
        for (const button of this.buttons.values()) button.setForeground(color);
    }

    destroy(): void {
        this.thumb.disconnect(this.thumbClickId);
        for (const button of this.buttons.values()) button.destroy();
        this.actor.destroy();
    }
}
