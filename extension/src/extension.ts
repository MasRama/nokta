import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import type St from 'gi://St';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import { LyricLine, LyricsClient, visibleLyric } from './features/lyrics/index.js';
import { CollapsedMediaView, ExpandedMediaView, MediaClient } from './features/media/index.js';
import {
    CapsLockWatcher,
    capsLockContent,
    osdContent,
    OsdTimer,
    OsdView,
    takeOverOsd,
    type OsdContent,
    type OsdRequest,
} from './features/osd/index.js';
import { SettingsClient } from './features/settings/client.js';
import { IdleClock } from './shared/clock.js';
import { API_VERSION } from './shared/contracts.js';
import { readApiVersion, unwatchDaemon, watchDaemon } from './shared/dbus.js';
import { accentFor, withAlpha } from './shared/logic/color.js';
import { msUntilLine, nextLineStartUs } from './shared/logic/lyrics.js';
import { NotchMachine, type NotchMode, type Scheduler } from './shared/logic/machine.js';
import { extrapolatePosition } from './shared/logic/position.js';
import { Notch } from './shared/notch.js';
import { moveDateMenuRight, type Restore } from './shared/topbar.js';

const TICK_MS = 250;
const CAPS_LOCK_ICON = 'input-keyboard-symbolic';

/** What the notch draws: the state machine's mode, or the OSD over it. */
type Drawn = NotchMode | 'osd';

const isCancelled = (error: unknown): boolean =>
    error instanceof GLib.Error && error.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED);

const glibSchedule: Scheduler = (ms, fn) => {
    let id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
        id = 0;
        fn();
        return GLib.SOURCE_REMOVE;
    });
    return () => {
        if (id) GLib.source_remove(id);
        id = 0;
    };
};

let warnedApiVersion = false;

/** Everything one enable() creates; destroy() undoes all of it. */
class Session {
    private readonly settings: SettingsClient;
    private readonly media = new MediaClient();
    private readonly lyrics = new LyricsClient();
    private readonly notch: Notch;
    private readonly clock = new IdleClock();
    private readonly collapsed = new CollapsedMediaView();
    private readonly expanded: ExpandedMediaView;
    private readonly lyricLine = new LyricLine();
    private readonly osdView = new OsdView();
    private readonly machine: NotchMachine;
    private readonly osdTimer: OsdTimer;
    private readonly views: Record<Drawn, St.Widget>;
    private readonly monitorsId: number;
    private readonly hoverId: number;
    private readonly mediaId: number;
    private readonly lyricsId: number;
    private readonly watchId: number;
    private cancellable = new Gio.Cancellable();
    private restoreClock: Restore | null = null;
    private restoreOsd: Restore | null = null;
    private capsLock: CapsLockWatcher | null = null;
    private drawn: Drawn = 'idle';
    private tickId = 0;
    private lyricTimerId = 0;

    constructor() {
        this.settings = new SettingsClient(() => this.applySettings());
        this.notch = new Notch(this.settings.appearance);
        this.expanded = new ExpandedMediaView(this.media);
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
            () => ({ openMs: this.settings.behavior.openDelayMs, closeMs: this.settings.behavior.closeDelayMs }),
            (mode) => this.onMode(mode),
        );
        this.osdTimer = new OsdTimer(
            glibSchedule,
            () => this.settings.behavior.osdDurationMs,
            (active) => this.draw(active ? 'osd' : this.machine.mode),
        );

