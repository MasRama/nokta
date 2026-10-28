import Clutter from 'gi://Clutter';
import type Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import { ActivityBadge, type ActivitiesClient, type Activity } from './features/activities/index.js';
import {
    LyricLine,
    type LyricsClient,
    LyricsSheet,
    lyricWindow,
    SHEET_EXTRA_HEIGHT,
    SHEET_ROWS,
    visibleLyric,
} from './features/lyrics/index.js';
import { CollapsedMediaView, ExpandedMediaView, type MediaClient } from './features/media/index.js';
import {
    NotificationTimer,
    NotificationView,
    ScreenshotView,
    type ScreenshotButton,
} from './features/notifications/index.js';
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
import {
    DropView,
    pointIn,
    SHELF_ROW_HEIGHT,
    ShelfBadge,
    ShelfRow,
    type Hit,
    type Rect,
    type ShelfItem,
    type ShelfNotch,
} from './features/shelf/index.js';
import { formatRemaining, phaseColor, remainingAt, TimerLabel, type TimerClient } from './features/timer/index.js';
import { IdleClock } from './shared/clock.js';
import { withAlpha } from './shared/logic/color.js';
import { chooseIndicator, type Indicator } from './shared/logic/indicator.js';
import { msUntilLine, nextLineStartUs } from './shared/logic/lyrics.js';
import { NotchMachine, type NotchMode } from './shared/logic/machine.js';
import { extrapolatePosition } from './shared/logic/position.js';
import { paletteFor, type Palette } from './shared/logic/theme.js';
import { type MonitorArea, Notch } from './shared/notch.js';
import { glibSchedule } from './shared/schedule.js';

const TICK_MS = 250;
/** The elapsed times in the open panel change once a second. */
const PANEL_TICK_MS = 1000;
/** A notification is two lines tall: this much taller than the closed notch. */
const NOTIFICATION_EXTRA_HEIGHT = 28;
/** A screenshot preview: the thumbnail and two rows of buttons. */
const SCREENSHOT_EXTRA_HEIGHT = 84;
/** The drop area: this much taller than the closed notch. */
const DROP_EXTRA_HEIGHT = 76;
/** Files dragged this close to the closed notch open the drop area. */
const DROP_MARGIN = 24;
/** The shelf row under the player, with the open player's spacing. */
const EXPANDED_SHELF_EXTRA = SHELF_ROW_HEIGHT + 8;
/** A view comes in from, and goes out to, this scale. */
const VIEW_SCALE_FROM = 0.96;

/**
 * What the notch draws: the state machine's mode (the idle panel when it
 * opens without a player), or the OSD or a notification over it.
 */
type Drawn = NotchMode | 'panel' | 'osd' | 'notification' | 'screenshot' | 'drop';

/** What the idle panel shows and does; owned by the session. */
export interface PanelSource {
    content(): PanelContent;
    /** The panel just opened. */
    opened(): void;
    openCalendar(): void;
    openNotifications(): void;
    toggleFocus(): void;
}

/** The parked files and the helper window; owned by the session. */
export interface ShelfSource {
    /** Empty while the shelf is turned off. */
    items(): readonly ShelfItem[];
    /** The pointer is over this notch's shelf row, drawn at `rect`. */
    overRow(notch: MonitorNotch, rect: Rect): void;
    /** This notch no longer shows its shelf row. */
    rowGone(notch: MonitorNotch): void;
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
    shelf: ShelfSource;
}

/**
 * The notch on one monitor: its views, hover state machine, OSD and timers.
 * destroy() removes everything it created.
 */
