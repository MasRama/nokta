import Clutter from 'gi://Clutter';
import type St from 'gi://St';

/*
 * The few places where GNOME Shell 46 to 51 differ. Each helper checks for
 * the feature, never the version, so a patched shell still takes the right
 * path (GNOME versions spec, section 2).
 */

/** Lays `box` out top to bottom: `orientation` from GNOME 48, `vertical` before (gone in 51). */
export function setVertical<T extends St.BoxLayout>(box: T): T {
    if ('orientation' in box) {
        (box as unknown as { orientation: Clutter.Orientation }).orientation = Clutter.Orientation.VERTICAL;
    } else {
        (box as unknown as { vertical: boolean }).vertical = true;
    }
    return box;
}

interface WithContext {
    get_context?: () => { get_backend(): Clutter.Backend };
}

/** The default seat: through the stage's context from GNOME 48, the default backend before. */
export function defaultSeat(): Clutter.Seat {
    const stage = global.stage as unknown as WithContext;
    const backend = stage.get_context ? stage.get_context().get_backend() : Clutter.get_default_backend();
    return backend.get_default_seat();
}
