export interface RouteInput {
    /** The request's monitor index; -1 when it names none. */
    requested: number;
    /** Monitor of the focused window, or under the pointer; -1 when unknown. */
    focused: number;
    primary: number;
    /** Monitors that have a notch. */
    notches: readonly number[];
}

export interface Route {
    /** The monitor the request is meant for; GNOME's popup goes here. */
    monitor: number;
    /** The notch to draw in, or null when there is none. */
    notch: number | null;
}

/** Where an OSD request shows. */
export function routeOsd({ requested, focused, primary, notches }: RouteInput): Route {
    const monitor = requested >= 0 ? requested : focused >= 0 ? focused : primary;
    if (notches.includes(monitor)) return { monitor, notch: monitor };
    return { monitor, notch: notches.includes(primary) ? primary : null };
}