export class MonitorNotch implements ShelfNotch {
    private readonly notch: Notch;
    private readonly clock = new IdleClock();
    /** The clock, or the indicator: the timer while one is set, else the newest activity. */
    private readonly idle = new St.Widget({ layout_manager: new Clutter.BinLayout() });
    private readonly idleTimer = new TimerLabel();
    private readonly collapsedTimer = new TimerLabel();
    private readonly idleBadge = new ActivityBadge();
    private readonly collapsedBadge = new ActivityBadge();
    private readonly idleShelf = new ShelfBadge();
    private readonly collapsedShelf = new ShelfBadge();
    private readonly panelShelf = new ShelfRow();
    private readonly expandedShelf = new ShelfRow();
    private readonly dropView = new DropView();
    private dropping = false;
    /** The pointer is over the helper window on a shelf row, so over the notch too. */
    private helperInside = false;
    /** Watches the next pointer motion while the notch may still think the pointer is on it. */
    private staleHoverId = 0;
    private indicator: Indicator | null = null;
    private readonly collapsed = new CollapsedMediaView();
    private readonly expanded: ExpandedMediaView;
    /** The colors the views were last drawn with. */
    private shownPalette: Palette;
    private readonly lyricLine = new LyricLine(() => this.setLyricsOpen(!this.lyricsOpen));
    /** The lyrics view, open in place of the lyric line until a click, the track changing or the notch closing. */
    private readonly lyricsSheet = new LyricsSheet(() => this.setLyricsOpen(false));
    private lyricsOpen = false;
    /** The track the lyrics view opened for. */
    private lyricsTrack = '';
    private readonly osdView = new OsdView();
    private readonly notificationView = new NotificationView(() => this.onNotificationClick());
    private notificationClick: (() => void) | null = null;
    private readonly screenshotView = new ScreenshotView((button) => this.onScreenshotPress(button));
    private screenshotPress: ((button: ScreenshotButton) => void) | null = null;
    /** Which of the two the notification timer is showing. */
    private notificationKind: 'notification' | 'screenshot' = 'notification';
    private readonly privacyDots = new PrivacyDots();
    private privacyCount = 0;
    private readonly idlePanel = new IdlePanel({
        openCalendar: () => this.onPanelClick(() => this.sources.panel.openCalendar()),
        openNotifications: () => this.onPanelClick(() => this.sources.panel.openNotifications()),
        toggleFocus: () => this.onPanelClick(() => this.sources.panel.toggleFocus()),
    });
    private readonly machine: NotchMachine;
    private readonly osdTimer: OsdTimer;
    private readonly notificationTimer: NotificationTimer;
    private readonly views: Record<Drawn, St.Widget>;
    private readonly hoverId: number;
    private readonly motionId: number;
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
        this.shownPalette = this.palette();
        this.notch = new Notch(settings.appearance, this.shownPalette);
        this.expanded = new ExpandedMediaView(media);
        this.expanded.infoBox.add_child(this.lyricLine.actor);
        // Under the cover and the title, above the seek bar.
        this.expanded.actor.insert_child_at_index(this.lyricsSheet.actor, 1);
        this.expanded.actor.add_child(this.expandedShelf.actor);
        // Above the notifications and focus buttons.
        this.idlePanel.actor.insert_child_at_index(this.panelShelf.actor, this.idlePanel.actor.get_n_children() - 1);
        this.clock.actor.x_expand = true;
        this.clock.actor.y_expand = true;
        this.idle.add_child(this.clock.actor);
        this.idle.add_child(this.idleTimer.actor);
        this.idle.add_child(this.idleBadge.actor);
        this.idle.add_child(this.idleShelf.actor);
        this.idleTimer.actor.hide();
        this.idleBadge.actor.hide();
        this.idleShelf.actor.hide();
        this.views = {
            idle: this.idle,
            collapsed: this.collapsed.actor,
            expanded: this.expanded.actor,
            panel: this.idlePanel.actor,
            osd: this.osdView.actor,
            notification: this.notificationView.actor,
            screenshot: this.screenshotView.actor,
            drop: this.dropView.actor,
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
            this.machine.pointer(hover || this.helperInside);
        });
        this.motionId = this.notch.actor.connect('motion-event', (_actor, event: Clutter.Event) => {
            this.onMotion(event);
            return Clutter.EVENT_PROPAGATE;
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
        this.onShelf();
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
        this.screenshotPress = null;
        this.stopTimers();
        this.notch.actor.disconnect(this.hoverId);
        this.notch.actor.disconnect(this.motionId);
        this.notch.actor.disconnect(this.destroyId);
        this.forgetStaleHover();
        this.osdView.destroy();
        this.notificationView.destroy();
        this.screenshotView.destroy();
        this.idlePanel.destroy();
        this.privacyDots.destroy();
        this.collapsed.setAside(null);
        this.idleTimer.destroy();
        this.collapsedTimer.destroy();
        this.idleBadge.destroy();
        this.collapsedBadge.destroy();
        this.idleShelf.destroy();
        this.collapsedShelf.destroy();
        this.panelShelf.destroy();
        this.expandedShelf.destroy();
        this.dropView.destroy();
        this.clock.destroy();
        this.idle.destroy();
        this.lyricLine.destroy();
        this.lyricsSheet.destroy();
        this.collapsed.destroy();
        this.expanded.destroy();
        Main.layoutManager.removeChrome(this.notch.actor);
        this.notch.destroy();
    }

    onMedia(): void {
        if (this.destroyed) return;
        const snapshot = this.sources.media.snapshot();
        this.applyPalette();
        this.collapsed.update(snapshot, this.shownPalette.accent);
        this.collapsed.setActive(this.drawn === 'collapsed', snapshot);
        this.expanded.update(snapshot);
        this.machine.setAvailable(snapshot.available);
        if (trackKey(snapshot) !== this.lyricsTrack) this.setLyricsOpen(false);
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

    /** The weather beside the date or the next event changed. */
    onPanelContent(): void {
        if (this.destroyed) return;
        if (this.drawn === 'panel') this.refreshPanel();
    }

    /** The parked files changed, or the file_shelf setting. */
    onShelf(): void {
        if (this.destroyed) return;
        const items = this.sources.shelf.items();
        this.idleShelf.update(items.length);
        this.collapsedShelf.update(items.length);
        this.panelShelf.show(items);
        this.expandedShelf.show(items);
        if (items.length === 0) this.sources.shelf.rowGone(this);
        const [width, height] = this.sizeFor('expanded');
        this.expanded.actor.set_size(width, height);
        if (this.drawn === 'expanded') this.notch.resizeTo(width, height, 'width');
        if (this.drawn === 'panel') this.refreshPanel();
        this.applyIndicator();
    }

    // The file shelf: what the helper window needs from this notch.

    get chrome(): Clutter.Actor {
        return this.notch.actor;
    }

    dropTrigger(): Rect {
        const [width, height] = this.sizeFor(this.drawn);
        const body = this.notch.bodyRect(width, height);
        return {
            x: body.x - DROP_MARGIN,
            y: body.y,
            width: body.width + 2 * DROP_MARGIN,
            height: body.height + DROP_MARGIN,
        };
    }

    dropRect(): Rect {
        const [width, height] = this.sizeFor('drop');
        return this.notch.bodyRect(width, height);
    }

    setDropping(on: boolean): void {
        if (this.destroyed || on === this.dropping) return;
        this.dropping = on;
        this.draw(this.overlay());
    }

    setHelperPointer(inside: boolean): void {
        if (this.destroyed) return;
        this.helperInside = inside;
        if (!inside) this.checkHoverOnNextMotion();
        this.machine.pointer(this.notch.actor.hover || inside);
    }

    /**
     * The helper window lay over the notch, so the notch may never see the
     * pointer leave: GNOME 49 and later keep it hovered. The next motion
     * anywhere says whether the pointer is still on it.
     */
    private checkHoverOnNextMotion(): void {
        if (this.staleHoverId || !this.notch.actor.hover) return;
        this.staleHoverId = global.stage.connect('captured-event', (_stage, event: Clutter.Event) => {
            if (event.type() !== Clutter.EventType.MOTION) return Clutter.EVENT_PROPAGATE;
            this.forgetStaleHover();
            const [x, y] = event.get_coords();
            const [ax, ay] = this.notch.actor.get_transformed_position();
            const [width, height] = this.notch.actor.get_transformed_size();
            if (!pointIn({ x: ax, y: ay, width, height }, x, y)) this.notch.actor.hover = false;
            return Clutter.EVENT_PROPAGATE;
        });
    }

    private forgetStaleHover(): void {
        if (this.staleHoverId) global.stage.disconnect(this.staleHoverId);
        this.staleHoverId = 0;
    }

    setShelfHover(hit: Hit | null): void {
        if (this.destroyed) return;
        this.panelShelf.setHover(hit);
        this.expandedShelf.setHover(hit);
    }

    onLyrics(): void {
        if (this.destroyed) return;
        if (!this.lyricsAvailable()) this.setLyricsOpen(false);
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
        this.onShelf();
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
        this.screenshotPress = null;
        this.notificationKind = 'notification';
        this.notificationTimer.show(durationMs);
        this.draw(this.overlay());
    }

    /** A screenshot preview, timed like a notification; a button calls `onPress` and closes it. */
    showScreenshot(
        image: Clutter.Content | null,
        title: string,
        buttons: readonly ScreenshotButton[],
        durationMs: number,
        onPress: (button: ScreenshotButton) => void,
    ): void {
        if (this.destroyed) return;
        this.screenshotView.show(image, title, buttons);
        this.screenshotPress = onPress;
        this.notificationClick = null;
        this.notificationKind = 'screenshot';
        this.notificationTimer.show(durationMs);
        this.draw(this.overlay());
    }

    /** The buttons of the screenshot preview while it shows. */
    setScreenshotButtons(buttons: readonly ScreenshotButton[]): void {
        if (this.destroyed) return;
        this.screenshotView.setButtons(buttons);
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
            shelf: this.sources.shelf.items().length > 0,
        });
        if (indicator !== this.indicator) {
            this.indicator = indicator;
            this.clock.actor.visible = indicator === null;
            this.idleTimer.actor.visible = indicator === 'timer';
            this.idleBadge.actor.visible = indicator === 'activity';
            this.idleShelf.actor.visible = indicator === 'shelf';
            const aside = {
                timer: this.collapsedTimer.actor,
                activity: this.collapsedBadge.actor,
                shelf: this.collapsedShelf.actor,
            };
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
        const rows = panelRowsFor(content, this.sources.shelf.items().length > 0);
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

    private onScreenshotPress(button: ScreenshotButton): void {
        const press = this.screenshotPress;
        this.screenshotPress = null;
        this.notificationTimer.hide();
        press?.(button);
    }

    private onNotificationClick(): void {
        const click = this.notificationClick;
        this.notificationClick = null;
        this.notificationTimer.hide();
        click?.();
    }

    /** The shelf row in the open notch, while one shows. */
    private shownShelfRow(): ShelfRow | null {
        const row = this.drawn === 'panel' ? this.panelShelf : this.drawn === 'expanded' ? this.expandedShelf : null;
        return row?.actor.visible ? row : null;
    }

    /** The pointer moved over the notch: on the shelf row, the helper window takes over. */
    private onMotion(event: Clutter.Event): void {
        const row = this.shownShelfRow();
        if (!row) return;
        const [x, y] = event.get_coords();
        const [rx, ry] = row.actor.get_transformed_position();
        const [width, height] = row.actor.get_transformed_size();
        const rect = { x: Math.round(rx), y: Math.round(ry), width: Math.round(width), height: Math.round(height) };
        if (pointIn(rect, x, y)) this.sources.shelf.overRow(this, rect);
    }

    /** The drop area over the OSD over a notification over the state machine's mode, which keeps running underneath. */
    private overlay(): Drawn {
        if (this.dropping) return 'drop';
        if (this.osdTimer.active) return 'osd';
        if (this.notificationTimer.active) return this.notificationKind;
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
        if (mode !== 'expanded') this.setLyricsOpen(false);
        // The panel's rows give its height, so draw it before sizing.
        if (mode === 'panel') {
            this.sources.panel.opened();
            this.refreshPanel();
        }
        const [width, height] = this.sizeFor(mode);
        if (previous === 'panel' || previous === 'expanded') this.sources.shelf.rowGone(this);
        const tall = (drawn: Drawn) =>
            drawn === 'expanded' ||
            drawn === 'panel' ||
            drawn === 'notification' ||
            drawn === 'screenshot' ||
            drawn === 'drop';
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
        if (mode === 'screenshot') return [a.expandedWidth, a.height + SCREENSHOT_EXTRA_HEIGHT];
        if (mode === 'drop') return [a.expandedWidth, a.height + DROP_EXTRA_HEIGHT];
        if (mode === 'panel') return [a.expandedWidth, panelHeight(a.height, this.panelRows)];
        if (mode === 'expanded') {
            const lyrics = this.lyricsOpen ? SHEET_EXTRA_HEIGHT : 0;
            const shelf = this.sources.shelf.items().length > 0 ? EXPANDED_SHELF_EXTRA : 0;
            return [a.expandedWidth, a.expandedHeight + lyrics + shelf];
        }
        return [mode === 'collapsed' ? a.playingWidth : a.idleWidth, a.height];
    }

    /** Each view keeps its final size, so text never reflows while resizing. */
    private applyViewSizes(): void {
        for (const [mode, actor] of Object.entries(this.views)) {
            const [width, height] = this.sizeFor(mode as Drawn);
            actor.set_size(width, height);
        }
    }

    /** The theme's colors with the cover's worked in. */
    private palette(): Palette {
        const appearance = this.sources.settings.appearance;
        return paletteFor(appearance.theme, appearance, this.sources.media.snapshot().accentColor);
    }

    /** Recolors the notch and its views when the theme or the cover's color changes. */
    private applyPalette(): void {
        const palette = this.palette();
        if (JSON.stringify(palette) === JSON.stringify(this.shownPalette)) return;
        this.shownPalette = palette;
        this.notch.setPalette(palette);
        this.applyOsdColors();
    }

    private applyOsdColors(): void {
        const { foreground, accent } = this.shownPalette;
        this.expanded.progress.setColors(accent, withAlpha(foreground, 0.25));
        this.osdView.setColors(accent, withAlpha(foreground, 0.25));
        this.idlePanel.setForeground(foreground);
        this.dropView.setForeground(foreground);
        this.screenshotView.setForeground(foreground);
    }

    private applyClockOptions(): void {
        const { clockFormat, showClock } = this.sources.settings.behavior;
        this.clock.setOptions(clockFormat, showClock);
    }

    /**
     * The old content fades out as it shrinks a little, the new one fades
     * in growing from the top centre, while the body springs to its size.
     */
    private showView(mode: Drawn): void {
        const speed = this.sources.settings.appearance.animationSpeed;
        for (const [name, actor] of Object.entries(this.views)) {
            actor.remove_all_transitions();
            actor.set_pivot_point(0.5, 0);
            if (name === mode) {
                actor.show();
                actor.opacity = 0;
                actor.scale_x = VIEW_SCALE_FROM;
                actor.scale_y = VIEW_SCALE_FROM;
                actor.translation_y = 0;
                actor.ease({
                    opacity: 255,
                    scale_x: 1,
                    scale_y: 1,
                    delay: Math.round(50 * speed),
                    duration: Math.round(200 * speed),
                    mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
                });
            } else if (actor.visible) {
                actor.ease({
                    opacity: 0,
                    scale_x: VIEW_SCALE_FROM,
                    scale_y: VIEW_SCALE_FROM,
                    duration: Math.round(90 * speed),
                    mode: Clutter.AnimationMode.EASE_IN_QUAD,
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
        if (this.lyricsOpen) {
            this.lyricLine.show(null);
            this.lyricsSheet.show(lyricWindow(lyrics.lines, position, SHEET_ROWS));
        } else {
            this.lyricLine.show(visibleLyric(lyrics.status, lyrics.lines, settings.behavior.showLyrics, position));
        }
    }

    private lyricsAvailable(): boolean {
        return this.sources.lyrics.status === 'synced' && this.sources.settings.behavior.showLyrics;
    }

    /** Opens or closes the lyrics view; the open notch grows or shrinks with it. */
    private setLyricsOpen(open: boolean): void {
        const wanted = open && this.drawn === 'expanded' && this.lyricsAvailable();
        if (wanted === this.lyricsOpen) return;
        this.lyricsOpen = wanted;
        this.lyricsTrack = wanted ? trackKey(this.sources.media.snapshot()) : '';
        this.lyricsSheet.reset();
        this.lyricsSheet.actor.visible = wanted;
        const [width, height] = this.sizeFor('expanded');
        this.expanded.actor.set_size(width, height);
        if (this.drawn === 'expanded') {
            this.notch.resizeTo(width, height, 'width');
            this.tick();
        }
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

/** What tells one track from the next, for closing the lyrics view. */
function trackKey(snapshot: { playerId: string; title: string; artists: readonly string[] }): string {
    return [snapshot.playerId, snapshot.title, ...snapshot.artists].join('\n');
}

function panelRowsFor(content: PanelContent, shelf: boolean): PanelRow[] {
    const activities = Math.min(content.activities.length, MAX_PANEL_ACTIVITIES);
    const event: PanelRow[] = content.event ? ['event'] : [];
    const files: PanelRow[] = shelf ? ['shelf'] : [];
    return ['date', ...event, ...Array<PanelRow>(activities).fill('activity'), ...files, 'buttons'];
}
