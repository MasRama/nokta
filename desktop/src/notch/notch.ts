import { clampAlpha, parseCssColor } from '@ext/shared/logic/color.js';
import { envelope, frameMs, notchX } from '@ext/shared/logic/motion.js';
import { PICTURE_HEIGHT, radiusAt, type NotchWidths } from '@ext/shared/logic/shape.js';
import {
    kickVelocity,
    settled,
    springFor,
    stepSpring,
    type ResizeKind,
    type SpringParams,
    type SpringState,
} from '@ext/shared/logic/spring.js';
import { THEMES, type Depth, type Palette } from '@ext/shared/logic/theme.js';

import { bodyPath, gradientEnd, notchPath, notchWidth } from './path.js';

export type { ResizeKind } from '@ext/shared/logic/spring.js';

/** The parts of the appearance config the notch shape uses. */
export interface NotchStyle extends NotchWidths {
    /** The closed notch's height, where the corners are `cornerRadius`. */
    height: number;
    cornerRadius: number;
    earRadius: number;
    animationSpeed: number;
}

/** A rectangle in the window's CSS px. */
export interface Box {
    x: number;
    y: number;
    width: number;
    height: number;
}

/** Frames for the springs; the page's own by default, a fake one in tests. */
export interface Frames {
    now(): number;
    request(callback: () => void): number;
    cancel(id: number): void;
}

const PAGE_FRAMES: Frames = {
    now: () => performance.now(),
    request: (callback) => requestAnimationFrame(callback),
    cancel: (id) => cancelAnimationFrame(id),
};

/** How long the glow takes to come and to go, before animation_speed. */
const GLOW_IN_MS = 150;
const GLOW_OUT_MS = 250;
/** The picture fades in and out over the notch's fill. */
const PICTURE_FADE_MS = 250;
/** The glow's colour is this strong at its brightest. */
const GLOW_ALPHA = 0.9;
/** The glow is a box-shadow of 0 4px 24px 4px, as the extension's shader draws it. */
const GLOW_OFFSET = 4;
const GLOW_GROW = 4;
const GLOW_BLUR = 12;
/** The shadow lies this much lower than the glow. */
const SHADOW_DROP = 2;
/** A waiting kick goes off this close to the target, before the width slows to a crawl. */
const KICK_NEAR_PX = 3;
const EASE_OUT_QUAD = 'cubic-bezier(0.25, 0.46, 0.45, 0.94)';
const EASE_IN_QUAD = 'cubic-bezier(0.55, 0.085, 0.68, 0.53)';
const SVG = 'http://www.w3.org/2000/svg';

let ids = 0;

function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}): SVGElementTagNameMap[K] {
    const element = document.createElementNS(SVG, tag);
    for (const [name, value] of Object.entries(attrs)) element.setAttribute(name, String(value));
    return element;
}

/** A CSS colour with its alpha from `alpha`, as the shader mixes them. */
function rgba(css: string, alpha: number): string {
    const [r, g, b] = parseCssColor(css) ?? [0, 0, 0];
    const c = (v: number) => Math.round(v * 255);
    return `rgba(${c(r)}, ${c(g)}, ${c(b)}, ${clampAlpha(alpha)})`;
}

