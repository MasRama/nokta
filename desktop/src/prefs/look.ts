import { themeSwatches, type ThemeSwatch } from '@ext/features/settings/logic/quick.js';
import { gradientEnds, SAMPLE_SONG, type PreviewModel } from '@ext/prefs/logic/look.js';
import { mix, withAlpha } from '@ext/shared/logic/color.js';
import type { PictureState, ThemeColors, ThemeName } from '@ext/shared/logic/theme.js';

const SVG = 'http://www.w3.org/2000/svg';

/** The preview's size; the notch hangs in its middle, as the extension's preview.ts. */
const WIDTH = 640;
const HEIGHT = 190;
const NOTCH_WIDTH = 380;
const NOTCH_HEIGHT = 104;
const COVER = 60;
const BARS = [10, 18, 8, 14];

const CARD_WIDTH = 92;
const CARD_HEIGHT = 44;

/** A dusk wallpaper, so a glass or paper notch has something to sit on. */
const SKY: [string, string] = ['#3b2c5c', '#0f1a2e'];

/** Each SVG's gradients and clips need ids no other one on the page has. */
let lastId = 0;
const newId = (name: string) => `nokta-${name}-${++lastId}`;

function svg<K extends keyof SVGElementTagNameMap>(tag: K, attributes: Record<string, string | number> = {}): SVGElementTagNameMap[K] {
    const el = document.createElementNS(SVG, tag);
    for (const [name, value] of Object.entries(attributes)) el.setAttribute(name, String(value));
    return el;
}

/** The notch's outline hanging from y = 0: ears curving out to the top edge, rounded bottom corners. */
export function notchPath(x: number, width: number, height: number, radius: number, ear: number): string {
    const r = Math.min(radius, height / 2, width / 2);
    const parts = [`M ${x - ear} 0`];
    if (ear > 0) parts.push(`A ${ear} ${ear} 0 0 1 ${x} ${ear}`);
    parts.push(`L ${x} ${height - r}`, `A ${r} ${r} 0 0 0 ${x + r} ${height}`, `L ${x + width - r} ${height}`);
    parts.push(`A ${r} ${r} 0 0 0 ${x + width} ${height - r}`, `L ${x + width} ${ear}`);
    if (ear > 0) parts.push(`A ${ear} ${ear} 0 0 1 ${x + width + ear} 0`);
    parts.push('Z');
    return parts.join(' ');
}

/** A gradient from (x1, y1) to (x2, y2) in the SVG's own units, through `[offset, color, opacity]` stops. */
function linear(id: string, [x1, y1, x2, y2]: [number, number, number, number], stops: [number, string, number][]): SVGLinearGradientElement {
    const gradient = svg('linearGradient', { id, gradientUnits: 'userSpaceOnUse', x1, y1, x2, y2 });
    for (const [offset, color, opacity] of stops) {
        gradient.append(svg('stop', { offset, 'stop-color': color, 'stop-opacity': opacity }));
    }
    return gradient;
}

/** The notch's body: its gradient at the theme's opacity, the picture darkened, and the border. */
interface Body {
    top: string;
    bottom: string;
    opacity: number;
    direction: [number, number];
    picture: string | null;
    darken: number;
    border: string | null;
}

/**
 * Draws a body into `group` over `x`..`x + width` and 0..`height`, with the
 * notch's corners; `pictureUrl` makes the picture's path a URL the page loads.
 */
function drawBody(group: SVGGElement, defs: SVGDefsElement, body: Body, shape: string, box: [number, number, number], pictureUrl: (path: string) => string): void {
    const [x, width, height] = box;
    const fill = newId('fill');
    defs.append(
        linear(fill, gradientEnds(x, width, height, body.direction), [
            [0, body.top, body.opacity],
            [1, body.bottom, body.opacity],
        ]),
    );
    group.append(svg('path', { d: shape, fill: `url(#${fill})` }));
    if (body.picture) {
        const clip = newId('clip');
        const clipPath = svg('clipPath', { id: clip });
        clipPath.append(svg('path', { d: shape }));
        defs.append(clipPath);
        const picture = svg('g', { 'clip-path': `url(#${clip})` });
        const image = svg('image', { x, y: 0, width, height, preserveAspectRatio: 'xMidYMid slice' });
        image.setAttribute('href', pictureUrl(body.picture));
        picture.append(image, svg('rect', { x, y: 0, width, height, fill: '#000000', 'fill-opacity': body.darken }));
        group.append(picture);
    }
    if (body.border) group.append(svg('path', { d: shape, fill: 'none', stroke: body.border, 'stroke-width': 1 }));
}

function sky(defs: SVGDefsElement, width: number, height: number): SVGRectElement {
    const id = newId('sky');
    defs.append(
        linear(id, [0, 0, width, height], [
            [0, SKY[0], 1],
            [1, SKY[1], 1],
        ]),
    );
    return svg('rect', { width, height, fill: `url(#${id})` });
}

/**
 * The top of a desktop with the notch open on a sample song, in the chosen
 * theme: a cover, the title and artist, the equalizer in the accent and,
 * while it is on, the progress line along the notch's bottom edge. As the
 * extension's prefs/preview.ts.
 */
export class NotchPreview {
    readonly element: HTMLDivElement;
    private readonly svg: SVGSVGElement;

    constructor(private readonly pictureUrl: (path: string) => string) {
        this.element = document.createElement('div');
        this.element.className = 'nokta-prefs-preview';
        this.svg = svg('svg', { viewBox: `0 0 ${WIDTH} ${HEIGHT}`, role: 'img' });
        this.element.append(this.svg);
    }

