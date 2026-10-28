import Clutter from 'gi://Clutter';
import type Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import { ActivityBadge, type ActivitiesClient, type Activity } from './features/activities/index.js';
import { LyricLine, type LyricsClient, visibleLyric } from './features/lyrics/index.js';
import { CollapsedMediaView, ExpandedMediaView, type MediaClient } from './features/media/index.js';
import { NotificationTimer, NotificationView } from './features/notifications/index.js';
import { OsdTimer, OsdView, type OsdContent } from './features/osd/index.js';
import {
    IdlePanel,
    MAX_PANEL_ACTIVITIES,
    panelHeight,
    type PanelContent,
    type PanelRow,
} from './features/panel/index.js';
import { dotsFor, PrivacyDots, type PrivacyMonitor } from './features/privacy/index.js';
import type { SettingsClient } from './features/settings/index.js';
import { formatRemaining, phaseColor, remainingAt, TimerLabel, type TimerClient } from './features/timer/index.js';
import { IdleClock } from './shared/clock.js';
import { accentFor, withAlpha } from './shared/logic/color.js';
import { chooseIndicator, type Indicator } from './shared/logic/indicator.js';
import { msUntilLine, nextLineStartUs } from './shared/logic/lyrics.js';
import { NotchMachine, type NotchMode } from './shared/logic/machine.js';
import { extrapolatePosition } from './shared/logic/position.js';
import { type MonitorArea, Notch } from './shared/notch.js';
import { glibSchedule } from './shared/schedule.js';

const TICK_MS = 250;
/** The elapsed times in the open panel change once a second. */
const PANEL_TICK_MS = 1000;
/** A notification is two lines tall: this much taller than the closed notch. */
const NOTIFICATION_EXTRA_HEIGHT = 28;

/**
 * What the notch draws: the state machine's mode (the idle panel when it
 * opens without a player), or the OSD or a notification over it.
 */
type Drawn = NotchMode | 'panel' | 'osd' | 'notification';

/** What the idle panel shows and does; owned by the session. */
export interface PanelSource {
    content(): PanelContent;
    openNotifications(): void;
    toggleFocus(): void;
}

/** The clients every notch reads; owned by the session. */
export interface NotchSources {
    settings: SettingsClient;
    media: MediaClient;
    lyrics: LyricsClient;
    timer: TimerClient;
    activities: ActivitiesClient;
    privacy: PrivacyMonitor;
    panel: PanelSource;
}

/**
 * The notch on one monitor: its views, hover state machine, OSD and timers.
 * destroy() removes everything it created.
 */
export class MonitorNotch {
    private readonly notch: Notch;
    private readonly clock = new IdleClock();
    /** The clock, or the indicator: the timer while one is set, else the newest activity. */
    private readonly idle = new St.Widget({ layout_manager: new Clutter.BinLayout() });
    private readonly idleTimer = new TimerLabel();
    private readonly collapsedTimer = new TimerLabel();
    private readonly idleBadge = new ActivityBadge();
    private readonly collapsedBadge = new ActivityBadge();
    private indicator: Indicator | null = null;
    private readonly collapsed = new CollapsedMediaView();
    private readonly expanded: ExpandedMediaView;
    private readonly lyricLine = new LyricLine();
    private readonly osdView = new OsdView();
    private readonly notificationView = new NotificationView(() => this.onNotificationClick());
    private notificationClick: (() => void) | null = null;
    private readonly privacyDots = new PrivacyDots();
    private privacyCount = 0;
    private readonly idlePanel = new IdlePanel({
        openNotifications: () => this.onPanelClick(() => this.sources.panel.openNotifications()),
        toggleFocus: () => this.onPanelClick(() => this.sources.panel.toggleFocus()),
    });
    private readonly machine: NotchMachine;
    private readonly osdTimer: OsdTimer;
    private readonly notificationTimer: NotificationTimer;
    private readonly views: Record<Drawn, St.Widget>;
    private readonly hoverId: number;
    private readonly destroyId: number;
    private destroyed = false;
    private drawn: Drawn = 'idle';
    private tickId = 0;
    private lyricTimerId = 0;
    private panelTickId = 0;
    /** The panel's rows, as last shown. */
    private panelRows: PanelRow[] = ['date', 'buttons'];

