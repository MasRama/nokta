import Clutter from 'gi://Clutter';
import Pango from 'gi://Pango';
import St from 'gi://St';

import { TintedButton } from '../../shared/button.js';
import { setVertical } from '../../shared/compat.js';
import { SECONDARY } from '../../shared/dim.js';
import { withAlpha } from '../../shared/logic/color.js';
import { _ } from '../../shared/logic/i18n.js';
import { TOUR_STEPS, type TourStep } from './logic/steps.js';

export interface TourPresses {
    next(): void;
    skip(): void;
    openSettings(): void;
}

export interface TourColors {
    foreground: string;
    accent: string;
    onAccent: string;
}

/** The first-run tour in the open notch: a row of dots for the step, its text, Skip and Next. */
export class TourView {
    readonly actor: St.BoxLayout;
    private readonly dots: St.Widget[] = [];
    private readonly title: St.Label;
    private readonly body: St.Label;
    private readonly skip: St.Button;
    private readonly settings: TintedButton;
    private readonly next: St.Button;
    private readonly ids: Array<[St.Button, number]>;
    private colors: TourColors = { foreground: '#ffffff', accent: '#ffffff', onAccent: '#000000' };
    private step = 0;

    constructor(presses: TourPresses) {
        this.actor = setVertical(new St.BoxLayout({ style_class: 'nokta-tour', reactive: true }));
        const dots = new St.BoxLayout({ style_class: 'nokta-tour-dots' });
        for (let i = 0; i < TOUR_STEPS; i++) {
            const dot = new St.Widget({ style_class: 'nokta-tour-dot', y_align: Clutter.ActorAlign.CENTER });
            this.dots.push(dot);
            dots.add_child(dot);
        }
        this.title = new St.Label({ style_class: 'nokta-tour-title' });
        this.body = new St.Label({ style_class: 'nokta-tour-body', y_expand: true });
        // St CSS ignores opacity.
        this.body.opacity = SECONDARY;
        this.body.clutter_text.line_wrap = true;
        this.body.clutter_text.line_wrap_mode = Pango.WrapMode.WORD_CHAR;
        this.body.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;

        const buttons = new St.BoxLayout({ style_class: 'nokta-tour-buttons' });
        this.skip = new St.Button({ style_class: 'nokta-tour-skip', label: _('Skip'), can_focus: true });
        this.settings = new TintedButton('nokta-tour-settings', null, () => presses.openSettings());
        this.settings.text = _('Open settings');
        this.settings.actor.x_expand = true;
        this.settings.actor.x_align = Clutter.ActorAlign.END;
        this.settings.actor.can_focus = true;
        this.next = new St.Button({ style_class: 'nokta-tour-next', can_focus: true });
        buttons.add_child(this.skip);
        // Pushes Next to the right edge when Open settings is hidden.
        buttons.add_child(new St.Widget({ x_expand: true }));
        buttons.add_child(this.settings.actor);
        buttons.add_child(this.next);
        this.ids = [
            [this.skip, this.skip.connect('clicked', () => presses.skip())],
            [this.next, this.next.connect('clicked', () => presses.next())],
        ];

        this.actor.add_child(dots);
        this.actor.add_child(this.title);
        this.actor.add_child(this.body);
        this.actor.add_child(buttons);
    }

    /** Shows step `index`. */
    show(step: TourStep, index: number): void {
        this.step = index;
        this.title.text = step.title;
        this.body.text = step.body;
        this.next.label = step.last ? _('Done') : _('Next');
        this.settings.actor.visible = step.settings;
        this.paintDots();
    }

    /** Next takes the keyboard, so Enter goes on. */
    focusNext(): void {
        this.next.grab_key_focus();
    }

    setColors(colors: TourColors): void {
        this.colors = colors;
        const { foreground, accent, onAccent } = colors;
        this.settings.setForeground(foreground);
        this.next.style = `background-color: ${accent}; color: ${onAccent};`;
        this.skip.style = `color: ${withAlpha(foreground, 0.7)};`;
        this.paintDots();
    }

    destroy(): void {
        for (const [button, id] of this.ids) button.disconnect(id);
        this.settings.destroy();
        this.actor.destroy();
    }

    /** The step's dot is a longer one in the accent. */
    private paintDots(): void {
        const { foreground, accent } = this.colors;
        this.dots.forEach((dot, i) => {
            const now = i === this.step;
            dot.width = now ? 16 : 6;
            dot.style = `background-color: ${now ? accent : withAlpha(foreground, 0.3)};`;
        });
    }
}
