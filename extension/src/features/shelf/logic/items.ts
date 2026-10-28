/** One file on the shelf, as io.nokta.Shelf1.Items lists it. */
export interface ShelfItem {
    uri: string;
    name: string;
    /** An icon name from the icon theme. */
    icon: string;
    /** A PNG to show instead of the icon (io.nokta.Shelf1.Thumbnails), or null. */
    thumbnail: string | null;
}

export interface Rect {
    x: number;
    y: number;
    width: number;
    height: number;
}

/** Items, oldest first, with their thumbnails; anything malformed is skipped. */
export function itemsFrom(raw: unknown, thumbnails: unknown = {}): ShelfItem[] {
    if (!Array.isArray(raw)) return [];
    const pictures = (typeof thumbnails === 'object' && thumbnails) || {};
    const items: ShelfItem[] = [];
    for (const row of raw) {
        if (!Array.isArray(row) || row.length !== 3 || !row.every((v) => typeof v === 'string')) continue;
        const [uri, name, icon] = row as [string, string, string];
        const picture: unknown = Object.hasOwn(pictures, uri) ? (pictures as Record<string, unknown>)[uri] : null;
        items.push({ uri, name, icon, thumbnail: typeof picture === 'string' && picture !== '' ? picture : null });
    }
    return items;
}

/** The URIs in a text/uri-list, without its comments and blank lines. */
export function urisFromList(text: string): string[] {
    return text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line !== '' && !line.startsWith('#'));
}

export function urisToList(uris: readonly string[]): string {
    return uris.map((uri) => `${uri}\r\n`).join('');
}

export function pointIn(rect: Rect, x: number, y: number): boolean {
    return x >= rect.x && x < rect.x + rect.width && y >= rect.y && y < rect.y + rect.height;
}
