import type { NotchMode } from '../shared/logic/machine.js';

/**
 * What the notch draws: the state machine's mode (home or a page when it
 * opens over one), the first-run tour, or the OSD, a notification or the
 * drop area over it.
 */
export type Drawn =
    | NotchMode
    | 'peek'
    | 'panel'
    | 'page'
    | 'osd'
    | 'notification'
    | 'screenshot'
    | 'download'
    | 'drop'
    | 'tour';

/** A message timed like a notification. */
export type Message = 'notification' | 'screenshot' | 'download';

/** A notification is two lines tall: this much taller than the closed notch. */
export const NOTIFICATION_EXTRA_HEIGHT = 28;
/** Its row of buttons, with the spacing above it. */
export const NOTIFICATION_BUTTONS_EXTRA = 32;
/** A screenshot preview: the thumbnail and two rows of buttons. */
export const SCREENSHOT_EXTRA_HEIGHT = 84;
/** A finished download: like a screenshot, with its size under the name. */
export const DOWNLOAD_EXTRA_HEIGHT = 102;
/** The drop area: this much taller than the closed notch. */
export const DROP_EXTRA_HEIGHT = 76;
/** The tour: its dots, title, up to three lines of text and its buttons. */
export const TOUR_EXTRA_HEIGHT = 124;

export interface OverlayState {
    /** Files are dragged near the notch. */
    dropping: boolean;
    /** The OSD shows. */
    osd: boolean;
    /** The message that shows, if any. */
    notification: Message | null;
    /** The state machine's mode, which keeps running underneath. */
    mode: NotchMode;
    /** A new song's title widens the closed notch. */
    peek: boolean;
    /** A home tile opened a page. */
    page: boolean;
    /** Home is open over the player. */
    homeOpen: boolean;
    /** A player is there. */
    player: boolean;
    /** The first-run tour holds the notch open. */
    tour: boolean;
}

/** The drop area over the OSD over a notification over the tour over the state machine's mode. */
export function drawnView(state: OverlayState): Drawn {
    if (state.dropping) return 'drop';
    if (state.osd) return 'osd';
    if (state.notification) return state.notification;
    if (state.tour) return 'tour';
    const { mode } = state;
    if (mode === 'collapsed' && state.peek) return 'peek';
    if (mode !== 'expanded') return mode;
    if (state.page) return 'page';
    return state.homeOpen || !state.player ? 'panel' : mode;
}

/** The views taller than the closed notch. */
function isTall(drawn: Drawn): boolean {
    return (
        drawn === 'expanded' ||
        drawn === 'panel' ||
        drawn === 'page' ||
        drawn === 'notification' ||
        drawn === 'screenshot' ||
        drawn === 'download' ||
        drawn === 'drop' ||
        drawn === 'tour'
    );
}

/** How the notch moves from `previous` to `mode`: opening, closing, or only changing width. */
export function resizeKind(previous: Drawn, mode: Drawn): 'open' | 'close' | 'width' {
    if (isTall(mode)) return 'open';
    return isTall(previous) ? 'close' : 'width';
}

/** The views that are alerts and keep the glow. */
export function showsAlert(drawn: Drawn): boolean {
    return drawn === 'osd' || drawn === 'notification' || drawn === 'screenshot' || drawn === 'download';
}

export interface SizeInput {
    appearance: {
        height: number;
        idleWidth: number;
        playingWidth: number;
        expandedWidth: number;
        expandedHeight: number;
        osdWidth: number;
    };
    /** The notification that shows has a row of buttons. */
    notificationButtons: boolean;
    /** Home's height for the rows it shows. */
    panelHeight: number;
    /** The open page's height. */
    pageHeight: number;
    /** What the open player adds under its controls: the lyrics and the shelf row. */
    expandedExtra: number;
}

/** The size, width then height, of the view drawn for `mode`. */
export function viewSize(mode: Drawn, input: SizeInput): [number, number] {
    const a = input.appearance;
    switch (mode) {
        case 'osd':
            return [a.osdWidth, a.height];
        case 'notification': {
            const buttons = input.notificationButtons ? NOTIFICATION_BUTTONS_EXTRA : 0;
            return [a.expandedWidth, a.height + NOTIFICATION_EXTRA_HEIGHT + buttons];
        }
        case 'screenshot':
            return [a.expandedWidth, a.height + SCREENSHOT_EXTRA_HEIGHT];
        case 'download':
            return [a.expandedWidth, a.height + DOWNLOAD_EXTRA_HEIGHT];
        case 'drop':
            return [a.expandedWidth, a.height + DROP_EXTRA_HEIGHT];
        case 'tour':
            return [a.expandedWidth, a.height + TOUR_EXTRA_HEIGHT];
        case 'panel':
            return [a.expandedWidth, input.panelHeight];
        case 'page':
            return [a.expandedWidth, input.pageHeight];
        case 'expanded':
            return [a.expandedWidth, a.expandedHeight + input.expandedExtra];
        case 'peek':
            return [a.expandedWidth, a.height];
        case 'collapsed':
            return [a.playingWidth, a.height];
        case 'idle':
            return [a.idleWidth, a.height];
    }
}
