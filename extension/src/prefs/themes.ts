import type Cairo from 'cairo';
import Gtk from 'gi://Gtk';

import { themeSwatches, type Appearance } from '../features/settings/index.js';
import type { PictureState, ThemeName } from '../shared/logic/theme.js';
import { gradientEnds, SAMPLE_SONG } from './logic/look.js';
import { fillPicture, linear, notchPath, setColor } from './preview.js';

type PaintContext = Cairo.Context & { $dispose(): void };

const CARD_WIDTH = 92;
const CARD_HEIGHT = 44;

/** The colors the cards are first built with; update() paints them from the settings. */
const DEFAULTS = {
    background: '#000000',
    backgroundOpacity: 1,
    foreground: '#ffffff',
    accent: '#ffffff',
    useAlbumAccent: false,
};

interface Card {
    theme: ThemeName;
    button: Gtk.Button;
    area: Gtk.DrawingArea;
    label: Gtk.Label;
}

/**
 * The themes as small notches hanging from a strip of screen, the chosen one
 * ringed in ember; a click picks that theme. Aurora's swatch is tinted with
 * the preview's sample song.
 */
export class ThemeGallery {
    readonly widget: Gtk.FlowBox;
    private readonly cards: Card[] = [];
    private swatches: ReturnType<typeof themeSwatches> = [];
    private darken = 0;

    constructor(onPick: (theme: ThemeName) => void) {
        this.widget = new Gtk.FlowBox({
            selection_mode: Gtk.SelectionMode.NONE,
            homogeneous: true,
            min_children_per_line: 3,
            max_children_per_line: 7,
            column_spacing: 6,
            row_spacing: 6,
        });
        for (const [i, { theme, label }] of themeSwatches(DEFAULTS, SAMPLE_SONG.cover).entries()) {
            const area = new Gtk.DrawingArea({ content_width: CARD_WIDTH, content_height: CARD_HEIGHT });
            area.set_draw_func((_area, cr) => {
                const paint = cr as PaintContext;
                this.draw(paint, i);
                paint.$dispose();
            });
            const name = new Gtk.Label({ label, css_classes: ['nokta-theme-label'] });
            const box = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 6 });
            box.append(area);
            box.append(name);
            const button = new Gtk.Button({ child: box, css_classes: ['nokta-theme-card'], tooltip_text: label });
            button.connect('clicked', () => onPick(theme));
            this.cards.push({ theme, button, area, label: name });
            this.widget.append(button);
        }
    }

    /** `picture` is the picture theme's image, for its card. */
    update(appearance: Appearance, picture: PictureState | null = null): void {
        this.swatches = themeSwatches(appearance, SAMPLE_SONG.cover, picture);
        this.darken = picture?.darken ?? 0;
        for (const card of this.cards) {
            const chosen = card.theme === appearance.theme;
            if (chosen) card.button.add_css_class('chosen');
            else card.button.remove_css_class('chosen');
            card.label.opacity = chosen ? 1 : 0.6;
            card.area.queue_draw();
        }
    }

    private draw(cr: Cairo.Context, index: number): void {
        const swatch = this.swatches[index];
        if (!swatch) return;
        // A strip of screen with the notch hanging from its top edge.
        cr.setSource(linear(0, 0, 0, CARD_HEIGHT, [
            [0, '#3b2c5c', 1],
            [1, '#0f1a2e', 1],
        ]));
        cr.newPath();
        cr.rectangle(0, 0, CARD_WIDTH, CARD_HEIGHT);
        cr.fill();
        const width = 58;
        const height = 24;
        const x = (CARD_WIDTH - width) / 2;
        notchPath(cr, x, width, height, 9, 5);
        const [x0, y0, x1, y1] = gradientEnds(x, width, height, swatch.direction);
        cr.setSource(linear(x0, y0, x1, y1, [
            [0, swatch.top, 1],
            [1, swatch.bottom, 1],
        ]));
        cr.fillPreserve();
        if (swatch.picture) fillPicture(cr, swatch.picture, this.darken, x, width, height);
        setColor(cr, '#ffffff', 0.14);
        cr.setLineWidth(1);
        cr.stroke();
        // The progress line, in the theme's accent.
        setColor(cr, swatch.accent);
        cr.rectangle(x + 12, height - 4, (width - 24) * SAMPLE_SONG.position, 2);
        cr.fill();
        setColor(cr, swatch.foreground, 0.85);
        cr.arc(CARD_WIDTH / 2, height / 2 - 1, 2.5, 0, 2 * Math.PI);
        cr.fill();
    }
}
