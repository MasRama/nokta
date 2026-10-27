import Clutter from 'gi://Clutter';
import type Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import type St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import { LyricLine, type LyricsClient, visibleLyric } from './features/lyrics/index.js';
import { CollapsedMediaView, ExpandedMediaView, type MediaClient } from './features/media/index.js';
import { OsdTimer, OsdView, type OsdContent } from './features/osd/index.js';
import type { SettingsClient } from './features/settings/index.js';
import { IdleClock } from './shared/clock.js';
import { accentFor, withAlpha } from './shared/logic/color.js';
import { msUntilLine, nextLineStartUs } from './shared/logic/lyrics.js';
import { NotchMachine, type NotchMode } from './shared/logic/machine.js';
import { extrapolatePosition } from './shared/logic/position.js';
import { type MonitorArea, Notch } from './shared/notch.js';
import { glibSchedule } from './shared/schedule.js';

const TICK_MS = 250;

/** What the notch draws: the state machine's mode, or the OSD over it. */
type Drawn = NotchMode | 'osd';

/** The clients every notch reads; owned by the session. */
export interface NotchSources {
    settings: SettingsClient;
    media: MediaClient;
    lyrics: LyricsClient;
}

/**
 * The notch on one monitor: its views, hover state machine, OSD and timers.
 * destroy() removes everything it created.
 */
export class MonitorNotch {
    private readonly notch: Notch;
    private readonly clock = new IdleClock();
    private readonly collapsed = new CollapsedMediaView();
    private readonly expanded: ExpandedMediaView;
    private readonly lyricLine = new LyricLine();
    private readonly osdView = new OsdView();
    private readonly machine: NotchMachine;
    private readonly osdTimer: OsdTimer;
    private readonly views: Record<Drawn, St.Widget>;
    private readonly hoverId: number;
    private readonly destroyId: number;
    private destroyed = false;
    private drawn: Drawn = 'idle';
    private tickId = 0;
    private lyricTimerId = 0;

    constructor(
        readonly monitorIndex: number,
        area: MonitorArea,
        private readonly sources: NotchSources,
    ) {
        const { settings, media } = sources;
        this.notch = new Notch(settings.appearance);
        this.expanded = new ExpandedMediaView(media);
        this.expanded.infoBox.add_child(this.lyricLine.actor);
        this.views = {
            idle: this.clock.actor,
            collapsed: this.collapsed.actor,
            expanded: this.expanded.actor,
            osd: this.osdView.actor,
        };
        for (const [mode, actor] of Object.entries(this.views)) {
            actor.x_align = Clutter.ActorAlign.CENTER;
            actor.y_align = Clutter.ActorAlign.START;
            actor.visible = mode === 'idle';
            this.notch.body.add_child(actor);
        }
        this.machine = new NotchMachine(
            glibSchedule,
            () => ({ openMs: settings.behavior.openDelayMs, closeMs: settings.behavior.closeDelayMs }),
            (mode) => this.onMode(mode),
        );
        this.osdTimer = new OsdTimer(
            glibSchedule,
            () => settings.behavior.osdDurationMs,
            (active) => this.draw(active ? 'osd' : this.machine.mode),
        );

        Main.layoutManager.addTopChrome(this.notch.actor, { affectsStruts: false, trackFullscreen: true });
        this.hoverId = this.notch.actor.connect('notify::hover', () => this.machine.pointer(this.notch.actor.hover));
        // GNOME 50 and later destroy the notch themselves when the shell
        // shuts down, while the clients may still report changes.
        this.destroyId = this.notch.actor.connect('destroy', () => this.destroy());
        this.notch.setMonitor(area);
        this.applyViewSizes();
        const [width, height] = this.sizeFor('idle');
        this.notch.jumpTo(width, height);
        this.applyClockOptions();
        this.clock.start();
        this.applyOsdColors();
        this.onMedia();
    }

    /** False while a fullscreen app on this monitor hides the notch. */
    get visible(): boolean {
        return !this.destroyed && this.notch.actor.visible;
    }

    destroy(): void {
        if (this.destroyed) return;
        this.destroyed = true;
        this.machine.destroy();
        this.osdTimer.destroy();
        this.stopTimers();
        this.notch.actor.disconnect(this.hoverId);
        this.notch.actor.disconnect(this.destroyId);
        this.osdView.destroy();
        this.clock.destroy();
        this.lyricLine.destroy();
        this.collapsed.destroy();
        this.expanded.destroy();
        Main.layoutManager.removeChrome(this.notch.actor);
        this.notch.destroy();
    }

    onMedia(): void {
        if (this.destroyed) return;
        const snapshot = this.sources.media.snapshot();
        const { useAlbumAccent, foreground, accent: fallback } = this.sources.settings.appearance;
        const accent = accentFor(useAlbumAccent, snapshot.accentColor, fallback);
        this.collapsed.update(snapshot, accent);
        this.collapsed.setActive(this.drawn === 'collapsed', snapshot);
        this.expanded.update(snapshot);
        this.expanded.progress.setColors(accent, withAlpha(foreground, 0.25));
        this.machine.setAvailable(snapshot.available);
        this.tick();
        this.updateTimers();
    }

    onLyrics(): void {
        if (this.destroyed) return;
        this.tick();
        this.updateTimers();
    }

    applySettings(): void {
        if (this.destroyed) return;
        this.notch.setAppearance(this.sources.settings.appearance);
        this.applyViewSizes();
        const [width, height] = this.sizeFor(this.drawn);
        this.notch.resizeTo(width, height, 'width');
        this.applyOsdColors();
        this.applyClockOptions();
        this.onMedia();
    }

