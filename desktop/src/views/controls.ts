import { POP, popsOn } from '@ext/features/panel/logic/motion.js';
import { mix, withAlpha } from '@ext/shared/logic/color.js';
import { onTone, toneOn } from '@ext/shared/logic/tones.js';

import { icon } from '../icons.js';

const IDLE_ALPHA = 0.1;
const HOVER_ALPHA = 0.18;

/** The colours the pills and tiles are painted with. */
export interface ControlColors {
    foreground: string;
    /** A light notch, where a tone used for an icon is darkened. */
    light: boolean;
}

const DEFAULT_COLORS: ControlColors = { foreground: '#ffffff', light: false };

/**
 * Off: a faint tint of the text colour, with the icon in the control's own
 * tone. On: filled with that tone. As the extension's panel/controls.ts.
 */
function paint(surface: HTMLElement, glyph: HTMLElement, on: boolean, hover: boolean, tone: string, colors: ControlColors): void {
    if (on) {
        surface.style.backgroundColor = hover ? mix(tone, '#ffffff', 0.12) : tone;
        surface.style.color = onTone(tone);
        glyph.style.color = '';
    } else {
        surface.style.backgroundColor = withAlpha(colors.foreground, hover ? HOVER_ALPHA : IDLE_ALPHA);
        surface.style.color = colors.foreground;
        glyph.style.color = toneOn(tone, colors.light);
    }
}

/** The icon grows a little and settles back, as its control turns on. */
function pop(glyph: HTMLElement): void {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    glyph.animate?.(
        [{ transform: `scale(${POP.from})` }, { transform: `scale(${POP.peak})` }, { transform: `scale(${POP.from})` }],
        { duration: POP.upMs + POP.downMs, easing: 'ease-out' },
    );
}

/** A control that repaints as the pointer comes and goes. */
abstract class Control {
    readonly element: HTMLButtonElement;
    protected on = false;
    protected colors = DEFAULT_COLORS;
    private hover = false;

    constructor(
        className: string,
        protected readonly tone: string,
        onClick: () => void,
    ) {
        this.element = document.createElement('button');
        this.element.className = className;
        this.element.addEventListener('click', onClick);
        this.element.addEventListener('pointerenter', () => this.setHover(true));
        this.element.addEventListener('pointerleave', () => this.setHover(false));
    }

    setColors(colors: ControlColors): void {
        this.colors = colors;
        this.repaint();
    }

    protected setOn(on: boolean, glyph: HTMLElement): void {
        if (popsOn(this.on, on)) pop(glyph);
        this.on = on;
        this.element.setAttribute('aria-pressed', String(on));
        this.repaint();
    }

    private setHover(hover: boolean): void {
        this.hover = hover;
        this.repaint();
    }

    protected abstract repaint(): void;

    protected paintOn(surface: HTMLElement, glyph: HTMLElement): void {
        paint(surface, glyph, this.on, this.hover, this.tone, this.colors);
    }
}

/** A quick toggle: a pill with an icon and a name, filled with its tone while on. */
export class TogglePill extends Control {
    private readonly glyph: HTMLSpanElement;

    constructor(name: string, label: string, tone: string, onClick: () => void) {
        super('nokta-pill', tone, onClick);
        this.glyph = icon(name, 16);
        const text = document.createElement('span');
        text.className = 'nokta-pill-label';
        text.textContent = label;
        this.element.append(this.glyph, text);
        this.repaint();
    }

    set(on: boolean): void {
        this.setOn(on, this.glyph);
    }

    protected repaint(): void {
        this.paintOn(this.element, this.glyph);
    }
}

/** A rounded square with its name under it; filled with its tone while its feature is on, with an optional count badge. */
export class Tile extends Control {
    private readonly square: HTMLSpanElement;
    private readonly glyph: HTMLSpanElement;
    private readonly badge: HTMLSpanElement;

    constructor(name: string, label: string, tone: string, onClick: () => void) {
        super('nokta-tile', tone, onClick);
        this.square = document.createElement('span');
        this.square.className = 'nokta-tile-square';
        this.glyph = icon(name, 18);
        this.badge = document.createElement('span');
        this.badge.className = 'nokta-tile-badge';
        this.badge.hidden = true;
        this.square.append(this.glyph, this.badge);
        const text = document.createElement('span');
        text.className = 'nokta-tile-label';
        text.textContent = label;
        this.element.append(this.square, text);
        this.repaint();
    }

    set(active: boolean, badge: string | null = null): void {
        this.badge.hidden = badge === null;
        this.badge.textContent = badge ?? '';
        this.setOn(active, this.glyph);
    }

    override setColors(colors: ControlColors): void {
        this.badge.style.backgroundColor = this.tone;
        this.badge.style.color = onTone(this.tone);
        super.setColors(colors);
    }

    protected repaint(): void {
        this.paintOn(this.square, this.glyph);
    }
}