        Main.layoutManager.addTopChrome(this.notch.actor, { affectsStruts: false, trackFullscreen: true });
        this.monitorsId = Main.layoutManager.connect('monitors-changed', () => this.placeOnMonitor());
        this.hoverId = this.notch.actor.connect('notify::hover', () => this.machine.pointer(this.notch.actor.hover));
        this.mediaId = this.media.onChanged(() => this.onMedia());
        this.lyricsId = this.lyrics.onChanged(() => this.onLyrics());
        this.placeOnMonitor();
        this.applyViewSizes();
        const [width, height] = this.sizeFor('idle');
        this.notch.jumpTo(width, height);
        this.clock.start();
        this.applyClockPosition();
        this.applyOsdSettings();
        this.watchId = watchDaemon(
            (connection) => this.onDaemonAppeared(connection),
            () => this.onDaemonVanished(),
        );
    }

    destroy(): void {
        unwatchDaemon(this.watchId);
        this.cancellable.cancel();
        this.machine.destroy();
        this.osdTimer.destroy();
        this.stopTimers();
        this.notch.actor.disconnect(this.hoverId);
        this.media.disconnect(this.mediaId);
        this.lyrics.disconnect(this.lyricsId);
        this.media.destroy();
        this.lyrics.destroy();
        this.settings.detach();
        Main.layoutManager.disconnect(this.monitorsId);
        this.restoreClock?.();
        this.restoreClock = null;
        this.restoreOsd?.();
        this.restoreOsd = null;
        this.capsLock?.destroy();
        this.capsLock = null;
        this.osdView.destroy();
        this.clock.destroy();
        this.lyricLine.destroy();
        this.collapsed.destroy();
        this.expanded.destroy();
        Main.layoutManager.removeChrome(this.notch.actor);
        this.notch.destroy();
    }

    // Daemon

    private onDaemonAppeared(connection: Gio.DBusConnection): void {
        this.connect(connection, this.cancellable).catch((error: unknown) => {
            if (!isCancelled(error)) console.error('Nokta: cannot talk to noktad', error);
        });
    }

    private async connect(connection: Gio.DBusConnection, cancellable: Gio.Cancellable): Promise<void> {
        const version = await readApiVersion(connection, cancellable);
        if (version !== API_VERSION) {
            if (!warnedApiVersion) {
                console.warn(
                    `Nokta: noktad speaks API version ${version}, this extension needs ${API_VERSION}. ` +
                        'Update Nokta so the daemon and the extension match.',
                );
                warnedApiVersion = true;
            }
            return;
        }
        await Promise.all([
            this.settings.attach(connection, cancellable),
            this.media.attach(connection, cancellable),
            this.lyrics.attach(connection, cancellable),
        ]);
    }

    private onDaemonVanished(): void {
        this.cancellable.cancel();
        this.cancellable = new Gio.Cancellable();
        this.settings.detach();
        this.media.detach();
        this.lyrics.detach();
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
        this.collapsed.setActive(mode === 'collapsed', this.media.snapshot());
        if (mode === 'expanded') {
            this.media.refreshPosition();
            this.tick();
        }
        this.updateTimers();
    }

    private onMedia(): void {
        const snapshot = this.media.snapshot();
        const { useAlbumAccent, foreground } = this.settings.appearance;
        const accent = accentFor(useAlbumAccent, snapshot.accentColor, foreground);
        this.collapsed.update(snapshot, accent);
        this.collapsed.setActive(this.drawn === 'collapsed', snapshot);
        this.expanded.update(snapshot);
        this.expanded.progress.setColors(accent, withAlpha(foreground, 0.25));
        this.machine.setAvailable(snapshot.available);
        this.tick();
        this.updateTimers();
    }

    private onLyrics(): void {
        this.tick();
        this.updateTimers();
    }

    private applySettings(): void {
        this.notch.setAppearance(this.settings.appearance);
        this.applyViewSizes();
        const [width, height] = this.sizeFor(this.drawn);
        this.notch.resizeTo(width, height, 'width');
        this.applyClockPosition();
        this.applyOsdSettings();
        this.onMedia();
    }

    // Views

    private sizeFor(mode: Drawn): [number, number] {
        const a = this.settings.appearance;
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

    /** Fades the old content out and the new one in, sliding slightly. */
    private showView(mode: Drawn): void {
        const speed = this.settings.appearance.animationSpeed;
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
        const s = this.media.snapshot();
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
        const snapshot = this.media.snapshot();
        const position = this.positionNow();
        this.expanded.progress.update(position, snapshot.lengthUs, snapshot.canSeek);
        this.lyricLine.show(visibleLyric(this.lyrics.status, this.lyrics.lines, this.settings.behavior.showLyrics, position));
    }

    private updateTimers(): void {
        const run = this.drawn === 'expanded' && this.media.snapshot().playbackStatus === 'Playing';
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
        if (!run || !this.settings.behavior.showLyrics || this.lyrics.status !== 'synced') return;
        const position = this.positionNow();
        const next = nextLineStartUs(this.lyrics.lines, position);
        if (next === null) return;
        const delay = msUntilLine(next, position, this.media.snapshot().rate);
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

    // OSD (spec v0.2)

    private showOsd(content: OsdContent, icon: Gio.Icon | null): void {
        this.osdView.show(content, icon, this.osdTimer.active, this.settings.appearance.animationSpeed);
        this.osdTimer.show();
    }

    private onOsdRequest(request: OsdRequest): void {
        this.showOsd(osdContent(request.level, request.maxLevel, request.label), request.icon);
    }

    private applyOsdSettings(): void {
        const { foreground } = this.settings.appearance;
        this.osdView.setColors(foreground, withAlpha(foreground, 0.25));
        const { replaceOsd, showCapsLock } = this.settings.behavior;
        if (replaceOsd && !this.restoreOsd) {
            this.restoreOsd = takeOverOsd({
                // A fullscreen app hides the notch; the lock screen covers it.
                wanted: () => this.notch.actor.visible && !Main.sessionMode.isLocked,
                show: (request) => this.onOsdRequest(request),
                hideAll: () => this.osdTimer.hide(),
            });
        } else if (!replaceOsd && this.restoreOsd) {
            this.restoreOsd();
            this.restoreOsd = null;
        }
        if (showCapsLock && !this.capsLock) {
            this.capsLock = new CapsLockWatcher((on) => {
                if (this.notch.actor.visible) this.showOsd(capsLockContent(on), new Gio.ThemedIcon({ name: CAPS_LOCK_ICON }));
            });
        } else if (!showCapsLock && this.capsLock) {
            this.capsLock.destroy();
            this.capsLock = null;
        }
    }

    // Shell

    private applyClockPosition(): void {
        const wanted = this.settings.behavior.moveClock;
        if (wanted && !this.restoreClock) {
            this.restoreClock = moveDateMenuRight();
        } else if (!wanted && this.restoreClock) {
            this.restoreClock();
            this.restoreClock = null;
        }
    }

    private placeOnMonitor(): void {
        const monitor = Main.layoutManager.primaryMonitor;
        if (monitor) this.notch.setMonitor({ x: monitor.x, y: monitor.y, width: monitor.width });
    }
}

export default class NoktaExtension extends Extension {
    private session: Session | null = null;

    override enable(): void {
        this.session = new Session();
    }

    override disable(): void {
        this.session?.destroy();
        this.session = null;
    }
}
