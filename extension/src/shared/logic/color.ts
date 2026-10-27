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

const HEX = /^#[0-9a-f]{6}$/i;

/** The cover's accent when it is wanted and valid, else the foreground. */
export function accentFor(useAlbumAccent: boolean, accent: string, foreground: string): string {
    return useAlbumAccent && HEX.test(accent) ? accent : foreground;
}

/** `#rrggbb` as a CSS `rgba()` with the given alpha. */
export function withAlpha(hex: string, alpha: number): string {
    const { r, g, b } = parseHexColor(hex);
    const byte = (c: number) => Math.round(c * 255);
    return `rgba(${byte(r)}, ${byte(g)}, ${byte(b)}, ${alpha})`;
}