    /** `durationMs` replaces osd_duration_ms, for device alerts. */
    showOsd(content: OsdContent, icon: Gio.Icon | null, durationMs?: number): void {
        if (this.destroyed) return;
        this.osdView.show(content, icon, this.osdTimer.active, this.sources.settings.appearance.animationSpeed);
        this.osdTimer.show(durationMs);
    }

    hideOsd(): void {
        if (this.destroyed) return;
        this.osdTimer.hide();
    }

    // State

    /** The state machine keeps running under the OSD; it is drawn when the OSD ends. */
    private onMode(mode: NotchMode): void {
        if (!this.osdTimer.active) this.draw(mode);
    }

    private draw(mode: Drawn): void {
        const previous = this.drawn;
        if (mode === previous) return;
        this.drawn = mode;
        const [width, height] = this.sizeFor(mode);
        const kind = mode === 'expanded' ? 'open' : previous === 'expanded' ? 'close' : 'width';
        this.notch.resizeTo(width, height, kind);
        this.showView(mode);
        if (mode === 'idle') this.clock.start();
        else this.clock.stop();
        this.collapsed.setActive(mode === 'collapsed', this.sources.media.snapshot());
        if (mode === 'expanded') {
            this.sources.media.refreshPosition();
            this.tick();
        }
        this.updateTimers();
    }

    // Views

    private sizeFor(mode: Drawn): [number, number] {
        const a = this.sources.settings.appearance;
        if (mode === 'osd') return [a.osdWidth, a.height];
        if (mode === 'expanded') return [a.expandedWidth, a.expandedHeight];
        return [mode === 'collapsed' ? a.playingWidth : a.idleWidth, a.height];
    }

    /** Each view keeps its final size, so text never reflows while resizing. */
    private applyViewSizes(): void {
        for (const [mode, actor] of Object.entries(this.views)) {
            const [width, height] = this.sizeFor(mode as Drawn);
            actor.set_size(width, height);
        }
    }

    private applyOsdColors(): void {
        const { foreground, accent } = this.sources.settings.appearance;
        this.osdView.setColors(accent, withAlpha(foreground, 0.25));
    }

    private applyClockOptions(): void {
        const { clockFormat, showClock } = this.sources.settings.behavior;
        this.clock.setOptions(clockFormat, showClock);
    }

    /** Fades the old content out and the new one in, sliding slightly. */
    private showView(mode: Drawn): void {
        const speed = this.sources.settings.appearance.animationSpeed;
        for (const [name, actor] of Object.entries(this.views)) {
            actor.remove_all_transitions();
            if (name === mode) {
                actor.show();
                actor.opacity = 0;
                actor.translation_y = -4;
                actor.ease({
                    opacity: 255,
                    translation_y: 0,
                    delay: Math.round(80 * speed),
                    duration: Math.round(180 * speed),
                    mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                });
            } else if (actor.visible) {
                actor.ease({
                    opacity: 0,
                    duration: Math.round(100 * speed),
                    mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                    onComplete: () => {
                        if (this.drawn !== name) actor.hide();
                    },
                });
            }
        }
    }

    // Timers: only while expanded and playing (spec 6.5).

    private positionNow(): number {
        const s = this.sources.media.snapshot();
        return extrapolatePosition(
            {
                positionUs: s.positionUs,
                timestampUs: s.positionTimestampUs,
                rate: s.rate,
                playing: s.playbackStatus === 'Playing',
                lengthUs: s.lengthUs,
            },
            GLib.get_monotonic_time(),
        );
    }

    private tick(): void {
        if (this.drawn !== 'expanded') return;
        const { media, lyrics, settings } = this.sources;
        const snapshot = media.snapshot();
        const position = this.positionNow();
        this.expanded.progress.update(position, snapshot.lengthUs, snapshot.canSeek);
        this.lyricLine.show(visibleLyric(lyrics.status, lyrics.lines, settings.behavior.showLyrics, position));
    }

    private updateTimers(): void {
        const run = this.drawn === 'expanded' && this.sources.media.snapshot().playbackStatus === 'Playing';
        if (run && !this.tickId) {
            this.tickId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, TICK_MS, () => {
                this.tick();
                return GLib.SOURCE_CONTINUE;
            });
        } else if (!run && this.tickId) {
            GLib.source_remove(this.tickId);
            this.tickId = 0;
        }
        this.scheduleLyricTimer(run);
    }

    /** One exact timeout for the next lyric line, so lines change on time. */
    private scheduleLyricTimer(run: boolean): void {
        if (this.lyricTimerId) GLib.source_remove(this.lyricTimerId);
        this.lyricTimerId = 0;
        const { media, lyrics, settings } = this.sources;
        if (!run || !settings.behavior.showLyrics || lyrics.status !== 'synced') return;
        const position = this.positionNow();
        const next = nextLineStartUs(lyrics.lines, position);
        if (next === null) return;
        const delay = msUntilLine(next, position, media.snapshot().rate);
        this.lyricTimerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, delay, () => {
            this.lyricTimerId = 0;
            this.tick();
            this.scheduleLyricTimer(true);
            return GLib.SOURCE_REMOVE;
        });
    }

    private stopTimers(): void {
        if (this.tickId) GLib.source_remove(this.tickId);
        if (this.lyricTimerId) GLib.source_remove(this.lyricTimerId);
        this.tickId = 0;
        this.lyricTimerId = 0;
    }
}
