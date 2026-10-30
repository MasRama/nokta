import Clutter from 'gi://Clutter';
import Pango from 'gi://Pango';
import St from 'gi://St';

import { TintedButton } from '../../shared/button.js';
import { setVertical } from '../../shared/compat.js';
import type { ScreenshotButton } from './logic/screenshot.js';
import { iconFor } from '../../shared/icons.js';
import { _, N_ } from '../../shared/logic/i18n.js';

/** The thumbnail's box; the image keeps its shape inside it. */
const THUMB_WIDTH = 160;
const THUMB_HEIGHT = 90;

const BUTTONS: Record<ScreenshotButton, { icon: string; label: string }> = {
    open: { icon: 'document-open-symbolic', label: N_('Open') },
    files: { icon: 'folder-open-symbolic', label: N_('Show in Files') },
    keep: { icon: 'folder-documents-symbolic', label: N_('Keep on shelf') },
};

/**
 * A new screenshot in the notch: the image, the title and a button for
 * each thing it can do. A click on the image opens it, like Open.
 */
export class ScreenshotView {
    readonly actor: St.BoxLayout;
    private readonly thumb: St.Widget;
    /** In the thumbnail's place for a screen recording, which has no picture. */
    private readonly video: St.Icon;
    private readonly title: St.Label;
    private readonly buttons: Record<ScreenshotButton, TintedButton>;
    private readonly thumbClickId: number;
    private canOpen = false;

    constructor(onPress: (button: ScreenshotButton) => void) {
        this.actor = new St.BoxLayout({ style_class: 'nokta-screenshot', reactive: true });
        this.thumb = new St.Widget({
            style_class: 'nokta-screenshot-thumb',
            reactive: true,
            width: THUMB_WIDTH,
            height: THUMB_HEIGHT,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this.thumb.set_content_gravity(Clutter.ContentGravity.RESIZE_ASPECT);
        this.video = new St.Icon({
            gicon: iconFor('video-x-generic-symbolic'),
            style_class: 'nokta-screenshot-video',
            x_expand: true,
            y_expand: true,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this.thumb.layout_manager = new Clutter.BinLayout();
        this.thumb.add_child(this.video);
        this.thumbClickId = this.thumb.connect('button-release-event', () => {
            if (this.canOpen) onPress('open');
            return Clutter.EVENT_STOP;
        });
        const side = setVertical(
            new St.BoxLayout({ style_class: 'nokta-screenshot-side', x_expand: true, y_align: Clutter.ActorAlign.CENTER }),
        );
        this.title = new St.Label({ style_class: 'nokta-screenshot-title' });
        this.title.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        side.add_child(this.title);
        const top = new St.BoxLayout({ style_class: 'nokta-screenshot-buttons' });
        const bottom = new St.BoxLayout({ style_class: 'nokta-screenshot-buttons' });
        const make = (button: ScreenshotButton) => {
            const { icon, label } = BUTTONS[button];
            const made = new TintedButton('nokta-screenshot-button', icon, () => onPress(button));
            made.text = _(label); // i18n: runtime
            return made;
        };
        this.buttons = { open: make('open'), files: make('files'), keep: make('keep') };
        top.add_child(this.buttons.open.actor);
        top.add_child(this.buttons.files.actor);
        bottom.add_child(this.buttons.keep.actor);
        side.add_child(top);
        side.add_child(bottom);
        this.actor.add_child(this.thumb);
        this.actor.add_child(side);
    }

    /**
     * `image` is GNOME's own picture of the screenshot, from its
     * notification; a screen recording has none and shows a video icon.
     */
    show(image: Clutter.Content | null, title: string, buttons: readonly ScreenshotButton[]): void {
        // The typings omit that content is nullable.
        this.thumb.content = image as Clutter.Content;
        this.video.visible = image === null;
        this.thumb.style = image === null ? 'background-color: rgba(255, 255, 255, 0.08);' : '';
        this.title.text = title;
        this.setButtons(buttons);
    }

    /** Changes the buttons while it shows, once the file is known. */
    setButtons(buttons: readonly ScreenshotButton[]): void {
        this.canOpen = buttons.includes('open');
        for (const [name, button] of Object.entries(this.buttons))
            button.actor.visible = buttons.includes(name as ScreenshotButton);
    }

    setForeground(color: string): void {
        for (const button of Object.values(this.buttons)) button.setForeground(color);
    }

    destroy(): void {
        this.thumb.disconnect(this.thumbClickId);
        for (const button of Object.values(this.buttons)) button.destroy();
        this.actor.destroy();
    }
}
