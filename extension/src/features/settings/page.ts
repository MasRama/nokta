import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import St from 'gi://St';

import { setVertical } from '../../shared/compat.js';
import { SECONDARY } from '../../shared/dim.js';
import { iconFor } from '../../shared/icons.js';
import { withAlpha } from '../../shared/logic/color.js';
import { THEMES, themeFor, themeKeyFor, type PictureState } from '../../shared/logic/theme.js';
import type { Appearance } from './logic/parse.js';
import { MOTION_PRESETS, motionPreset, themeSwatches } from './logic/quick.js';

/**
 * The body's height: the themes row (50), three switches, motion and "All
 * settings" (30 each), with 8 between them, as the stylesheet sets them.
 */
export const SETTINGS_PAGE_HEIGHT = 50 + 5 * 30 + 5 * 8;

export interface SettingsPageHandlers {
    /** One `[appearance]` key, through io.nokta.Settings1.Set. */
    set(key: string, value: GLib.Variant): void;
    /** The settings window, for everything else. */
    openWindow(): void;
}

export interface SettingsPageColors {
    foreground: string;
    accent: string;
    onAccent: string;
}

/** The `[appearance]` switches the page shows, with their labels. */
const SWITCHES: Array<[key: string, label: string, read: (a: Appearance) => boolean]> = [
    ['use_album_accent', "Cover's color", (a) => a.useAlbumAccent],
    ['progress_line', 'Progress line', (a) => a.progressLine],
    ['alert_glow', 'Alert glow', (a) => a.alertGlow],
];

/** A switch drawn like GNOME's: a pill and a knob that sits right while on. */
class Switch {
    readonly actor: St.Widget;
    private readonly knob: St.Widget;

    constructor() {
        this.knob = new St.Widget({ style_class: 'nokta-settings-knob', x_expand: true, y_expand: true });
        this.actor = new St.Widget({
            style_class: 'nokta-settings-switch',
            layout_manager: new Clutter.BinLayout(),
            y_align: Clutter.ActorAlign.CENTER,
        });
        this.actor.add_child(this.knob);
    }

    paint(on: boolean, colors: SettingsPageColors): void {
        this.knob.x_align = on ? Clutter.ActorAlign.END : Clutter.ActorAlign.START;
        this.knob.y_align = Clutter.ActorAlign.CENTER;
        this.actor.style = `background-color: ${on ? colors.accent : withAlpha(colors.foreground, 0.2)};`;
        this.knob.style = `background-color: ${on ? colors.onAccent : colors.foreground};`;
    }
}

/**
 * The Settings tile's page: the themes as small notches (the chosen one
 * ringed), switches for the cover's color, the progress line and the alert
 * glow, how fast the notch moves, and a row that opens the settings window.
 * A click shows its new value at once; the daemon's answer settles it.
 */
export class SettingsPage {
    readonly actor: St.BoxLayout;
    readonly height = SETTINGS_PAGE_HEIGHT;
    private readonly themeRow: St.BoxLayout;
    private readonly switches: Array<{ key: string; read: (a: Appearance) => boolean; view: Switch }> = [];
    private readonly motion: St.Button[] = [];
    private readonly swatches: Array<{ notch: St.Widget; dot: St.Widget; ring: St.Bin; label: St.Label }> = [];
    private appearance: Appearance | null = null;
    private cover: string | null = null;
    private dark = true;
    private picture: PictureState | null = null;
    private colors: SettingsPageColors = { foreground: '#ffffff', accent: '#ffffff', onAccent: '#000000' };

    constructor(private readonly handlers: SettingsPageHandlers) {
        this.actor = setVertical(new St.BoxLayout({ style_class: 'nokta-settings', x_expand: true }));
        this.themeRow = new St.BoxLayout({ style_class: 'nokta-settings-themes', x_expand: true });
        this.buildThemes();
        this.actor.add_child(this.themeRow);

        for (const [key, label, read] of SWITCHES) {
            const view = new Switch();
            const row = this.row(label, view.actor);
            row.connect('clicked', () => {
                const a = this.appearance;
                if (!a) return;
                const on = !read(a);
                this.apply(key, new GLib.Variant('b', on), { [this.field(key)]: on });
            });
            this.switches.push({ key, read, view });
            this.actor.add_child(row);
        }

        const presets = new St.BoxLayout({ style_class: 'nokta-settings-motion', y_align: Clutter.ActorAlign.CENTER });
        for (const { label, speed } of MOTION_PRESETS) {
            const button = new St.Button({
                style_class: 'nokta-settings-motion-button',
                label,
                can_focus: true,
            });
            button.connect('clicked', () =>
                this.apply('animation_speed', new GLib.Variant('d', speed), { animationSpeed: speed }),
            );
            this.motion.push(button);
            presets.add_child(button);
        }
        this.actor.add_child(this.line('Motion', presets));

        const chevron = new St.Icon({ gicon: iconFor('pan-end-symbolic'), style_class: 'nokta-settings-chevron' });
        chevron.opacity = SECONDARY;
        const all = this.row('All settings', chevron);
        all.add_style_class_name('nokta-settings-all');
        all.connect('clicked', () => handlers.openWindow());
        this.actor.add_child(all);
    }

