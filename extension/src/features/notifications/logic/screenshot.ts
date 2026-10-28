/** The icon of GNOME's screenshot notifications: GNOME 46 to 48, then 49 and later. */
const SCREENSHOT_SOURCE_ICONS = ['screenshot-recorded-symbolic', 'screenshooter-symbolic'];

/** A file the screenshot UI saved belongs to a preview shown this close to it. */
export const FILE_PAIR_MS = 3000;

export interface BannerShape {
    /** The icon name of the notification's source, if it is a named icon. */
    sourceIcon: string | null;
    /** Whether the notification carries an image rather than an icon. */
    hasImage: boolean;
}

/**
 * Whether a banner is GNOME's "Screenshot captured". Screen recordings
 * come from the same source but carry no image.
 */
export const isScreenshotBanner = ({ sourceIcon, hasImage }: BannerShape): boolean =>
    hasImage && sourceIcon !== null && SCREENSHOT_SOURCE_ICONS.includes(sourceIcon);

export type ScreenshotButton = 'open' | 'files' | 'keep';

export interface ButtonRequest {
    /** GNOME saved the screenshot to disk and added "Show in Files". */
    saved: boolean;
    /** The saved file is known. */
    file: boolean;
    /** The file shelf is on. */
    shelf: boolean;
}

/** The preview's buttons, in order. */
export function screenshotButtons({ saved, file, shelf }: ButtonRequest): ScreenshotButton[] {
    if (!saved) return [];
    return file && shelf ? ['open', 'files', 'keep'] : ['open', 'files'];
}

/**
 * Pairs the file the screenshot UI says it saved with the preview of the
 * same screenshot. GNOME shows the notification first and names the file
 * a moment later, but a queued banner can come after it.
 */
export class ScreenshotFiles {
    private file: { uri: string; atMs: number } | null = null;
    /** When the open preview started waiting for its file. */
    private waitingSince: number | null = null;

    /** The screenshot UI saved `uri`. True when the open preview takes it. */
    saved(uri: string, nowMs: number): boolean {
        const since = this.waitingSince;
        this.waitingSince = null;
        if (since !== null && nowMs - since <= FILE_PAIR_MS) return true;
        this.file = { uri, atMs: nowMs };
        return false;
    }

    /** A preview opened: its file if it is already known, else it waits for one. */
    previewed(nowMs: number): string | null {
        const file = this.file;
        this.file = null;
        if (file && nowMs - file.atMs <= FILE_PAIR_MS) {
            this.waitingSince = null;
            return file.uri;
        }
        this.waitingSince = nowMs;
        return null;
    }

    /** The preview closed. A file saved for a banner still queued stays. */
    ended(): void {
        this.waitingSince = null;
    }
}
