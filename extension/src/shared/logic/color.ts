export interface Rgb {
    r: number;
    g: number;
    b: number;
}

/** `#rrggbb` as 0..1 channels, or `fallback` for anything else. */
export function parseHexColor(hex: string, fallback: Rgb = { r: 0, g: 0, b: 0 }): Rgb {
    const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
    if (!match) return fallback;
    const [r, g, b] = match.slice(1).map((h) => parseInt(h, 16) / 255);
    return { r, g, b };
}

/** 0..1 channels as `#rrggbb`; out-of-range channels are clamped, NaN is 0. */
export function toHexColor({ r, g, b }: Rgb): string {
    const hex = (c: number) =>
        Math.round(Number.isNaN(c) ? 0 : Math.min(1, Math.max(0, c)) * 255)
            .toString(16)
            .padStart(2, '0');
    return `#${hex(r)}${hex(g)}${hex(b)}`;
}

const HEX = /^#[0-9a-f]{6}$/i;

/** The cover's accent when it is wanted and valid, else `fallback` (the accent setting). */
export function accentFor(useAlbumAccent: boolean, accent: string, fallback: string): string {
    return useAlbumAccent && HEX.test(accent) ? accent : fallback;
}

/** An alpha in 0..1; NaN counts as opaque. */
export const clampAlpha = (alpha: number): number => (Number.isNaN(alpha) ? 1 : Math.min(1, Math.max(0, alpha)));

/** `#rrggbb` as a CSS `rgba()` with the given alpha (clamped to 0..1). */
export function withAlpha(hex: string, alpha: number): string {
    const { r, g, b } = parseHexColor(hex);
    const byte = (c: number) => Math.round(c * 255);
    const a = Math.round(clampAlpha(alpha) * 1000) / 1000;
    return `rgba(${byte(r)}, ${byte(g)}, ${byte(b)}, ${a})`;
}

/** `a` mixed with `b`: 0 is all `a`, 1 is all `b`. */
export function mix(a: string, b: string, t: number): string {
    const x = parseHexColor(a);
    const y = parseHexColor(b);
    const k = Math.min(1, Math.max(0, t));
    return toHexColor({ r: x.r + (y.r - x.r) * k, g: x.g + (y.g - x.g) * k, b: x.b + (y.b - x.b) * k });
}

/** Relative luminance, 0 for black to 1 for white, as WCAG defines it. */
export function luminance(hex: string): number {
    const linear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    const { r, g, b } = parseHexColor(hex);
    return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}
