import Clutter from 'gi://Clutter';
import Pango from 'gi://Pango';
import St from 'gi://St';

/** One lyric line that crossfades when the line changes; a click calls `onClick`. */
export class LyricLine {
    readonly actor: St.Button;
    private readonly label: St.Label;
    private text: string | null = null;

    constructor(onClick: () => void) {
        this.label = new St.Label({ style_class: 'nokta-lyric', x_expand: true });
        this.label.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        this.actor = new St.Button({
            style_class: 'nokta-lyric-button',
            child: this.label,
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
            visible: false,
        });
        this.actor.connect('clicked', onClick);
    }

    /** Shows `text`, or hides the row when it is null. */
    show(text: string | null): void {
        if (text === this.text) return;
        const wasVisible = this.text !== null;
        this.text = text;
        if (text === null) {
            this.label.remove_all_transitions();
            this.actor.hide();
            return;
        }
        if (!wasVisible) {
            this.label.remove_all_transitions();
            this.label.text = text;
            this.label.opacity = 255;
            this.actor.show();
            return;
        }
        this.label.ease({
            opacity: 0,
            duration: 120,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onComplete: () => {
                if (this.text === null) return;
                this.label.text = this.text;
                this.label.ease({ opacity: 255, duration: 160, mode: Clutter.AnimationMode.EASE_OUT_QUAD });
            },
        });
    }

    destroy(): void {
        this.actor.destroy();
    }
}
