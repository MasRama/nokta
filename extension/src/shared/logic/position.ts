/** A position snapshot from io.nokta.Media1 plus what is needed to move it forward. */
export interface PositionSnapshot {
    positionUs: number;
    /** CLOCK_MONOTONIC in µs when positionUs was read (GLib.get_monotonic_time()). */
    timestampUs: number;
    rate: number;
    playing: boolean;
    /** 0 when the track length is unknown. */
    lengthUs: number;
}

/** The position at `nowUs`, without asking the player. */
export function extrapolatePosition(s: PositionSnapshot, nowUs: number): number {
    const elapsed = s.playing ? Math.max(0, nowUs - s.timestampUs) * s.rate : 0;
    const position = s.positionUs + elapsed;
    const capped = s.lengthUs > 0 ? Math.min(position, s.lengthUs) : position;
    return Math.max(0, capped);
}