    constructor(
        readonly monitorIndex: number,
        area: MonitorArea,
        private readonly sources: NotchSources,
    ) {
        const { settings, media } = sources;
        this.notch = new Notch(settings.appearance);
        this.expanded = new ExpandedMediaView(media);
        this.expanded.infoBox.add_child(this.lyricLine.actor);
        this.clock.actor.x_expand = true;
        this.clock.actor.y_expand = true;
        this.idle.add_child(this.clock.actor);
        this.idle.add_child(this.idleTimer.actor);
        this.idle.add_child(this.idleBadge.actor);
        this.idleTimer.actor.hide();
        this.idleBadge.actor.hide();
        this.views = {
            idle: this.idle,
            collapsed: this.collapsed.actor,
            expanded: this.expanded.actor,
            panel: this.idlePanel.actor,
            osd: this.osdView.actor,
            notification: this.notificationView.actor,
        };
        for (const [mode, actor] of Object.entries(this.views)) {
            actor.x_align = Clutter.ActorAlign.CENTER;
            actor.y_align = Clutter.ActorAlign.START;
            actor.visible = mode === 'idle';
            this.notch.body.add_child(actor);
        }
        // Last, so the dots stay above every view.
        this.notch.body.add_child(this.privacyDots.actor);
        this.machine = new NotchMachine(
            glibSchedule,
            () => ({ openMs: settings.behavior.openDelayMs, closeMs: settings.behavior.closeDelayMs }),
            () => this.onMode(),
        );
        this.osdTimer = new OsdTimer(
            glibSchedule,
            () => settings.behavior.osdDurationMs,
            () => this.draw(this.overlay()),
        );
        this.notificationTimer = new NotificationTimer(glibSchedule, () => this.draw(this.overlay()));

        Main.layoutManager.addTopChrome(this.notch.actor, { affectsStruts: false, trackFullscreen: true });
        this.hoverId = this.notch.actor.connect('notify::hover', () => {
            const { hover } = this.notch.actor;
            this.notificationTimer.pointer(hover);
            this.machine.pointer(hover);
        });
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
        this.onTimer();
        this.onActivities();
        this.onPrivacy();
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
        this.notificationTimer.destroy();
        this.notificationClick = null;
        this.stopTimers();
        this.notch.actor.disconnect(this.hoverId);
        this.notch.actor.disconnect(this.destroyId);
        this.osdView.destroy();
        this.notificationView.destroy();
        this.idlePanel.destroy();
        this.privacyDots.destroy();
        this.collapsed.setAside(null);
        this.idleTimer.destroy();
        this.collapsedTimer.destroy();
        this.idleBadge.destroy();
        this.collapsedBadge.destroy();
        this.clock.destroy();
        this.idle.destroy();
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
        // Open, a player coming or going swaps the media view and the idle panel.
        this.draw(this.overlay());
        this.tick();
        this.updateTimers();
    }

    /** Draws the time left; the session calls it on each change and each second. */
    onTimer(): void {
        if (this.destroyed) return;
        const timer = this.sources.timer.snapshot();
        const active = timer.state !== 'idle';
        if (active) {
            const text = formatRemaining(remainingAt(timer, GLib.get_monotonic_time()));
            const color = phaseColor(timer.phase);
            const paused = timer.state === 'paused';
            this.idleTimer.update(text, color, paused);
            this.collapsedTimer.update(text, color, paused);
        }
        if (this.drawn === 'panel') this.refreshPanel();
        this.applyIndicator();
    }

    /** The running activities changed, or the live_activities setting. */
    onActivities(): void {
        if (this.destroyed) return;
        const newest = this.liveActivities()[0];
        if (newest) {
            this.idleBadge.update(newest);
            this.collapsedBadge.update(newest);
        }
        if (this.drawn === 'panel') this.refreshPanel();
        this.applyIndicator();
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
        this.onActivities();
        this.onPrivacy();
    }

