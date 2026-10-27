import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import type St from 'gi://St';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import { CollapsedMediaView, ExpandedMediaView, MediaClient } from './features/media/index.js';
import { SettingsClient } from './features/settings/client.js';
import { IdleClock } from './shared/clock.js';
import { API_VERSION } from './shared/contracts.js';
import { readApiVersion, unwatchDaemon, watchDaemon } from './shared/dbus.js';
import { accentFor, withAlpha } from './shared/logic/color.js';
import { NotchMachine, type NotchMode, type Scheduler } from './shared/logic/machine.js';
import { extrapolatePosition } from './shared/logic/position.js';
import { Notch } from './shared/notch.js';
import { moveDateMenuRight, type Restore } from './shared/topbar.js';

const TICK_MS = 250;

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
    private readonly notch: Notch;
    private readonly clock = new IdleClock();
    private readonly collapsed = new CollapsedMediaView();
    private readonly expanded: ExpandedMediaView;
    private readonly machine: NotchMachine;
    private readonly views: Record<NotchMode, St.Widget>;
    private readonly monitorsId: number;
    private readonly hoverId: number;
    private readonly mediaId: number;
    private readonly watchId: number;
    private cancellable = new Gio.Cancellable();
    private restoreClock: Restore | null = null;
    private tickId = 0;

    constructor() {
        this.settings = new SettingsClient(() => this.applySettings());
        this.notch = new Notch(this.settings.appearance);
        this.expanded = new ExpandedMediaView(this.media);
        this.views = { idle: this.clock.actor, collapsed: this.collapsed.actor, expanded: this.expanded.actor };
        for (const [mode, actor] of Object.entries(this.views)) {
            actor.x_align = Clutter.ActorAlign.CENTER;
            actor.y_align = Clutter.ActorAlign.START;
            actor.visible = mode === 'idle';
            this.notch.body.add_child(actor);
        }
        this.machine = new NotchMachine(
            glibSchedule,
            () => ({ openMs: this.settings.behavior.openDelayMs, closeMs: this.settings.behavior.closeDelayMs }),
            (mode, previous) => this.onMode(mode, previous),
        );

        Main.layoutManager.addTopChrome(this.notch.actor, { affectsStruts: false, trackFullscreen: true });
        this.monitorsId = Main.layoutManager.connect('monitors-changed', () => this.placeOnMonitor());
        this.hoverId = this.notch.actor.connect('notify::hover', () => this.machine.pointer(this.notch.actor.hover));
        this.mediaId = this.media.onChanged(() => this.onMedia());
        this.placeOnMonitor();
        this.applyViewSizes();
        const [width, height] = this.sizeFor('idle');
        this.notch.jumpTo(width, height);
        this.clock.start();
        this.applyClockPosition();
        this.watchId = watchDaemon(
            (connection) => this.onDaemonAppeared(connection),
            () => this.onDaemonVanished(),
        );
    }

    destroy(): void {
        unwatchDaemon(this.watchId);
        this.cancellable.cancel();
        this.machine.destroy();
        this.stopTimers();
        this.notch.actor.disconnect(this.hoverId);
        this.media.disconnect(this.mediaId);
        this.media.destroy();
        this.settings.detach();
        Main.layoutManager.disconnect(this.monitorsId);
        this.restoreClock?.();
        this.restoreClock = null;
        this.clock.destroy();
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
        ]);
    }

    private onDaemonVanished(): void {
        this.cancellable.cancel();
        this.cancellable = new Gio.Cancellable();
        this.settings.detach();
        this.media.detach();
    }

    // State

    private onMode(mode: NotchMode, previous: NotchMode): void {
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
        this.collapsed.setActive(this.machine.mode === 'collapsed', snapshot);
        this.expanded.update(snapshot);
        this.expanded.progress.setColors(accent, withAlpha(foreground, 0.25));
        this.machine.setAvailable(snapshot.available);
        this.tick();
        this.updateTimers();
    }

    private applySettings(): void {
        this.notch.setAppearance(this.settings.appearance);
        this.applyViewSizes();
        const [width, height] = this.sizeFor(this.machine.mode);
        this.notch.resizeTo(width, height, 'width');
        this.applyClockPosition();
        this.onMedia();
    }

    // Views

    private sizeFor(mode: NotchMode): [number, number] {
        const a = this.settings.appearance;
        if (mode === 'expanded') return [a.expandedWidth, a.expandedHeight];
        return [mode === 'collapsed' ? a.playingWidth : a.idleWidth, a.height];
    }

    /** Each view keeps its final size, so text never reflows while resizing. */
    private applyViewSizes(): void {
        for (const [mode, actor] of Object.entries(this.views)) {
            const [width, height] = this.sizeFor(mode as NotchMode);
            actor.set_size(width, height);
        }
    }

    /** Fades the old content out and the new one in, sliding slightly. */
    private showView(mode: NotchMode): void {
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
                        if (this.machine.mode !== name) actor.hide();
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
        if (this.machine.mode !== 'expanded') return;
        const snapshot = this.media.snapshot();
        const position = this.positionNow();
        this.expanded.progress.update(position, snapshot.lengthUs, snapshot.canSeek);
    }

    private updateTimers(): void {
        const run = this.machine.mode === 'expanded' && this.media.snapshot().playbackStatus === 'Playing';
        if (run && !this.tickId) {
            this.tickId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, TICK_MS, () => {
                this.tick();
                return GLib.SOURCE_CONTINUE;
            });
        } else if (!run && this.tickId) {
            GLib.source_remove(this.tickId);
            this.tickId = 0;
        }
    }

    private stopTimers(): void {
        if (this.tickId) GLib.source_remove(this.tickId);
        this.tickId = 0;
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
