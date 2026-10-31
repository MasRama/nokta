import { freshLevels } from '@ext/features/media/logic/equalizer.js';
import type { LoopStatus } from '@ext/features/media/logic/loop.js';
import { EMPTY_SNAPSHOT, snapshotFrom, type MediaSnapshot } from '@ext/features/media/logic/snapshot.js';
import type { LyricLines } from '@ext/shared/logic/lyrics.js';
import { extrapolatePosition } from '@ext/shared/logic/position.js';

import type { Bridge } from './bridge/bridge.js';
import { Follower } from './follower.js';

const MEDIA = 'Media1';
const LYRICS = 'Lyrics1';

/** The clock `PositionTimestampUs` is on in the app: the wall clock, in µs. */
export function nowUs(): number {
    return Date.now() * 1000;
}

/** Media1: the active player and its controls, the page's MediaClient. */
export class Media extends Follower {
    snapshot: MediaSnapshot = { ...EMPTY_SNAPSHOT };
    private lastLevels: number[] | null = null;
    private levelsAtMs = 0;
    private stopLevels: (() => void) | null = null;

    constructor(bridge: Bridge, onChanged: () => void) {
        super(bridge, MEDIA, onChanged);
    }

    override async attach(): Promise<void> {
        this.stopLevels = this.bridge.onSignal(MEDIA, 'Levels', (levels) => {
            this.lastLevels = Array.isArray(levels) ? levels.filter((l): l is number => typeof l === 'number') : null;
            this.levelsAtMs = performance.now();
        });
        await super.attach();
    }

    override detach(): void {
        this.stopLevels?.();
        this.stopLevels = null;
        this.lastLevels = null;
        super.detach();
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

    /**
     * The music's band levels while the core keeps sending them (`[media]
     * real_equalizer`), else null and the bars follow a pattern. Read on
     * each equalizer step, so they notify no one.
     */
    levels(nowMs = performance.now()): readonly number[] | null {
        return freshLevels(this.lastLevels, this.levelsAtMs, nowMs);
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
