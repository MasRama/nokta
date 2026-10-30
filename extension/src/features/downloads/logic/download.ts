/** A button of the download preview. */
export type DownloadButton = 'open' | 'files' | 'keep';

/** What the preview shows of an io.nokta.Downloads1.Finished signal. */
export interface Download {
    uri: string;
    name: string;
    /** A themed icon name for the file's kind. */
    icon: string;
    /** Its size, like `2.4 MB`. */
    size: string;
    /** A PNG of a picture, empty for other files. */
    thumbnail: string;
}

const UNITS = ['kB', 'MB', 'GB', 'TB'];

/** `999 B`, `2.4 MB`: powers of 1000 and one decimal, as GNOME Files shows sizes. */
export function sizeLabel(bytes: number): string {
    if (bytes < 1000) return `${bytes} B`;
    let value = bytes / 1000;
    let unit = 0;
    // 999.96 kB rounds to 1000.0 kB; show it as 1.0 MB instead.
    while (Number(value.toFixed(1)) >= 1000 && unit < UNITS.length - 1) {
        value /= 1000;
        unit += 1;
    }
    return `${value.toFixed(1)} ${UNITS[unit]}`;
}

/** Open and Show in Files, and Keep on shelf while the shelf is on. */
export function downloadButtons(shelf: boolean): DownloadButton[] {
    return shelf ? ['open', 'files', 'keep'] : ['open', 'files'];
}

/** The signal's `(sssts)`, or null when it has another shape. */
export function downloadFrom(args: unknown): Download | null {
    if (!Array.isArray(args) || args.length !== 5) return null;
    const [uri, name, icon, size, thumbnail] = args as unknown[];
    const texts = [uri, name, icon, thumbnail].every((v) => typeof v === 'string');
    if (!texts || typeof size !== 'number' || !Number.isFinite(size)) return null;
    return {
        uri: uri as string,
        name: name as string,
        icon: icon as string,
        size: sizeLabel(size),
        thumbnail: thumbnail as string,
    };
}
