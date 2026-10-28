/** MPRIS LoopStatus. */
export type LoopStatus = 'None' | 'Track' | 'Playlist';

/** A shuffle or repeat button: its icon, and whether it is on (off is dimmed). */
export interface ToggleIcon {
    icon: string;
    on: boolean;
}

const REPEAT_ICON = 'media-playlist-repeat-symbolic';
const REPEAT_ONE_ICON = 'media-playlist-repeat-song-symbolic';
const SHUFFLE_ICON = 'media-playlist-shuffle-symbolic';

export const loopStatusFrom = (value: unknown): LoopStatus =>
    value === 'Track' || value === 'Playlist' ? value : 'None';

/** What a click on repeat asks for: None, then Playlist, then Track. */
export function nextLoopStatus(status: LoopStatus): LoopStatus {
    if (status === 'None') return 'Playlist';
    if (status === 'Playlist') return 'Track';
    return 'None';
}

export function loopIcon(status: LoopStatus): ToggleIcon {
    return { icon: status === 'Track' ? REPEAT_ONE_ICON : REPEAT_ICON, on: status !== 'None' };
}

export const shuffleIcon = (on: boolean): ToggleIcon => ({ icon: SHUFFLE_ICON, on });