    update(model: PreviewModel): void {
        const { palette } = model;
        const defs = svg('defs');
        const scene = svg('g');
        scene.append(sky(defs, WIDTH, HEIGHT));

        const x = (WIDTH - NOTCH_WIDTH) / 2;
        const shape = notchPath(x, NOTCH_WIDTH, NOTCH_HEIGHT, model.cornerRadius, model.earRadius);
        drawBody(
            scene,
            defs,
            {
                top: palette.background,
                bottom: palette.gradient ?? palette.background,
                opacity: palette.backgroundOpacity,
                direction: palette.direction,
                picture: palette.picture?.path ?? null,
                darken: palette.picture?.darken ?? 0,
                border: palette.border ?? null,
            },
            shape,
            [x, NOTCH_WIDTH, NOTCH_HEIGHT],
            this.pictureUrl,
        );

        // The cover, a gradient of the sample song's color.
        const coverX = x + 22;
        const coverY = 22;
        const cover = newId('cover');
        defs.append(
            linear(cover, [coverX, coverY, coverX + COVER, coverY + COVER], [
                [0, mix(SAMPLE_SONG.cover, '#ffffff', 0.2), 1],
                [1, mix(SAMPLE_SONG.cover, '#000000', 0.45), 1],
            ]),
        );
        scene.append(svg('rect', { x: coverX, y: coverY, width: COVER, height: COVER, rx: 12, fill: `url(#${cover})` }));

        const textX = coverX + COVER + 16;
        const text = (content: string, y: number, size: number, weight: number, color: string) => {
            const t = svg('text', { x: textX, y, 'font-size': size, 'font-weight': weight, fill: color, 'dominant-baseline': 'hanging' });
            t.textContent = content;
            scene.append(t);
        };
        text(model.title, coverY + 8, 15, 700, palette.foreground);
        text(model.artist, coverY + 32, 13, 500, withAlpha(palette.foreground, 0.6));

        // The equalizer, its bars standing on one line.
        const base = coverY + 44;
        BARS.forEach((bar, i) => {
            scene.append(svg('rect', { x: x + NOTCH_WIDTH - 48 + i * 7, y: base - bar, width: 4, height: bar, rx: 2, fill: palette.accent }));
        });

        if (model.progress !== null) {
            const inset = Math.max(model.cornerRadius, 12);
            const length = NOTCH_WIDTH - inset * 2;
            const line = { x: x + inset, y: NOTCH_HEIGHT - 5, height: 3, rx: 1.5 };
            scene.append(svg('rect', { ...line, width: length, fill: withAlpha(palette.foreground, 0.15) }));
            scene.append(svg('rect', { ...line, width: length * model.progress, fill: palette.accent }));
        }
        this.svg.replaceChildren(defs, scene);
    }
}

interface Card {
    theme: ThemeName;
    button: HTMLButtonElement;
    svg: SVGSVGElement;
}

/**
 * The themes as small notches hanging from a strip of screen, the chosen one
 * ringed in ember; a click picks that theme. Aurora's swatch is tinted with
 * the preview's sample song. As the extension's prefs/themes.ts.
 */
export class ThemeGallery {
    readonly element: HTMLDivElement;
    private readonly cards: Card[] = [];

    constructor(
        onPick: (theme: ThemeName) => void,
        private readonly pictureUrl: (path: string) => string,
    ) {
        this.element = document.createElement('div');
        this.element.className = 'nokta-prefs-themes';
        this.element.setAttribute('role', 'radiogroup');
        const defaults = { background: '#000000', backgroundOpacity: 1, foreground: '#ffffff', accent: '#ffffff', useAlbumAccent: false };
        for (const { theme, label } of themeSwatches(defaults, SAMPLE_SONG.cover)) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'nokta-prefs-theme';
            button.setAttribute('role', 'radio');
            const art = svg('svg', { viewBox: `0 0 ${CARD_WIDTH} ${CARD_HEIGHT}`, width: CARD_WIDTH, height: CARD_HEIGHT });
            const name = document.createElement('span');
            name.textContent = label;
            button.append(art, name);
            button.addEventListener('click', () => onPick(theme));
            this.cards.push({ theme, button, svg: art });
            this.element.append(button);
        }
    }

    /** `picture` is the picture theme's image, for its card. */
    update(colors: ThemeColors, chosen: string, picture: PictureState | null = null): void {
        const swatches = themeSwatches(colors, SAMPLE_SONG.cover, picture);
        this.cards.forEach((card, i) => {
            const on = card.theme === chosen;
            card.button.classList.toggle('nokta-prefs-theme-chosen', on);
            card.button.setAttribute('aria-checked', String(on));
            this.draw(card.svg, swatches[i], picture?.darken ?? 0);
        });
    }

    private draw(art: SVGSVGElement, swatch: ThemeSwatch | undefined, darken: number): void {
        if (!swatch) return;
        const defs = svg('defs');
        const scene = svg('g');
        scene.append(sky(defs, CARD_WIDTH, CARD_HEIGHT));
        const width = 58;
        const height = 24;
        const x = (CARD_WIDTH - width) / 2;
        const body: Body = {
            top: swatch.top,
            bottom: swatch.bottom,
            opacity: 1,
            direction: swatch.direction,
            picture: swatch.picture,
            darken,
            border: 'rgba(255, 255, 255, 0.14)',
        };
        drawBody(scene, defs, body, notchPath(x, width, height, 9, 5), [x, width, height], this.pictureUrl);
        // The progress line, in the theme's accent.
        scene.append(svg('rect', { x: x + 12, y: height - 4, width: (width - 24) * SAMPLE_SONG.position, height: 2, fill: swatch.accent }));
        scene.append(svg('circle', { cx: CARD_WIDTH / 2, cy: height / 2 - 1, r: 2.5, fill: swatch.foreground, 'fill-opacity': 0.85 }));
        art.replaceChildren(defs, scene);
    }
}