    onPrivacy(): void {
        if (this.destroyed) return;
        const { settings, privacy } = this.sources;
        const { height, cornerRadius } = settings.appearance;
        const dots = dotsFor(privacy.state(), settings.behavior.privacyDots);
        this.privacyCount = dots.length;
        this.collapsed.setInset(this.privacyDots.update(dots, height, cornerRadius));
        this.showPrivacyDots();
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

    /** A notification until its time runs out; a click calls `onClick` and closes it. */
    showNotification(title: string, detail: string, icon: Gio.Icon | null, durationMs: number, onClick: () => void): void {
        if (this.destroyed) return;
        this.notificationView.show(title, detail, icon);
        this.notificationClick = onClick;
        this.notificationTimer.show(durationMs);
    }

    hideNotification(): void {
        if (this.destroyed) return;
        this.notificationTimer.hide();
    }

    // State

    private liveActivities(): readonly Activity[] {
        return this.sources.settings.behavior.liveActivities ? this.sources.activities.list() : [];
    }

    /** The one spot in the closed notch: the clock or the indicator in idle, next to the cover while playing. */
    private applyIndicator(): void {
        const indicator = chooseIndicator({
            timer: this.sources.timer.snapshot().state !== 'idle',
            activity: this.liveActivities().length > 0,
            shelf: false,
        });
        if (indicator !== this.indicator) {
            this.indicator = indicator;
            this.clock.actor.visible = indicator === null;
            this.idleTimer.actor.visible = indicator === 'timer';
            this.idleBadge.actor.visible = indicator === 'activity';
            const aside = { timer: this.collapsedTimer.actor, activity: this.collapsedBadge.actor, shelf: null };
            this.collapsed.setAside(indicator ? aside[indicator] : null);
            this.collapsed.setActive(this.drawn === 'collapsed', this.sources.media.snapshot());
        }
        this.idleBadge.setActive(this.drawn === 'idle' && indicator === 'activity');
        this.collapsedBadge.setActive(this.drawn === 'collapsed' && indicator === 'activity');
    }

    /** Draws the panel's content; resizes the notch when its rows change while open. */
    private refreshPanel(): void {
        const content = this.sources.panel.content();
        this.idlePanel.show(content);
        const rows = panelRowsFor(content);
        if (rows.join() !== this.panelRows.join()) {
            this.panelRows = rows;
            const [width, height] = this.sizeFor('panel');
            this.idlePanel.actor.set_size(width, height);
            if (this.drawn === 'panel') this.notch.resizeTo(width, height, 'width');
        }
        this.updatePanelTick();
    }

    /** Once a second while the open panel shows an activity's elapsed time. */
    private updatePanelTick(): void {
        const run = this.drawn === 'panel' && this.panelRows.includes('activity');
        if (run && !this.panelTickId) {
            this.panelTickId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, PANEL_TICK_MS, () => {
                this.idlePanel.show(this.sources.panel.content());
                return GLib.SOURCE_CONTINUE;
            });
        } else if (!run && this.panelTickId) {
            GLib.source_remove(this.panelTickId);
            this.panelTickId = 0;
        }
    }

    /** A panel button closes the panel, then acts. */
    private onPanelClick(action: () => void): void {
        this.machine.close();
        action();
    }

    /** The dots belong to the closed notch; open, GNOME's own indicators still show. */
    private showPrivacyDots(): void {
        this.privacyDots.actor.visible = this.privacyCount > 0 && (this.drawn === 'idle' || this.drawn === 'collapsed');
    }

    private onNotificationClick(): void {
        const click = this.notificationClick;
        this.notificationClick = null;
        this.notificationTimer.hide();
        click?.();
    }

    /** The OSD over a notification over the state machine's mode, which keeps running underneath. */
    private overlay(): Drawn {
        if (this.osdTimer.active) return 'osd';
        if (this.notificationTimer.active) return 'notification';
        const { mode } = this.machine;
        return mode === 'expanded' && !this.sources.media.snapshot().available ? 'panel' : mode;
    }

    private onMode(): void {
        this.draw(this.overlay());
    }

    private draw(mode: Drawn): void {
        const previous = this.drawn;
        if (mode === previous) return;
        this.drawn = mode;
        // The panel's rows give its height, so draw it before sizing.
        if (mode === 'panel') this.refreshPanel();
        const [width, height] = this.sizeFor(mode);
        const tall = (drawn: Drawn) => drawn === 'expanded' || drawn === 'panel' || drawn === 'notification';
        const kind = tall(mode) ? 'open' : tall(previous) ? 'close' : 'width';
        this.notch.resizeTo(width, height, kind);
        this.showView(mode);
        this.showPrivacyDots();
        if (mode === 'idle') this.clock.start();
        else this.clock.stop();
        this.collapsed.setActive(mode === 'collapsed', this.sources.media.snapshot());
        this.applyIndicator();
        this.updatePanelTick();
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
        if (mode === 'notification') return [a.expandedWidth, a.height + NOTIFICATION_EXTRA_HEIGHT];
        if (mode === 'panel') return [a.expandedWidth, panelHeight(a.height, this.panelRows)];
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
        this.idlePanel.setForeground(foreground);
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

    // Timers: only while expanded and playing.

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
        if (this.panelTickId) GLib.source_remove(this.panelTickId);
        this.tickId = 0;
        this.lyricTimerId = 0;
        this.panelTickId = 0;
    }
}

function panelRowsFor(content: PanelContent): PanelRow[] {
    const activities = Math.min(content.activities.length, MAX_PANEL_ACTIVITIES);
    return ['date', ...Array<PanelRow>(activities).fill('activity'), 'buttons'];
}
