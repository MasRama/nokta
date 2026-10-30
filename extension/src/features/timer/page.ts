import Clutter from 'gi://Clutter';
import St from 'gi://St';

import { withAlpha } from '../../shared/logic/color.js';
import { TIMER_PRESETS } from './logic/clocks.js';
import { iconFor } from '../../shared/icons.js';
import { _, format } from '../../shared/logic/i18n.js';

export interface TimerPageHandlers {
    countdown(minutes: number): void;
    stopwatch(): void;
}

const BUTTON_HEIGHT = 32;
const SPACING = 6;
const COLUMNS = 4;
const IDLE_ALPHA = 0.12;
const HOVER_ALPHA = 0.22;

/**
 * The timer page's body: a button per preset length and one for a
 * stopwatch, four to a row. What they start shows in home and the closed
 * notch.
 */
export class TimerPage {
    readonly actor: St.Widget;
    /** Two rows of buttons. */
    readonly height = 2 * BUTTON_HEIGHT + SPACING;
    private readonly buttons: St.Button[] = [];
    private foreground = '#ffffff';

    constructor(handlers: TimerPageHandlers) {
        const layout = new Clutter.GridLayout({
            column_homogeneous: true,
            row_homogeneous: true,
            column_spacing: SPACING,
            row_spacing: SPACING,
        });
        this.actor = new St.Widget({ style_class: 'nokta-timer-page', layout_manager: layout, x_expand: true });
        TIMER_PRESETS.forEach((minutes, i) => {
            const button = this.button(new St.Label({ text: format(_('%d min'), minutes), x_align: Clutter.ActorAlign.CENTER }), () =>
                handlers.countdown(minutes),
            );
            layout.attach(button, i % COLUMNS, Math.floor(i / COLUMNS), 1, 1);
        });
        const box = new St.BoxLayout({ style_class: 'nokta-timer-stopwatch', x_align: Clutter.ActorAlign.CENTER });
        box.add_child(new St.Icon({ gicon: iconFor('media-playback-start-symbolic'), style_class: 'nokta-button-icon' }));
        box.add_child(new St.Label({ text: _('Stopwatch'), y_align: Clutter.ActorAlign.CENTER }));
        const used = TIMER_PRESETS.length;
        layout.attach(
            this.button(box, () => handlers.stopwatch()),
            used % COLUMNS,
            Math.floor(used / COLUMNS),
            COLUMNS - (used % COLUMNS),
            1,
        );
    }

    setColors({ foreground }: { foreground: string }): void {
        this.foreground = foreground;
        for (const button of this.buttons) this.paint(button);
    }

    destroy(): void {
        this.actor.destroy();
    }

    private button(child: St.Widget, onClick: () => void): St.Button {
        const button = new St.Button({
            style_class: 'nokta-timer-preset',
            child,
            x_expand: true,
            height: BUTTON_HEIGHT,
            can_focus: true,
        });
        button.connect('notify::hover', () => this.paint(button));
        button.connect('clicked', onClick);
        this.buttons.push(button);
        this.paint(button);
        return button;
    }

    private paint(button: St.Button): void {
        const alpha = button.hover ? HOVER_ALPHA : IDLE_ALPHA;
        button.style = `background-color: ${withAlpha(this.foreground, alpha)}; color: ${this.foreground};`;
    }
}