    /**
     * The settings as they are now; `cover` is the playing cover's color, for
     * aurora's swatch, and `picture` the picture theme's image. `dark` is the
     * system's style: following it, the swatches pick the theme for that style.
     */
    show(appearance: Appearance, cover: string | null, dark: boolean, picture: PictureState | null = null): void {
        this.appearance = appearance;
        this.cover = cover;
        this.dark = dark;
        this.picture = picture;
        this.paint();
    }

    setColors(colors: SettingsPageColors): void {
        this.colors = colors;
        this.paint();
    }

    destroy(): void {
        this.actor.destroy();
    }

    /** Shows the change at once and sends it; a refusal comes back as show() with the old value. */
    private apply(key: string, value: GLib.Variant, change: Partial<Appearance>): void {
        if (!this.appearance) return;
        this.appearance = { ...this.appearance, ...change };
        this.paint();
        this.handlers.set(key, value);
    }

    private field(key: string): keyof Appearance {
        return key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase()) as keyof Appearance;
    }

    private paint(): void {
        const a = this.appearance;
        if (!a) return;
        const { foreground, accent, onAccent } = this.colors;
        this.paintThemes(a);
        for (const { read, view } of this.switches) view.paint(read(a), this.colors);
        const chosen = motionPreset(a.animationSpeed);
        this.motion.forEach((button, i) => {
            const on = i === chosen;
            button.style = on
                ? `background-color: ${accent}; color: ${onAccent};`
                : `background-color: ${withAlpha(foreground, 0.1)}; color: ${foreground};`;
        });
    }

    /** Seven small notches, built once; their colors follow the theme settings and the cover. */
    private buildThemes(): void {
        for (const theme of THEMES) {
            const dot = new St.Widget({
                style_class: 'nokta-settings-swatch-dot',
                x_expand: true,
                y_expand: true,
                x_align: Clutter.ActorAlign.CENTER,
                y_align: Clutter.ActorAlign.CENTER,
            });
            // The dot sits where the camera would be, in the theme's accent.
            const notch = new St.Widget({ style_class: 'nokta-settings-swatch', layout_manager: new Clutter.BinLayout() });
            notch.add_child(dot);
            const ring = new St.Bin({ style_class: 'nokta-settings-swatch-ring', child: notch });
            const label = new St.Label({ style_class: 'nokta-settings-swatch-label', x_align: Clutter.ActorAlign.CENTER });
            const box = setVertical(new St.BoxLayout({ style_class: 'nokta-settings-theme-box' }));
            box.add_child(ring);
            box.add_child(label);
            const button = new St.Button({
                style_class: `nokta-settings-theme nokta-settings-theme-${theme}`,
                child: box,
                x_expand: true,
                can_focus: true,
            });
            button.connect('clicked', () => {
                if (!this.appearance) return;
                const key = themeKeyFor(this.appearance, this.dark);
                this.apply(key, new GLib.Variant('s', theme), key === 'theme' ? { theme } : { lightTheme: theme });
            });
            this.swatches.push({ notch, dot, ring, label });
            this.themeRow.add_child(button);
        }
    }

    private paintThemes(a: Appearance): void {
        themeSwatches(a, this.cover, this.picture).forEach((swatch, i) => {
            const { notch, dot, ring, label } = this.swatches[i];
            const chosen = swatch.theme === themeFor(a, this.dark);
            const fill = swatch.picture
                ? `background-image: url("file://${swatch.picture}"); background-size: cover;`
                : // St has no diagonal gradient: across and diagonal run sideways.
                  `background-gradient-direction: ${swatch.direction[0] > 0 ? 'horizontal' : 'vertical'};` +
                  ` background-gradient-start: ${swatch.top}; background-gradient-end: ${swatch.bottom};`;
            // A hairline keeps a dark theme's swatch visible on a dark notch.
            notch.style = `${fill} border: 1px solid ${withAlpha(this.colors.foreground, 0.18)};`;
            dot.style = `background-color: ${swatch.accent};`;
            ring.style = `border-color: ${chosen ? this.colors.accent : 'transparent'};`;
            label.text = swatch.label;
            label.opacity = chosen ? 255 : SECONDARY;
        });
    }

    /** A row with a label and, at its right, `end`; the whole row takes the click. */
    private row(label: string, end: Clutter.Actor): St.Button {
        return new St.Button({
            style_class: 'nokta-settings-row',
            child: this.line(label, end),
            x_expand: true,
            can_focus: true,
        });
    }

    private line(label: string, end: Clutter.Actor): St.BoxLayout {
        const box = new St.BoxLayout({ style_class: 'nokta-settings-line', x_expand: true });
        box.add_child(
            new St.Label({
                style_class: 'nokta-settings-label',
                text: label,
                x_expand: true,
                y_align: Clutter.ActorAlign.CENTER,
            }),
        );
        box.add_child(end);
        return box;
    }
}
