import Clutter from 'gi://Clutter';
import Pango from 'gi://Pango';
import St from 'gi://St';

/** One lyric line that crossfades when the line changes. */
export class LyricLine {
    readonly actor: St.Label;
    private text: string | null = null;

    constructor() {
        this.actor = new St.Label({
            style_class: 'nokta-lyric',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
            visible: false,
        });
        this.actor.clutter_text.ellipsize = Pango.EllipsizeMode.END;
    }

    /** Shows `text`, or hides the row when it is null. */
    show(text: string | null): void {
        if (text === this.text) return;
        const wasVisible = this.text !== null;
        this.text = text;
        if (text === null) {
            this.actor.remove_all_transitions();
            this.actor.hide();
            return;
        }
        if (!wasVisible) {
            this.actor.remove_all_transitions();
            this.actor.text = text;
            this.actor.opacity = 255;
            this.actor.show();
            return;
        }
        this.actor.ease({
            opacity: 0,
            duration: 120,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onComplete: () => {
                if (this.text === null) return;
                this.actor.text = this.text;
                this.actor.ease({ opacity: 255, duration: 160, mode: Clutter.AnimationMode.EASE_OUT_QUAD });
            },
        });
    }

    destroy(): void {
        this.actor.destroy();
    }
}
