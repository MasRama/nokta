import Clutter from 'gi://Clutter';
import Meta from 'gi://Meta';
import type St from 'gi://St';

/*
 * The few places where GNOME Shell 46 to 51 differ. Each helper checks for
 * the feature, never the version, so a patched shell still takes the right
 * path.
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

interface WithUnredirect {
    disable_unredirect?: () => void;
    enable_unredirect?: () => void;
}

/**
 * Stops a fullscreen window from bypassing the compositor, so the shell's
 * actors show over it: the compositor's method from GNOME 48, Meta's
 * function before. Mutter counts the calls; pair each with enableUnredirect().
 */
export function disableUnredirect(): void {
    const compositor = global.compositor as unknown as WithUnredirect | undefined;
    if (compositor?.disable_unredirect) compositor.disable_unredirect();
    else Meta.disable_unredirect_for_display(global.display);
}

/** Undoes one disableUnredirect(). */
export function enableUnredirect(): void {
    const compositor = global.compositor as unknown as WithUnredirect | undefined;
    if (compositor?.enable_unredirect) compositor.enable_unredirect();
    else Meta.enable_unredirect_for_display(global.display);
}
