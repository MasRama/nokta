import type { LoopStatus } from '@ext/features/media/logic/loop.js';
import { EMPTY_SNAPSHOT, snapshotFrom, type MediaSnapshot } from '@ext/features/media/logic/snapshot.js';
import type { LyricLines } from '@ext/shared/logic/lyrics.js';
import { extrapolatePosition } from '@ext/shared/logic/position.js';

import type { Bridge, Props } from './bridge/bridge.js';

const MEDIA = 'Media1';
const LYRICS = 'Lyrics1';

/** The clock `PositionTimestampUs` is on in the app: the wall clock, in µs. */
export function nowUs(): number {
    return Date.now() * 1000;
}

/** Follows an interface's properties: all of them first, then each change. */
class Follower {
    protected props: Props = {};
    private stop: (() => void) | null = null;

    constructor(
        protected readonly bridge: Bridge,
        private readonly iface: string,
        private readonly onChanged: () => void,
    ) {}

    async attach(): Promise<void> {
        this.stop = this.bridge.onChanged(this.iface, (changed) => {
            this.props = { ...this.props, ...changed };
            this.read();
            this.onChanged();
        });
        this.props = { ...(await this.bridge.props(this.iface)), ...this.props };
        this.read();
        this.onChanged();
    }

    detach(): void {
        this.stop?.();
        this.stop = null;
    }

    protected read(): void {}

    protected call(method: string, ...args: unknown[]): void {
        this.bridge.call(this.iface, method, ...args).catch((err: unknown) => console.warn(`${this.iface}.${method}:`, err));
    }
}

/** Media1: the active player and its controls, the page's MediaClient. */
export class Media extends Follower {
    snapshot: MediaSnapshot = { ...EMPTY_SNAPSHOT };

    constructor(bridge: Bridge, onChanged: () => void) {
        super(bridge, MEDIA, onChanged);
    }

    /** Where the track is at `now` (µs on the wall clock), without asking the player. */
    positionNow(now = nowUs()): number {
        const s = this.snapshot;
        return extrapolatePosition(
            {
                positionUs: s.positionUs,
                timestampUs: s.positionTimestampUs,
                rate: s.rate,
                playing: s.playbackStatus === 'Playing',
                lengthUs: s.lengthUs,
            },
            now,
        );
    }

    /** The music's band levels; Windows has none yet, so the bars follow a pattern. */
    levels(): readonly number[] | null {
        return null;
    }

    playPause(): void {
        this.call('PlayPause');
    }

    next(): void {
        this.call('Next');
    }

    previous(): void {
        this.call('Previous');
    }

    setPosition(us: number): void {
        this.call('SetPosition', Math.round(us));
    }

    selectPlayer(id: string): void {
        this.call('SelectPlayer', id);
    }

    setShuffle(on: boolean): void {
        this.call('SetShuffle', on);
    }

    setLoopStatus(status: LoopStatus): void {
        this.call('SetLoopStatus', status);
    }

    refreshPosition(): void {
        this.call('RefreshPosition');
    }

    protected override read(): void {
        const props = this.props;
        this.snapshot = snapshotFrom((name) => props[name]);
    }
}

const isLine = (v: unknown): v is [number, string] =>
    Array.isArray(v) && v.length === 2 && typeof v[0] === 'number' && typeof v[1] === 'string';

/** Lyrics1: the synced lyrics of the active track. */
export class Lyrics extends Follower {
    status = 'none';
    lines: LyricLines = [];
    /** The track's lyric timing, already applied to `lines`; positive is earlier. */
    offsetMs = 0;

    constructor(bridge: Bridge, onChanged: () => void) {
        super(bridge, LYRICS, onChanged);
    }

    setOffset(offsetMs: number): void {
        this.call('SetOffset', Math.round(offsetMs));
    }

    protected override read(): void {
        const { Status, Lines, OffsetMs } = this.props;
        this.status = typeof Status === 'string' ? Status : 'none';
        this.lines = Array.isArray(Lines) ? Lines.filter(isLine) : [];
        this.offsetMs = typeof OffsetMs === 'number' ? OffsetMs : 0;
    }
}