function reducedMotion(): boolean {
    return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * The notch at the top centre of the window: left ear, body, right ear, as
 * the extension's Notch draws it with its shader, here in SVG. Views go in
 * `body`, which clips them while resizing.
 *
 * Width and height follow one spring each, stepped on the same frames, so
 * they move together and a new size mid-way bends the motion instead of
 * restarting it. The corners round more as the body grows. Each frame only
 * changes path data and the body's clip; the views keep their final size.
 *
 * The glow and the shadow reach past the notch: the window lets clicks
 * through everywhere but `hit`, the notch with room for its motion.
 */
export class Notch {
    readonly element: HTMLDivElement;
    readonly body: HTMLDivElement;
    private readonly clip: HTMLDivElement;
    private readonly art: SVGSVGElement;
    private readonly shape: SVGPathElement;
    private readonly clipShape: SVGPathElement;
    private readonly cutShape: SVGPathElement;
    private readonly fill: SVGLinearGradientElement;
    private readonly fillStops: [SVGStopElement, SVGStopElement];
    private readonly glow: SVGPathElement;
    private readonly shadow: SVGPathElement;
    private readonly rim: SVGPathElement;
    private readonly rimFade: SVGLinearGradientElement;
    private readonly border: SVGPathElement;
    private readonly picture: SVGGElement;
    private readonly pictureImage: SVGImageElement;
    private readonly pictureShade: SVGRectElement;
    private picturePath = '';
    private glowColor: string | null = null;
    private style: NotchStyle;
    private palette: Palette;
    private areaWidth = 0;
    /** The size the body is heading to. */
    private width = 0;
    private height = 0;
    /** The room the notch takes the pointer in: the final size at rest, the motion's while it moves. */
    private laidWidth = -1;
    private laidHeight = -1;
    private shownWidth: SpringState = { value: 0, velocity: 0 };
    private shownHeight: SpringState = { value: 0, velocity: 0 };
    private spring: SpringParams = springFor('width', 1);
    /** A kick waiting for the width to reach its target, and from which side it comes. */
    private pendingKick: { fraction: number; side: number } | null = null;
    private frame: number | null = null;
    private lastFrameMs = 0;

    constructor(
        style: NotchStyle,
        palette: Palette,
        /** Called with the room the notch takes the pointer in, when it changes. */
        private readonly onHit: (hit: Box) => void = () => {},
        private readonly frames: Frames = PAGE_FRAMES,
    ) {
        this.style = style;
        this.palette = palette;
        const id = `nokta-${++ids}`;
        this.element = document.createElement('div');
        this.element.className = 'nokta-notch';
        this.art = svg('svg', { class: 'nokta-art', width: '100%', height: '100%' });
        const defs = svg('defs');
        this.fill = svg('linearGradient', { id: `${id}-fill`, gradientUnits: 'userSpaceOnUse' });
        this.fillStops = [svg('stop', { offset: 0 }), svg('stop', { offset: 1 })];
        this.fill.append(...this.fillStops);
        const clipPath = svg('clipPath', { id: `${id}-clip` });
        this.clipShape = svg('path');
        clipPath.append(this.clipShape);
        const blur = svg('filter', { id: `${id}-blur`, filterUnits: 'userSpaceOnUse', x: -200, y: -200, width: 10000, height: 4000 });
        blur.append(svg('feGaussianBlur', { stdDeviation: GLOW_BLUR }));
        // The shadow never shows through a see-through body.
        const cut = svg('mask', { id: `${id}-cut`, maskUnits: 'userSpaceOnUse', x: -200, y: -200, width: 10000, height: 4000 });
        this.cutShape = svg('path', { fill: 'black' });
        cut.append(svg('rect', { x: -200, y: -200, width: 10000, height: 4000, fill: 'white' }), this.cutShape);
        // The rim runs from below the ears down.
        this.rimFade = svg('linearGradient', { id: `${id}-rim`, gradientUnits: 'userSpaceOnUse', x1: 0, x2: 0 });
        this.rimFade.append(
            svg('stop', { offset: 0, 'stop-color': 'white', 'stop-opacity': 0 }),
            svg('stop', { offset: 1, 'stop-color': 'white', 'stop-opacity': 1 }),
        );
        const rimMask = svg('mask', { id: `${id}-rim-mask`, maskUnits: 'userSpaceOnUse', x: -200, y: -200, width: 10000, height: 4000 });
        rimMask.append(svg('rect', { x: -200, y: -200, width: 10000, height: 4000, fill: `url(#${id}-rim)` }));
        defs.append(this.fill, clipPath, blur, cut, this.rimFade, rimMask);

        this.shadow = svg('path', { class: 'nokta-shadow', fill: 'black', filter: `url(#${id}-blur)` });
        const shadowGroup = svg('g', { mask: `url(#${id}-cut)` });
        shadowGroup.append(this.shadow);
        this.glow = svg('path', { class: 'nokta-glow', filter: `url(#${id}-blur)`, 'fill-opacity': GLOW_ALPHA });
        this.glow.style.opacity = '0';
        this.glow.style.display = 'none';
        this.shape = svg('path', { class: 'nokta-shape', fill: `url(#${id}-fill)` });
        this.picture = svg('g', { class: 'nokta-picture', 'clip-path': `url(#${id}-clip)` });
        this.pictureImage = svg('image', { preserveAspectRatio: 'xMidYMid slice' });
        this.pictureShade = svg('rect', { fill: 'black' });
        this.picture.append(this.pictureImage, this.pictureShade);
        this.picture.style.display = 'none';
        this.rim = svg('path', { class: 'nokta-rim', fill: 'none', 'stroke-width': 2, mask: `url(#${id}-rim-mask)` });
        this.border = svg('path', { class: 'nokta-border', fill: 'none', 'stroke-width': 1 });
        this.art.append(defs, shadowGroup, this.glow, this.shape, this.picture, this.rim, this.border);

        this.clip = document.createElement('div');
        this.clip.className = 'nokta-clip';
        this.body = document.createElement('div');
        this.body.className = 'nokta-body';
        this.clip.append(this.body);
        this.element.append(this.art, this.clip);
        this.applyPalette();
    }

    setAppearance(style: NotchStyle): void {
        this.style = style;
        this.applyPalette();
        this.jumpTo(this.width, this.height);
    }

    /** The colours, which follow the theme and the cover; the size stays. */
    setPalette(palette: Palette): void {
        const old = this.palette;
        this.palette = palette;
        if (JSON.stringify(old) !== JSON.stringify(palette)) this.applyPalette();
    }

    /** The window's width, in which the notch centres; call again when it changes. */
    setArea(width: number): void {
        this.areaWidth = width;
        this.jumpTo(this.width, this.height);
    }

    /** Animates the body to `width` × `height`, keeping the notch centred. */
    resizeTo(width: number, height: number, kind: ResizeKind): void {
        if (width === this.width && height === this.height) return;
        if (reducedMotion()) {
            this.jumpTo(width, height);
            return;
        }
        this.width = width;
        this.height = height;
        this.spring = springFor(kind, this.style.animationSpeed);
        this.animate();
    }

    /**
     * Pushes the width past its target by `fraction`, to spring back; not
     * with reduced motion. While the width still moves, the kick waits until
     * it gets there, or the motion would swallow it.
     */
    kick(fraction: number): void {
        if (reducedMotion()) return;
        const side = Math.sign(this.width - this.shownWidth.value);
        this.pendingKick = { fraction, side };
        if (Math.abs(this.width - this.shownWidth.value) < 1) this.applyKick();
        this.animate();
    }

    /** A glow in `color` under the body, fading in; null fades it out. */
    setGlow(color: string | null): void {
        if (color === this.glowColor) return;
        this.glowColor = color;
        const speed = this.style.animationSpeed;
        if (color) {
            this.glow.setAttribute('fill', rgba(color, 1));
            this.glow.style.display = '';
            // Read the style back, so the fade starts from the hidden glow.
            void this.glow.getBoundingClientRect();
            this.glow.style.transition = `opacity ${GLOW_IN_MS * speed}ms ${EASE_OUT_QUAD}`;
            this.glow.style.opacity = '1';
        } else {
            this.glow.style.transition = `opacity ${GLOW_OUT_MS * speed}ms ${EASE_OUT_QUAD}`;
            this.glow.style.opacity = '0';
            setTimeout(() => {
                if (!this.glowColor) this.glow.style.display = 'none';
            }, GLOW_OUT_MS * speed);
        }
    }

    /** The shadow under the notch and the rim inside its edge. */
    setDepth(depth: Depth): void {
        if (depth.rim) this.rim.setAttribute('stroke', depth.rim);
        this.rim.style.display = depth.rim ? '' : 'none';
        this.shadow.setAttribute('fill-opacity', String(depth.shadowAlpha));
        this.shadow.style.display = depth.shadowAlpha > 0 ? '' : 'none';
    }

    /** Sets the size without animating. */
    jumpTo(width: number, height: number): void {
        this.width = width;
        this.height = height;
        this.pendingKick = null;
        this.stop();
        this.shownWidth = { value: width, velocity: 0 };
        this.shownHeight = { value: height, velocity: 0 };
        // The window or the ears may have changed: report the room again.
        this.laidWidth = -1;
        this.layOut(width, height);
        this.apply();
    }

    destroy(): void {
        this.stop();
        this.element.remove();
    }

    /** Where the body is once it is `width` × `height`, in the window's CSS px. */
    bodyRect(width: number, height: number): Box {
        const x = notchX({ x: 0, width: this.areaWidth }, width, this.style.earRadius) + this.style.earRadius;
        return { x, y: 0, width, height };
    }

    private stop(): void {
        if (this.frame !== null) this.frames.cancel(this.frame);
        this.frame = null;
    }

    private applyKick(): void {
        if (!this.pendingKick) return;
        const velocity = this.shownWidth.velocity + kickVelocity(this.width, this.spring, this.pendingKick.fraction);
        this.shownWidth = { ...this.shownWidth, velocity };
        this.pendingKick = null;
    }

    /** Makes room for the motion to the new target once, then starts the springs. */
    private animate(): void {
        this.layOut(envelope(this.shownWidth.value, this.width), envelope(this.shownHeight.value, this.height));
        this.apply();
        if (this.frame !== null) return;
        this.lastFrameMs = this.frames.now();
        this.frame = this.frames.request(() => this.onFrame());
    }

    private onFrame(): void {
        this.frame = null;
        const now = this.frames.now();
        const dtMs = frameMs(now - this.lastFrameMs, 0);
        this.lastFrameMs = now;
        this.shownWidth = stepSpring(this.shownWidth, this.width, dtMs, this.spring);
        this.shownHeight = stepSpring(this.shownHeight, this.height, dtMs, this.spring);
        if (this.pendingKick && (this.shownWidth.value - this.width) * this.pendingKick.side >= -KICK_NEAR_PX)
            this.applyKick();
        if (settled(this.shownWidth, this.width) && settled(this.shownHeight, this.height)) {
            this.shownWidth = { value: this.width, velocity: 0 };
            this.shownHeight = { value: this.height, velocity: 0 };
            this.layOut(this.width, this.height);
        } else {
            // A kick on top of an overshoot: rare, so another report is fine.
            if (this.shownWidth.value > this.laidWidth || this.shownHeight.value > this.laidHeight)
                this.layOut(envelope(this.shownWidth.value, this.width), envelope(this.shownHeight.value, this.height));
            this.frame = this.frames.request(() => this.onFrame());
        }
        this.apply();
    }

    /** Reports the room for a body of `width` × `height`; only when that changes. */
    private layOut(width: number, height: number): void {
        if (width === this.laidWidth && height === this.laidHeight) return;
        this.laidWidth = width;
        this.laidHeight = height;
        const ear = this.style.earRadius;
        this.onHit({
            x: notchX({ x: 0, width: this.areaWidth }, width, ear),
            y: 0,
            width: notchWidth(width, ear),
            height: Math.max(height, ear),
        });
        this.placePicture();
        // The views keep the final size and place; the clip around them moves.
        const rest = this.bodyRect(this.width, this.height);
        this.body.style.width = `${rest.width}px`;
        this.body.style.height = `${rest.height}px`;
    }

    /** Draws the shape at the springs' size and clips the views to it. */
    private apply(): void {
        const width = Math.max(this.shownWidth.value, 0);
        const height = Math.max(this.shownHeight.value, 0);
        const ear = this.style.earRadius;
        const rest = this.bodyRect(this.width, this.height);
        // Centred where the body rests, so its edges land on whole pixels there.
        const center = rest.x + rest.width / 2;
        const left = center - width / 2;
        const radius = radiusAt(height, { height: this.style.height, radius: this.style.cornerRadius });
        const silhouette = notchPath(width, height, radius, ear, left - ear);
        this.shape.setAttribute('d', silhouette);
        this.clipShape.setAttribute('d', silhouette);
        this.cutShape.setAttribute('d', silhouette);
        const halo = bodyPath(left, width, height, radius, GLOW_GROW);
        this.glow.setAttribute('d', halo);
        this.glow.setAttribute('transform', `translate(0 ${GLOW_OFFSET})`);
        this.shadow.setAttribute('d', halo);
        this.shadow.setAttribute('transform', `translate(0 ${GLOW_OFFSET + SHADOW_DROP})`);
        this.rim.setAttribute('d', bodyPath(left, width, height, radius, -1));
        this.rimFade.setAttribute('y1', String(ear));
        this.rimFade.setAttribute('y2', String(ear + radius));
        this.border.setAttribute('d', bodyPath(left, width, height, radius, -0.5));
        // The gradient spans the body: 0..1 across and down, as in the shader.
        this.fill.setAttribute('gradientTransform', `translate(${left} 0) scale(${Math.max(width, 1)} ${Math.max(height, 1)})`);
        this.clip.style.left = `${left}px`;
        this.clip.style.width = `${width}px`;
        this.clip.style.height = `${height}px`;
        this.body.style.left = `${rest.x - left}px`;
    }

    /** The picture spans the widest notch, centred, so it never moves on screen. */
    private placePicture(): void {
        const s = this.style;
        const width = notchWidth(Math.max(s.idleWidth, s.playingWidth, s.expandedWidth, s.osdWidth), s.earRadius);
        const x = Math.round(this.areaWidth / 2 - width / 2);
        for (const element of [this.pictureImage, this.pictureShade]) {
            element.setAttribute('x', String(x));
            element.setAttribute('y', '0');
            element.setAttribute('width', String(width));
            element.setAttribute('height', String(PICTURE_HEIGHT));
        }
    }

    /** Shows the palette's picture over the fill, fading in and out. */
    private applyPicture(): void {
        const wanted = this.palette.picture?.path ? this.palette.picture : null;
        const duration = PICTURE_FADE_MS * this.style.animationSpeed;
        if (wanted) {
            if (wanted.path !== this.picturePath) {
                this.picturePath = wanted.path;
                this.pictureImage.setAttribute('href', pictureUrl(wanted.path));
                this.picture.style.opacity = '0';
                this.picture.style.display = '';
                this.placePicture();
                void this.picture.getBoundingClientRect();
            }
            this.pictureShade.setAttribute('fill-opacity', String(wanted.darken));
            this.picture.style.transition = `opacity ${duration}ms ${EASE_OUT_QUAD}`;
            this.picture.style.opacity = '1';
        } else if (this.picturePath) {
            this.picturePath = '';
            this.picture.style.transition = `opacity ${duration}ms ${EASE_IN_QUAD}`;
            this.picture.style.opacity = '0';
            setTimeout(() => {
                if (this.picturePath) return;
                this.picture.style.display = 'none';
                this.pictureImage.removeAttribute('href');
            }, duration);
        }
    }

    private applyPalette(): void {
        this.applyPicture();
        const { background, backgroundOpacity, gradient, direction, foreground, border, theme, light } = this.palette;
        for (const name of THEMES) this.element.classList.remove(`nokta-theme-${name}`);
        this.element.classList.add(`nokta-theme-${theme}`);
        // Paper, or a light custom theme: the focus ring is dark.
        this.element.classList.toggle('nokta-light', light);
        // The views take their text colour from the body.
        this.body.style.color = foreground;
        const [x2, y2] = gradientEnd(direction);
        this.fill.setAttribute('x1', '0');
        this.fill.setAttribute('y1', '0');
        this.fill.setAttribute('x2', String(x2));
        this.fill.setAttribute('y2', String(y2));
        this.fillStops[0].setAttribute('stop-color', rgba(background, backgroundOpacity));
        this.fillStops[1].setAttribute('stop-color', rgba(gradient ?? background, backgroundOpacity));
        if (border) this.border.setAttribute('stroke', border);
        this.border.style.display = border ? '' : 'none';
    }
}

/** A picture file as the page can load it: the app's asset protocol, or as is in a browser. */
let pictureUrl = (path: string): string => path;

/** Sets how picture files become URLs; the app calls it with Tauri's `convertFileSrc`. */
export function setPictureUrl(convert: (path: string) => string): void {
    pictureUrl = convert;
}
