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
