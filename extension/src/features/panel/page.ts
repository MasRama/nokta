import Clutter from 'gi://Clutter';
import Pango from 'gi://Pango';
import St from 'gi://St';

import { setVertical } from '../../shared/compat.js';

/**
 * A page that a home tile opens: a back arrow, its title and its own
 * buttons, then a body the feature draws.
 */
export class SubPage {
    readonly actor: St.BoxLayout;
    private readonly actions: St.BoxLayout;

    constructor(title: string, body: Clutter.Actor, onBack: () => void) {
        this.actor = setVertical(new St.BoxLayout({ style_class: 'nokta-subpage' }));
        const back = new St.Button({
            style_class: 'nokta-button nokta-subpage-back',
            child: new St.Icon({ icon_name: 'go-previous-symbolic', style_class: 'nokta-button-icon' }),
            y_align: Clutter.ActorAlign.CENTER,
            can_focus: true,
        });
        back.connect('clicked', onBack);
        const label = new St.Label({
            style_class: 'nokta-subpage-title',
            text: title,
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        label.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        this.actions = new St.BoxLayout({ style_class: 'nokta-subpage-actions', y_align: Clutter.ActorAlign.CENTER });
        const header = new St.BoxLayout({ style_class: 'nokta-subpage-header' });
        header.add_child(back);
        header.add_child(label);
        header.add_child(this.actions);
        this.actor.add_child(header);
        this.actor.add_child(body);
    }

    /** Puts a button at the header's right end. */
    addAction(actor: Clutter.Actor): void {
        this.actions.add_child(actor);
    }

    destroy(): void {
        this.actor.destroy();
    }
}
