/** GNOME's `MessageTray.Urgency.CRITICAL`. */
export const CRITICAL = 3;

export interface BannerRequest {
    /** `[notifications] in_notch`. */
    inNotch: boolean;
    urgency: number;
    /** False while a fullscreen app hides the notch, or there is none. */
    notchShown: boolean;
}

/**
 * Whether the notch shows a banner GNOME was about to show. Critical
 * notifications stay with GNOME: its banner keeps them until dismissed.
 */
export const takesBanner = ({ inNotch, urgency, notchShown }: BannerRequest): boolean =>
    inNotch && notchShown && urgency < CRITICAL;

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

/** Pango markup as one line of plain text: no tags, entities decoded. */
export function plainText(markup: string): string {
    return markup
        .replace(/<[^>]*>/g, '')
        .replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (whole: string, name: string) => {
            if (name[0] !== '#') return ENTITIES[name.toLowerCase()] ?? whole;
            const code = name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
            return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
        })
        .replace(/\s+/g, ' ')
        .trim();
}

export interface NotificationText {
    title: string;
    body: string;
    /** The app that sent it, GNOME's source title. */
    app: string;
}

/**
 * The two lines of the notch: the title, then the body. Without a body, or
 * with show_body off, the second line names the app instead.
 */
export function notificationLines(n: NotificationText, showBody: boolean): { title: string; detail: string } {
    const app = plainText(n.app);
    const title = plainText(n.title) || app;
    const body = showBody ? plainText(n.body) : '';
    return { title, detail: body || (app === title ? '' : app) };
}

/**
 * An icon drawn in one color (its theme names or file path end in
 * `-symbolic`): it sits on a square of the accent. An app's full-color icon
 * stands alone.
 */
export const isSymbolicIcon = (names: readonly string[]): boolean =>
    names.some((name) => name.endsWith('-symbolic') || name.endsWith('-symbolic.svg'));
