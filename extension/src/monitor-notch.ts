import Clutter from 'gi://Clutter';
import type Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import { ActivityBadge, type ActivitiesClient, type Activity } from './features/activities/index.js';
import { CountdownBadge } from './features/calendar/index.js';
import { ClipboardPage, type ClipboardEntry } from './features/clipboard/index.js';
import { NotchGestures } from './features/gestures/index.js';
import {
    LYRIC_ROW_EXTRA,
    LyricLine,
    lineProgress,
    type LyricsClient,
    LyricsSheet,
    fullscreenLines,
    LyricsFullscreen,
    lyricWindow,
    nextLyric,
    romanize,
    type FullscreenFrame,
    SHEET_EXTRA_HEIGHT,
    SHEET_ROWS,
    visibleLyric,
} from './features/lyrics/index.js';
import {
    type AudioOutputs,
    CollapsedMediaView,
    ExpandedMediaView,
    type MediaClient,
} from './features/media/index.js';
import {
    NotificationTimer,
    NotificationView,
    ScreenshotView,
    type ScreenshotButton,
} from './features/notifications/index.js';
import { OsdTimer, OsdView, type OsdContent } from './features/osd/index.js';
import {
    HomePanel,
    MAX_PANEL_ACTIVITIES,
    MAX_PANEL_CLOCKS,
    MAX_PANEL_EVENTS,
    NotchMenu,
    panelHeight,
    shownControls,
    SubPage,
    subPageHeight,
    type PanelContent,
    type PanelRow,
    type QuickToggle,
} from './features/panel/index.js';
import {
    CallLabel,
    type CallMonitor,
    callText,
    dotsFor,
    PrivacyDots,
    type PrivacyMonitor,
    RecordingLabel,
    type ScreenRecording,
} from './features/privacy/index.js';
import type { SettingsClient } from './features/settings/index.js';
import { SettingsPage } from './features/settings/page.js';
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
import {
    clockColor,
    clockText,
    clockValueAt,
    formatRemaining,
    indicatorClock,
    phaseColor,
    remainingAt,
    TimerLabel,
    TimerPage,
    type TimerClient,
} from './features/timer/index.js';
import { IdleClock } from './shared/clock.js';
import { disableUnredirect, enableUnredirect } from './shared/compat.js';
import { focusButtons, focusFirst, keyFocus, moveFocus } from './shared/focus.js';
import { withAlpha } from './shared/logic/color.js';
import { formatDuration } from './shared/logic/format.js';
import { fullscreenView, UnredirectHold } from './shared/logic/fullscreen.js';
import { glowColor, type AlertTone } from './shared/logic/glow.js';
import { chooseIndicator, type Indicator } from './shared/logic/indicator.js';
import { keyAction } from './shared/logic/keyboard.js';
import { msUntilLine, nextLineStartUs } from './shared/logic/lyrics.js';
import { NotchMachine, type NotchMode } from './shared/logic/machine.js';
import { extrapolatePosition } from './shared/logic/position.js';
import { progressLine, type Span } from './shared/logic/progress-line.js';
import { backdropFor, backdropPalette } from './shared/logic/backdrop.js';
import { paletteFor, themeFor, type Palette } from './shared/logic/theme.js';
import { type MonitorArea, Notch } from './shared/notch.js';
import { ProgressLine } from './shared/progress-line.js';
import { glibSchedule } from './shared/schedule.js';

const TICK_MS = 250;
/** The elapsed times in the open panel change once a second. */
const PANEL_TICK_MS = 1000;
/** A notification is two lines tall: this much taller than the closed notch. */
const NOTIFICATION_EXTRA_HEIGHT = 28;
/** Its row of buttons, with the spacing above it. */
const NOTIFICATION_BUTTONS_EXTRA = 32;
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
/** An alert pushes the notch this much wider before it springs back. */
const ALERT_KICK = 0.06;

/**
 * What the notch draws: the state machine's mode (the idle panel when it
 * opens without a player), or the OSD or a notification over it.
 */
type Drawn = NotchMode | 'panel' | 'page' | 'osd' | 'notification' | 'screenshot' | 'drop';

/** The pages that home's tiles open. */
type PageName = 'clipboard' | 'timer' | 'settings';

/** A notification the notch shows. */
export interface NotchNotification {
    title: string;
    detail: string;
    icon: Gio.Icon | null;
    /** The labels of the buttons for its actions. */
    buttons: readonly string[];
    /** The count on the icon when several stacked, else null. */
    badge: string | null;
    /** A click on the notification. */
    onClick(): void;
    /** A click on the button at this place in `buttons`. */
    onButton(index: number): void;
}

/** What home shows and does; owned by the session. */
export interface PanelSource {
    content(): PanelContent;
    /** Home just opened. */
    opened(): void;
    openCalendar(): void;
    /** Opens the event's meeting link and ends its countdown. */
    joinMeeting(id: string): void;
    openNotifications(): void;
    toggleFocus(): void;
    openSettings(): void;
    /** GNOME's screenshot UI, once the notch has closed. */
    openScreenshot(): void;
    toggle(which: QuickToggle): void;
    setDoNotDisturb(on: boolean): void;
}

/** The parked files and the helper window; owned by the session. */
export interface ShelfSource {
    /** Empty while the shelf is turned off. */
    items(): readonly ShelfItem[];
    /** The pointer is over this notch's shelf row, drawn at `rect`. */
    overRow(notch: MonitorNotch, rect: Rect): void;
    /** This notch no longer shows its shelf row. */
    rowGone(notch: MonitorNotch): void;
    clear(): void;
}

/** The clipboard history; owned by the session. */
export interface ClipboardSource {
    /** The history is on. */
    enabled(): boolean;
    /** Newest first; empty while the history is off. */
    entries(): readonly ClipboardEntry[];
    paused(): boolean;
    copy(id: string): void;
    pin(id: string, pinned: boolean): void;
    remove(id: string): void;
    clear(): void;
    setPaused(paused: boolean): void;
}

/** The clients every notch reads; owned by the session. */
export interface NotchSources {
    settings: SettingsClient;
    media: MediaClient;
    /** The sound outputs, for the open player's output button. */
    outputs: AudioOutputs;
    lyrics: LyricsClient;
    timer: TimerClient;
    activities: ActivitiesClient;
    privacy: PrivacyMonitor;
    call: CallMonitor;
    recording: ScreenRecording;
    panel: PanelSource;
    shelf: ShelfSource;
    clipboard: ClipboardSource;
    /** The closed notch's countdown to a meeting, `5 min` ... `Now`; null when none is near. */
    countdown: { text(): string | null };
    /** Whether the system's style is dark, for themes that follow it. */
    systemStyle: { dark(): boolean };
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
    private readonly idleRecording = new RecordingLabel();
    private readonly collapsedRecording = new RecordingLabel();
    private readonly idleCall = new CallLabel();
    private readonly collapsedCall = new CallLabel();
    private readonly idleBadge = new ActivityBadge();
    private readonly collapsedBadge = new ActivityBadge();
    private readonly idleShelf = new ShelfBadge();
    private readonly collapsedShelf = new ShelfBadge();
    private readonly idleCountdown = new CountdownBadge();
    private readonly collapsedCountdown = new CountdownBadge();
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
    private readonly lyricsSheet = new LyricsSheet(
        () => this.setLyricsOpen(false),
        (offsetMs) => this.sources.lyrics.setOffset(offsetMs),
        () => this.lyricsFullscreen.open(this.monitorIndex),
    );
    private readonly lyricsFullscreen = new LyricsFullscreen(() => this.fullscreenFrame());
    private lyricsOpen = false;
    /** The track the lyrics view opened for. */
    private lyricsTrack = '';
    private readonly osdView = new OsdView();
    private readonly notificationView = new NotificationView({
        onClick: () => this.onNotificationClick(),
        onButton: (index) => this.onNotificationButton(index),
        onClose: () => this.hideNotification(),
    });
    private notificationClick: (() => void) | null = null;
    private notificationButton: ((index: number) => void) | null = null;
    /** Whether the notification that shows has a row of buttons. */
    private notificationButtons = false;
    private readonly screenshotView = new ScreenshotView((button) => this.onScreenshotPress(button));
    private screenshotPress: ((button: ScreenshotButton) => void) | null = null;
    /** Which of the two the notification timer is showing. */
    private notificationKind: 'notification' | 'screenshot' = 'notification';
    private readonly privacyDots = new PrivacyDots();
    private readonly progress = new ProgressLine();
    private privacyCount = 0;
    private readonly idlePanel: HomePanel;
    /** Home is open over the player, until the notch closes or its music button goes back. */
    private homeOpen = false;
    /** A page a home tile opened, until the notch closes or its back arrow goes home. */
    private page: PageName | null = null;
    private readonly clipboardPage: ClipboardPage;
    /**
     * The keyboard, held while the notch is open from the open shortcut or
     * the clipboard's search field is open: one grab for both.
     */
    private grab: Clutter.Grab | null = null;
    private grabEventId = 0;
    private grabKeyId = 0;
    private keyFocusId = 0;
    /** The clipboard's search field is open. */
    private searching = false;
    /** The open player's output menu shows, so the pointer counts as on the notch. */
    private outputMenuOpen = false;
    private readonly clipboardSubPage: SubPage;
    private readonly timerPage: TimerPage;
    private readonly timerSubPage: SubPage;
    private readonly settingsPage: SettingsPage;
    private readonly settingsSubPage: SubPage;
    /** Holds the pages; the one open shows. */
    private readonly pages = new St.Widget({ layout_manager: new Clutter.BinLayout() });
    private readonly menu: NotchMenu;
    private readonly gestures: NotchGestures;
    private readonly pressId: number;
    private readonly machine: NotchMachine;
    private readonly osdTimer: OsdTimer;
    private readonly notificationTimer: NotificationTimer;
    private readonly views: Record<Drawn, St.Widget>;
    private readonly hoverId: number;
    private readonly motionId: number;
    private readonly destroyId: number;
    private readonly fullscreenId: number;
    private readonly windowsShownId: number;
    /** A fullscreen window covers this monitor, as GNOME's top chrome counts it. */
    private inFullscreen = false;
    /** The OSD shows an alert let through over the fullscreen window. */
    private alertOverFullscreen = false;
    /** Unredirection is off while the notch shows over a fullscreen window. */
    private readonly unredirect = new UnredirectHold(disableUnredirect, enableUnredirect);
    private destroyed = false;
    private drawn: Drawn = 'idle';
    private tickId = 0;
    private lyricTimerId = 0;
    private panelTickId = 0;
    /** The panel's rows, as last shown. */
    private panelRows: PanelRow[] = ['date', 'toggles', 'tiles'];

    constructor(
        readonly monitorIndex: number,
        area: MonitorArea,
        private readonly sources: NotchSources,
    ) {
        const { settings, media, panel } = sources;
        this.shownPalette = this.palette();
        this.notch = new Notch(settings.appearance, this.shownPalette);
        this.expanded = new ExpandedMediaView(media, () => this.setHomeOpen(true), {
            select: (id) => sources.outputs.select(id),
            opened: (open) => {
                this.outputMenuOpen = open;
                if (!this.destroyed) this.machine.pointer(this.pointerInside());
            },
        });
        this.idlePanel = new HomePanel(
            {
                openCalendar: () => this.onPanelClick(() => panel.openCalendar()),
                joinMeeting: (id) => this.onPanelClick(() => panel.joinMeeting(id)),
                openNotifications: () => this.onPanelClick(() => panel.openNotifications()),
                toggleFocus: () => this.onPanelClick(() => panel.toggleFocus()),
                openSettings: () => this.setPage('settings'),
                openScreenshot: () => this.onPanelClick(() => panel.openScreenshot()),
                openClipboard: () => this.setPage('clipboard'),
                openTimer: () => this.setPage('timer'),
                openPlayer: () => this.setHomeOpen(false),
                // A toggle acts in place; home stays open to show it.
                toggle: (which) => panel.toggle(which),
                pauseClock: (id, pause) => (pause ? sources.timer.pauseClock(id) : sources.timer.resumeClock(id)),
                removeClock: (id) => sources.timer.removeClock(id),
                stopRecording: () => sources.recording.stop(),
                toggleCallMute: () => sources.call.toggleMute(),
                hideCall: () => sources.call.hide(),
            },
        );
        this.menu = new NotchMenu({
            openSettings: () => panel.openSettings(),
            setDoNotDisturb: (on) => panel.setDoNotDisturb(on),
            clearShelf: () => sources.shelf.clear(),
            setClipboardPaused: (paused) => sources.clipboard.setPaused(paused),
        });
        const { clipboard } = sources;
        this.clipboardPage = new ClipboardPage({
            copy: (id) => clipboard.copy(id),
            pin: (id, pinned) => clipboard.pin(id, pinned),
            remove: (id) => clipboard.remove(id),
            clear: () => clipboard.clear(),
            setPaused: (paused) => clipboard.setPaused(paused),
            searching: (entry) => this.setSearchField(entry),
            resized: () => this.resizePage(),
        });
        this.clipboardSubPage = new SubPage('Clipboard', this.clipboardPage.actor, () => this.setPage(null));
        for (const action of this.clipboardPage.actions) this.clipboardSubPage.addAction(action);
        // What a preset starts shows in home, so it goes back there.
        this.timerPage = new TimerPage({
            countdown: (minutes) => {
                sources.timer.addCountdown(minutes);
                this.setPage(null);
            },
            stopwatch: () => {
                sources.timer.addStopwatch();
                this.setPage(null);
            },
        });
        this.timerSubPage = new SubPage('Timer', this.timerPage.actor, () => this.setPage(null));
        // A change shows at once; when the daemon refuses it, the page shows the old value again.
        this.settingsPage = new SettingsPage({
            set: (key, value) => {
                settings.set('appearance', key, value).catch(() => this.showSettingsPage());
            },
            openWindow: () => this.onPanelClick(() => panel.openSettings()),
        });
        this.settingsSubPage = new SubPage('Settings', this.settingsPage.actor, () => this.setPage(null));
        this.pages.add_child(this.clipboardSubPage.actor);
        this.pages.add_child(this.timerSubPage.actor);
        this.pages.add_child(this.settingsSubPage.actor);
        // Under the cover and the title, above the seek bar: the lyric row, or the lyrics view in its place.
        this.expanded.actor.insert_child_at_index(this.lyricLine.actor, 1);
        this.expanded.actor.insert_child_at_index(this.lyricsSheet.actor, 2);
        this.expanded.actor.add_child(this.expandedShelf.actor);
        this.idlePanel.addRow(this.panelShelf.actor);
        this.clock.actor.x_expand = true;
        this.clock.actor.y_expand = true;
        this.idle.add_child(this.clock.actor);
        this.idle.add_child(this.idleRecording.actor);
        this.idle.add_child(this.idleCall.actor);
        this.idle.add_child(this.idleTimer.actor);
        this.idle.add_child(this.idleBadge.actor);
        this.idle.add_child(this.idleShelf.actor);
        this.idle.add_child(this.idleCountdown.actor);
        this.idleRecording.actor.hide();
        this.idleCall.actor.hide();
        this.idleTimer.actor.hide();
        this.idleBadge.actor.hide();
        this.idleShelf.actor.hide();
        this.idleCountdown.actor.hide();
        this.views = {
            idle: this.idle,
            collapsed: this.collapsed.actor,
            expanded: this.expanded.actor,
            panel: this.idlePanel.actor,
            page: this.pages,
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
        // Last, so the line and the dots stay above every view.
        this.notch.body.add_child(this.progress.actor);
        this.notch.body.add_child(this.privacyDots.actor);
        this.machine = new NotchMachine(
            glibSchedule,
            () => ({
                openMs: settings.behavior.openDelayMs,
                closeMs: settings.behavior.closeDelayMs,
                openOn: settings.behavior.openOn,
            }),
            () => this.onMode(),
        );
        this.osdTimer = new OsdTimer(
            glibSchedule,
            () => settings.behavior.osdDurationMs,
            (active) => this.onOsdTimer(active),
        );
        this.notificationTimer = new NotificationTimer(glibSchedule, () => this.draw(this.overlay()));

        // The notch follows fullscreen itself, so an alert can show over it.
        Main.layoutManager.addTopChrome(this.notch.actor, { affectsStruts: false, trackFullscreen: false });
        this.fullscreenId = global.display.connect('in-fullscreen-changed', () => this.onFullscreen());
        // The overview hides the windows, and a fullscreen one then hides nothing.
        this.windowsShownId = global.window_group.connect('notify::visible', () => this.onFullscreen());
        this.hoverId = this.notch.actor.connect('notify::hover', () => {
            const { hover } = this.notch.actor;
            this.notificationTimer.pointer(hover);
            this.machine.pointer(this.pointerInside());
        });
        this.motionId = this.notch.actor.connect('motion-event', (_actor, event: Clutter.Event) => {
            this.onMotion(event);
            return Clutter.EVENT_PROPAGATE;
        });
        this.pressId = this.notch.actor.connect('button-press-event', (_actor, event: Clutter.Event) => {
            // With open_on "click", a click on the closed notch opens it; its buttons take their own clicks first.
            if (event.get_button() === Clutter.BUTTON_PRIMARY) {
                const closed = this.drawn === 'idle' || this.drawn === 'collapsed';
                return closed && this.pointerInside() && this.machine.click() ? Clutter.EVENT_STOP : Clutter.EVENT_PROPAGATE;
            }
            if (event.get_button() !== Clutter.BUTTON_SECONDARY) return Clutter.EVENT_PROPAGATE;
            const [x, y] = event.get_coords();
            this.menu.open(x, y, {
                doNotDisturb: this.sources.panel.content().toggles.do_not_disturb,
                shelfItems: this.sources.shelf.items().length,
                clipboardPaused: this.sources.clipboard.enabled() ? this.sources.clipboard.paused() : null,
            });
            return Clutter.EVENT_STOP;
        });
        this.gestures = new NotchGestures(this.notch.actor, monitorIndex, {
            enabled: () => sources.settings.behavior.gestures,
            hasPlayer: () => sources.media.snapshot().available,
            playPause: () => sources.media.playPause(),
            next: () => sources.media.next(),
            previous: () => sources.media.previous(),
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
        this.onClipboard();
        this.onPrivacy();
        this.onOutputs();
        this.onFullscreen();
    }

    /**
     * Whether a message can show here: not while a fullscreen app hides the
     * notch, unless it is let through `overFullscreen`.
     */
    canShow(overFullscreen = false): boolean {
        return !this.destroyed && (!this.inFullscreen || overFullscreen);
    }

    destroy(): void {
        if (this.destroyed) return;
        this.destroyed = true;
        this.machine.destroy();
        this.osdTimer.destroy();
        this.notificationTimer.destroy();
        this.notificationClick = null;
        this.notificationButton = null;
        this.screenshotPress = null;
        this.stopTimers();
        this.notch.actor.disconnect(this.hoverId);
        this.notch.actor.disconnect(this.motionId);
        this.notch.actor.disconnect(this.pressId);
        this.gestures.destroy();
        this.notch.actor.disconnect(this.destroyId);
        global.display.disconnect(this.fullscreenId);
        global.window_group.disconnect(this.windowsShownId);
        this.unredirect.release();
        this.menu.destroy();
        this.forgetStaleHover();
        this.setSearchField(null);
        this.osdView.destroy();
        this.notificationView.destroy();
        this.screenshotView.destroy();
        this.idlePanel.destroy();
        this.clipboardPage.destroy();
        this.clipboardSubPage.destroy();
        this.timerPage.destroy();
        this.timerSubPage.destroy();
        this.settingsPage.destroy();
        this.settingsSubPage.destroy();
        this.pages.destroy();
        this.privacyDots.destroy();
        this.progress.destroy();
        this.collapsed.setAside(null);
        this.idleRecording.destroy();
        this.collapsedRecording.destroy();
        this.idleCall.destroy();
        this.collapsedCall.destroy();
        this.idleTimer.destroy();
        this.collapsedTimer.destroy();
        this.idleBadge.destroy();
        this.collapsedBadge.destroy();
        this.idleShelf.destroy();
        this.collapsedShelf.destroy();
        this.idleCountdown.destroy();
        this.collapsedCountdown.destroy();
        this.panelShelf.destroy();
        this.expandedShelf.destroy();
        this.dropView.destroy();
        this.clock.destroy();
        this.idle.destroy();
        this.lyricLine.destroy();
        this.lyricsSheet.destroy();
        this.lyricsFullscreen.destroy();
        this.collapsed.destroy();
        this.expanded.destroy();
        Main.layoutManager.removeChrome(this.notch.actor);
        this.notch.destroy();
    }

    onMedia(): void {
        if (this.destroyed) return;
        const snapshot = this.sources.media.snapshot();
        this.applyPalette();
        // Aurora's swatch is tinted by the cover.
        if (this.page === 'settings') this.showSettingsPage();
        this.collapsed.update(snapshot, this.shownPalette.accent);
        this.collapsed.setActive(this.drawn === 'collapsed', snapshot);
        this.expanded.update(snapshot);
        this.expanded.setActive(this.drawn === 'expanded');
        this.machine.setAvailable(snapshot.available);
        if (trackKey(snapshot) !== this.lyricsTrack) this.setLyricsOpen(false);
        // Open, a player coming or going swaps the media view and the idle panel.
        this.draw(this.overlay());
        this.applyProgress();
        this.tick();
        this.updateTimers();
    }

    /** The system switched between its light and dark style. */
    onSystemStyle(): void {
        this.applyPalette();
        if (this.page === 'settings') this.showSettingsPage();
    }

    /** The sound outputs or the one in use changed. */
    onOutputs(): void {
        if (this.destroyed) return;
        const { outputs } = this.sources;
        this.expanded.setOutputs(outputs.list(), outputs.activeId());
    }

    /**
     * Draws the focus timer's time left, or else a countdown, stopwatch or
     * alarm; the session calls it on each change and when the shown second
     * changes.
     */
    onTimer(): void {
        if (this.destroyed) return;
        const timer = this.sources.timer.snapshot();
        const now = GLib.get_monotonic_time();
        const clock = indicatorClock(this.sources.timer.clocks(), now);
        let shown: [string, string, boolean] | null = null;
        if (timer.state !== 'idle')
            shown = [formatRemaining(remainingAt(timer, now)), phaseColor(timer.phase), timer.state === 'paused'];
        else if (clock) shown = [clockText(clock, now), clockColor(clock.kind), !clock.running];
        if (shown) {
            this.idleTimer.update(...shown);
            this.collapsedTimer.update(...shown);
        }
        if (this.drawn === 'panel') this.refreshPanel();
        this.applyIndicator();
    }

    /** The call changed; the session calls it again when its shown second changes. */
    onCall(): void {
        if (this.destroyed) return;
        const call = this.shownCall();
        if (call) {
            const now = GLib.get_monotonic_time();
            this.idleCall.update(callText(call.startedUs, now), call.muted);
            this.collapsedCall.update(callText(call.startedUs, now), call.muted);
        }
        if (this.drawn === 'panel') this.refreshPanel();
        this.applyIndicator();
    }

    /** A screen recording started or stopped; the session calls it again when its shown second changes. */
    onRecording(): void {
        if (this.destroyed) return;
        const since = this.sources.recording.since();
        if (since !== null) {
            const text = formatDuration(GLib.get_monotonic_time() - since);
            this.idleRecording.update(text);
            this.collapsedRecording.update(text);
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

    /** The countdown to a meeting changed, started or ended. */
    onCountdown(): void {
        if (this.destroyed) return;
        const text = this.sources.countdown.text();
        if (text !== null) {
            this.idleCountdown.update(text);
            this.collapsedCountdown.update(text);
        }
        this.applyIndicator();
    }

    /** The weather beside the date or the next events changed. */
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
        this.resizeExpanded();
        if (this.drawn === 'panel') this.refreshPanel();
        this.applyIndicator();
    }

    /** The clipboard history changed, or it was turned on or off. */
    onClipboard(): void {
        if (this.destroyed) return;
        const { clipboard } = this.sources;
        if (!clipboard.enabled() && this.page === 'clipboard') this.setPage(null);
        const before = this.clipboardPage.height;
        this.clipboardPage.show(clipboard.entries(), clipboard.paused());
        if (this.clipboardPage.height !== before) this.resizePage();
        if (this.drawn === 'panel') this.refreshPanel();
    }

    /** A page's body changed height. */
    private resizePage(): void {
        if (this.destroyed) return;
        this.sizePages();
        const [width, height] = this.sizeFor('page');
        if (this.drawn === 'page') this.notch.resizeTo(width, height, 'width');
    }

    /** Each page keeps its own size; their holder takes the open one's. */
    private sizePages(): void {
        const width = this.sources.settings.appearance.expandedWidth;
        this.clipboardSubPage.actor.set_size(width, subPageHeight(this.clipboardPage.height));
        this.timerSubPage.actor.set_size(width, subPageHeight(this.timerPage.height));
        this.settingsSubPage.actor.set_size(width, subPageHeight(this.settingsPage.height));
        const shown = this.page ?? 'clipboard';
        this.clipboardSubPage.actor.visible = shown === 'clipboard';
        this.timerSubPage.actor.visible = shown === 'timer';
        this.settingsSubPage.actor.visible = shown === 'settings';
        this.pages.set_size(...this.sizeFor('page'));
    }

    /**
     * The pointer is on the notch, or it counts as on it: over the helper
     * window, or typing a search. Never over a fullscreen app.
     */
    private pointerInside(): boolean {
        if (!fullscreenView(this.inFullscreen, this.alertOverFullscreen).hover) return false;
        return this.notch.actor.hover || this.helperInside || this.searching || this.outputMenuOpen;
    }

    /** A fullscreen window came or went on some monitor, or the overview opened or closed. */
    private onFullscreen(): void {
        if (this.destroyed) return;
        // Like GNOME's top chrome: a fullscreen window counts only while the windows show.
        const monitor = Main.layoutManager.monitors[this.monitorIndex];
        const fullscreen = global.window_group.visible && monitor?.inFullscreen === true;
        if (fullscreen === this.inFullscreen) return;
        this.inFullscreen = fullscreen;
        // An alert from before goes with the notch; one over the app is no longer over it.
        this.alertOverFullscreen = false;
        this.applyFullscreen();
    }

    private onOsdTimer(active: boolean): void {
        if (!active) this.alertOverFullscreen = false;
        // Over a fullscreen app it hides first, so the views settle at once.
        this.applyFullscreen();
        this.draw(this.overlay());
    }

    /** Shows or hides the notch over a fullscreen app, with unredirection off while it shows there. */
    private applyFullscreen(): void {
        const view = fullscreenView(this.inFullscreen, this.alertOverFullscreen);
        // Hidden, it cannot keep the keyboard.
        if (!view.visible && this.machine.held) this.machine.close();
        if (view.overFullscreen) this.unredirect.set(true);
        if (view.visible !== this.notch.actor.visible) {
            // Hidden at rest, so it comes back at its size and not mid-motion.
            if (!view.visible) this.notch.jumpTo(...this.sizeFor(this.drawn));
            this.notch.actor.visible = view.visible;
        }
        if (!view.overFullscreen) this.unredirect.set(false);
        this.machine.pointer(this.pointerInside());
    }

    /** The notch holds the keyboard: open from the shortcut, or typing a search. */
    get holdsKeyboard(): boolean {
        return this.grab !== null;
    }

    /**
     * The open shortcut: opens the notch (home or the player, as hover
     * would), takes the keyboard and focuses the first button; pressed
     * again while it holds the keyboard, closes it.
     */
    toggleKeyboard(): void {
        if (this.destroyed) return;
        if (this.grab) {
            this.machine.close();
            return;
        }
        if (!this.canShow()) return;
        this.machine.open(true);
        this.updateGrab();
        this.focusView();
    }

    /**
     * The clipboard's search field takes the keyboard while it is open, and
     * keeps the notch open; a click outside the notch closes it.
     */
    private setSearchField(entry: St.Entry | null): void {
        this.searching = entry !== null && !this.destroyed;
        this.updateGrab();
        if (entry && this.grab) entry.grab_key_focus();
        // Back from the field, the keyboard stays with the notch's buttons.
        else if (!entry && this.machine.held) this.focusView();
        if (!this.destroyed) this.machine.pointer(this.pointerInside());
    }

    /**
     * Takes the keyboard (`Main.pushModal`, like a popup menu) while the
     * notch is held open or the search field is open, and lets it go once
     * neither is.
     */
    private updateGrab(): void {
        const wanted = !this.destroyed && (this.machine.held || this.searching);
        if (wanted && !this.grab) {
            this.grab = Main.pushModal(this.notch.actor, { actionMode: Shell.ActionMode.POPUP });
            this.grabEventId = this.notch.actor.connect('captured-event', (_actor, event: Clutter.Event) =>
                this.onGrabbedPress(event),
            );
            this.grabKeyId = this.notch.actor.connect('key-press-event', (_actor, event: Clutter.Event) =>
                this.onKey(event),
            );
            this.keyFocusId = global.stage.connect('notify::key-focus', () => this.onKeyFocus());
        } else if (!wanted && this.grab) {
            this.notch.actor.disconnect(this.grabEventId);
            this.notch.actor.disconnect(this.grabKeyId);
            global.stage.disconnect(this.keyFocusId);
            this.grabEventId = 0;
            this.grabKeyId = 0;
            this.keyFocusId = 0;
            Main.popModal(this.grab);
            this.grab = null;
        }
    }

    /** A press outside the notch closes it when held open, else the search field. */
    private onGrabbedPress(event: Clutter.Event): boolean {
        if (event.type() !== Clutter.EventType.BUTTON_PRESS) return Clutter.EVENT_PROPAGATE;
        const [x, y] = event.get_coords();
        const [ax, ay] = this.notch.body.get_transformed_position();
        const [width, height] = this.notch.body.get_transformed_size();
        if (pointIn({ x: ax, y: ay, width, height }, x, y)) return Clutter.EVENT_PROPAGATE;
        if (this.machine.held) this.machine.close();
        else this.clipboardPage.reset();
        return Clutter.EVENT_STOP;
    }

    /** Held open: Escape closes, Tab and the arrows move the focus; Enter and Space are the button's. */
    private onKey(event: Clutter.Event): boolean {
        if (!this.machine.held) return Clutter.EVENT_PROPAGATE;
        const shift = (event.get_state() & Clutter.ModifierType.SHIFT_MASK) !== 0;
        const action = keyAction(event.get_key_symbol(), shift);
        if (action === null) return Clutter.EVENT_PROPAGATE;
        if (action === 'close') this.machine.close();
        else moveFocus(this.views[this.drawn], action);
        return Clutter.EVENT_STOP;
    }

    /** The focused button went away (hidden or destroyed): the first one of the view takes over. */
    private onKeyFocus(): void {
        if (!this.machine.held) return;
        const focus = keyFocus();
        if (focus === null || focus === global.stage || focus === this.notch.actor) this.focusView();
    }

    /** Focuses the first button of the view that shows, while held open. */
    private focusView(): void {
        if (!this.machine.held || !this.grab) return;
        const view = this.views[this.drawn];
        const focus = keyFocus();
        if (focus && focus !== view && view.contains(focus)) return;
        if (!focusFirst(view)) this.notch.actor.grab_key_focus();
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
        this.machine.pointer(this.pointerInside());
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
        // The lyric row comes and goes with the lyrics.
        this.resizeExpanded();
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
        this.showSettingsPage();
        this.applyClockOptions();
        this.onMedia();
        this.onActivities();
        this.onShelf();
        this.onPrivacy();
        this.onCall();
        this.onRecording();
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

    /**
     * `durationMs` replaces osd_duration_ms, for device alerts. An alert
     * (`tone` set) kicks the notch and glows; a volume or a key does not.
     */
    showOsd(content: OsdContent, icon: Gio.Icon | null, durationMs?: number, tone?: AlertTone): void {
        if (this.destroyed) return;
        // The session sends one here over a fullscreen app only when it is let through.
        if (this.inFullscreen) {
            this.alertOverFullscreen = true;
            this.applyFullscreen();
        }
        this.osdView.show(content, icon, this.osdTimer.active, this.sources.settings.appearance.animationSpeed);
        this.osdTimer.show(durationMs);
        if (tone) this.alert(tone);
        else this.notch.setGlow(null);
    }

    hideOsd(): void {
        if (this.destroyed) return;
        this.osdTimer.hide();
    }

    /**
     * A notification until its time runs out, or its close button; a click
     * on it or one of its buttons calls the handler and closes it. A new one
     * replaces the one that shows.
     */
    showNotification(notification: NotchNotification, durationMs: number): void {
        if (this.destroyed) return;
        const { title, detail, icon, buttons, badge } = notification;
        this.notificationView.show(title, detail, icon, buttons, badge);
        this.notificationClick = () => notification.onClick();
        this.notificationButton = (index) => notification.onButton(index);
        this.screenshotPress = null;
        this.notificationKind = 'notification';
        this.setNotificationButtons(buttons.length > 0);
        this.notificationTimer.show(durationMs);
        this.draw(this.overlay());
        this.alert('accent');
    }

    /** Whether a notification, not a screenshot preview, shows now. */
    get showsNotification(): boolean {
        return !this.destroyed && this.notificationTimer.active && this.notificationKind === 'notification';
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
        this.notificationButton = null;
        this.notificationKind = 'screenshot';
        this.notificationTimer.show(durationMs);
        this.draw(this.overlay());
        this.alert('accent');
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

    /** The width overshoots and springs back, and the glow comes in the alert's colour. */
    private alert(tone: AlertTone): void {
        this.notch.kick(ALERT_KICK);
        const { alertGlow } = this.sources.settings.appearance;
        this.notch.setGlow(alertGlow ? glowColor(tone, this.shownPalette.accent) : null);
    }

    private shownCall(): ReturnType<CallMonitor['call']> {
        return this.sources.settings.behavior.callIndicator ? this.sources.call.call() : null;
    }

    private liveActivities(): readonly Activity[] {
        return this.sources.settings.behavior.liveActivities ? this.sources.activities.list() : [];
    }

    /** The one spot in the closed notch: the clock or the indicator in idle, next to the cover while playing. */
    private applyIndicator(): void {
        const indicator = chooseIndicator({
            recording: this.sources.recording.since() !== null,
            call: this.shownCall() !== null,
            timer: this.sources.timer.snapshot().state !== 'idle',
            clock: indicatorClock(this.sources.timer.clocks(), GLib.get_monotonic_time()) !== null,
            activity: this.liveActivities().length > 0,
            meeting: this.sources.countdown.text() !== null,
            shelf: this.sources.shelf.items().length > 0,
        });
        if (indicator !== this.indicator) {
            this.indicator = indicator;
            this.clock.actor.visible = indicator === null;
            this.idleRecording.actor.visible = indicator === 'recording';
            this.idleCall.actor.visible = indicator === 'call';
            this.idleTimer.actor.visible = indicator === 'timer' || indicator === 'clock';
            this.idleBadge.actor.visible = indicator === 'activity';
            this.idleShelf.actor.visible = indicator === 'shelf';
            this.idleCountdown.actor.visible = indicator === 'meeting';
            const aside = {
                recording: this.collapsedRecording.actor,
                call: this.collapsedCall.actor,
                timer: this.collapsedTimer.actor,
                clock: this.collapsedTimer.actor,
                activity: this.collapsedBadge.actor,
                meeting: this.collapsedCountdown.actor,
                shelf: this.collapsedShelf.actor,
            };
            this.collapsed.setAside(indicator ? aside[indicator] : null);
            this.collapsed.setActive(this.drawn === 'collapsed', this.sources.media.snapshot());
        }
        this.idleBadge.setActive(this.drawn === 'idle' && indicator === 'activity');
        this.collapsedBadge.setActive(this.drawn === 'collapsed' && indicator === 'activity');
        this.applyProgress();
    }

    /** The line along the closed notch: the indicator's progress, else the song beside its cover. */
    private applyProgress(): void {
        const { settings, timer, media } = this.sources;
        const closed = this.drawn === 'idle' || this.drawn === 'collapsed';
        if (!settings.appearance.progressLine || !closed) {
            this.progress.show(null, '', 0);
            return;
        }
        const now = GLib.get_monotonic_time();
        const focus = timer.snapshot();
        const clock = indicatorClock(timer.clocks(), now);
        const song = media.snapshot();
        const span = (totalUs: number, leftUs: number, running: boolean, rate = 1): Span => ({
            totalUs,
            leftUs,
            running,
            rate,
        });
        const line = progressLine({
            indicator: this.indicator,
            collapsed: this.drawn === 'collapsed',
            timer:
                focus.state === 'idle'
                    ? null
                    : span(focus.durationUs, remainingAt(focus, now), focus.state === 'running'),
            clock: clock?.kind === 'countdown' ? span(clock.durationUs, clockValueAt(clock, now), clock.running) : null,
            activity: this.liveActivities()[0]?.progress ?? -1,
            song:
                song.lengthUs > 0
                    ? span(song.lengthUs, song.lengthUs - this.positionNow(), song.playbackStatus === 'Playing', song.rate)
                    : null,
        });
        this.progress.show(line, this.shownPalette.accent, settings.appearance.cornerRadius);
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

    /** Once a second while the open panel shows a time that counts: a recording, a call, an activity or a clock. */
    private updatePanelTick(): void {
        const ticking = (row: PanelRow): boolean => row === 'recording' || row === 'call' || row === 'activity' || row === 'clock';
        const run = this.drawn === 'panel' && this.panelRows.some(ticking);
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
        this.notificationButton = null;
        this.notificationTimer.hide();
        click?.();
    }

    private onNotificationButton(index: number): void {
        const press = this.notificationButton;
        this.notificationClick = null;
        this.notificationButton = null;
        this.notificationTimer.hide();
        press?.(index);
    }

    /** The notification grows by its row of buttons, also while one shows. */
    private setNotificationButtons(buttons: boolean): void {
        if (this.notificationButtons === buttons) return;
        this.notificationButtons = buttons;
        const [width, height] = this.sizeFor('notification');
        this.notificationView.actor.set_size(width, height);
        if (this.drawn === 'notification') this.notch.resizeTo(width, height, 'width');
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
        if (mode !== 'expanded') return mode;
        if (this.page) return 'page';
        return this.homeOpen || !this.sources.media.snapshot().available ? 'panel' : mode;
    }

    private onMode(): void {
        // Closing the notch goes back to its first page, and lets go of the keyboard.
        if (this.machine.mode !== 'expanded') {
            this.homeOpen = false;
            if (this.page) this.clipboardPage.reset();
            this.page = null;
            this.updateGrab();
        }
        this.draw(this.overlay());
    }

    /** Opens a page over home, or goes back to home with null. */
    private setPage(page: PageName | null): void {
        if (this.page === page) return;
        // Back from a page lands on home, also over a player.
        if (page) this.homeOpen = true;
        else this.clipboardPage.reset();
        this.page = page;
        if (page === 'settings') this.showSettingsPage();
        this.sizePages();
        this.draw(this.overlay());
    }

    /** The settings page as the daemon has them, with the cover's color for aurora's swatch. */
    private showSettingsPage(): void {
        if (this.destroyed) return;
        const { settings, media, systemStyle } = this.sources;
        const picture = { ...settings.picture, darken: settings.appearance.pictureDarken };
        this.settingsPage.show(settings.appearance, media.snapshot().accentColor, systemStyle.dark(), picture);
    }

    private setHomeOpen(open: boolean): void {
        if (this.homeOpen === open) return;
        this.homeOpen = open;
        this.draw(this.overlay());
    }

    private draw(mode: Drawn): void {
        const previous = this.drawn;
        if (mode === previous) return;
        this.drawn = mode;
        // The open player may show the blurred cover.
        this.applyPalette();
        if (mode !== 'expanded') {
            this.setLyricsOpen(false);
            this.expanded.closeMenus();
        }
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
            drawn === 'page' ||
            drawn === 'notification' ||
            drawn === 'screenshot' ||
            drawn === 'drop';
        const kind = tall(mode) ? 'open' : tall(previous) ? 'close' : 'width';
        this.notch.resizeTo(width, height, kind);
        // The glow goes with the alert.
        if (mode !== 'osd' && mode !== 'notification' && mode !== 'screenshot') this.notch.setGlow(null);
        this.showView(mode);
        // The open notch's buttons take the focus; held open, the new view's first one has it.
        if (tall(mode)) focusButtons(this.views[mode]);
        this.focusView();
        this.showPrivacyDots();
        if (mode === 'idle') this.clock.start();
        else this.clock.stop();
        this.collapsed.setActive(mode === 'collapsed', this.sources.media.snapshot());
        this.expanded.setActive(mode === 'expanded');
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
        if (mode === 'notification') {
            const buttons = this.notificationButtons ? NOTIFICATION_BUTTONS_EXTRA : 0;
            return [a.expandedWidth, a.height + NOTIFICATION_EXTRA_HEIGHT + buttons];
        }
        if (mode === 'screenshot') return [a.expandedWidth, a.height + SCREENSHOT_EXTRA_HEIGHT];
        if (mode === 'drop') return [a.expandedWidth, a.height + DROP_EXTRA_HEIGHT];
        if (mode === 'panel') return [a.expandedWidth, panelHeight(a.height, this.panelRows)];
        if (mode === 'page') {
            const body =
                this.page === 'timer'
                    ? this.timerPage.height
                    : this.page === 'settings'
                      ? this.settingsPage.height
                      : this.clipboardPage.height;
            return [a.expandedWidth, subPageHeight(body)];
        }
        if (mode === 'expanded') {
            const lyrics = this.lyricsOpen ? SHEET_EXTRA_HEIGHT : this.lyricsAvailable() ? LYRIC_ROW_EXTRA : 0;
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
        this.sizePages();
        // The open player's padding is 18 px a side.
        const lyricWidth = this.sources.settings.appearance.expandedWidth - 36;
        this.lyricLine.setWidth(lyricWidth);
        this.lyricsSheet.setWidth(lyricWidth);
    }

    /** The open player's size changed: a row came or went. */
    private resizeExpanded(): void {
        const [width, height] = this.sizeFor('expanded');
        this.expanded.actor.set_size(width, height);
        if (this.drawn === 'expanded') this.notch.resizeTo(width, height, 'width');
    }

    /** The theme's colors with the cover's worked in, or the blurred cover's behind the open player. */
    private palette(): Palette {
        const appearance = this.sources.settings.appearance;
        const { accentColor, backdropPath } = this.sources.media.snapshot();
        const backdrop = backdropFor({ on: appearance.coverBackdrop, view: this.drawn, backdrop: backdropPath });
        if (backdrop) return backdropPalette(appearance, accentColor, backdrop);
        const theme = themeFor(appearance, this.sources.systemStyle.dark());
        const picture = { ...this.sources.settings.picture, darken: appearance.pictureDarken };
        return paletteFor(theme, appearance, accentColor, picture);
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
        const { foreground, accent, onAccent, light } = this.shownPalette;
        this.expanded.setPalette(this.shownPalette);
        this.expanded.progress.setColors(accent, withAlpha(foreground, 0.25));
        // The levels are the system's, not the song's: the bar takes the text color.
        this.osdView.setColors(foreground, withAlpha(foreground, 0.2));
        this.idlePanel.setColors({ foreground, accent, onAccent, light });
        this.clipboardPage.setColors({ foreground, accent });
        this.timerPage.setColors({ foreground });
        this.settingsPage.setColors({ foreground, accent, onAccent });
        this.dropView.setForeground(foreground);
        this.screenshotView.setForeground(foreground);
        this.notificationView.setColors(foreground, accent, onAccent);
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
        const playing = snapshot.playbackStatus === 'Playing';
        const progress = lineProgress(lyrics.lines, position, snapshot.rate);
        const romanized = (line: string): string | null => (settings.lyrics.romanize ? romanize(line) : null);
        if (this.lyricsOpen) {
            this.lyricLine.show(null);
            const around = lyricWindow(lyrics.lines, position, SHEET_ROWS);
            const current = around.rows[Math.floor(SHEET_ROWS / 2)];
            this.lyricsSheet.show(around, progress, playing, lyrics.offsetMs, romanized(current));
            return;
        }
        const text = visibleLyric(lyrics.status, lyrics.lines, settings.behavior.showLyrics, position);
        this.lyricLine.show(
            text === null
                ? null
                : { text, next: nextLyric(lyrics.lines, position), romanized: romanized(text), ...progress, playing },
        );
    }

    /** What the full-screen lyrics show now; null closes them. */
    private fullscreenFrame(): FullscreenFrame | null {
        if (this.destroyed || !this.lyricsAvailable()) return null;
        const { media, lyrics, settings } = this.sources;
        const snapshot = media.snapshot();
        const position = this.positionNow();
        return {
            lines: fullscreenLines(lyrics.lines, position, settings.lyrics.romanize),
            ...lineProgress(lyrics.lines, position, snapshot.rate),
            playing: snapshot.playbackStatus === 'Playing',
            title: snapshot.title,
            artist: snapshot.artists.join(', '),
            backdropPath: snapshot.backdropPath,
        };
    }

    private lyricsAvailable(): boolean {
        const { status, lines } = this.sources.lyrics;
        return status === 'synced' && lines.length > 0 && this.sources.settings.behavior.showLyrics;
    }

    /** Opens or closes the lyrics view; the open notch grows or shrinks with it. */
    private setLyricsOpen(open: boolean): void {
        const wanted = open && this.drawn === 'expanded' && this.lyricsAvailable();
        if (wanted === this.lyricsOpen) return;
        this.lyricsOpen = wanted;
        this.lyricsTrack = wanted ? trackKey(this.sources.media.snapshot()) : '';
        this.lyricsSheet.reset();
        this.lyricsSheet.actor.visible = wanted;
        this.resizeExpanded();
        if (this.drawn === 'expanded') this.tick();
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
    const clocks = Math.min(content.clocks.length, MAX_PANEL_CLOCKS);
    const events = Math.min(content.events.length, MAX_PANEL_EVENTS);
    const event: PanelRow[] = events > 0 ? ['event', ...Array<PanelRow>(events - 1).fill('agenda')] : [];
    const recording: PanelRow[] = content.recording !== null ? ['recording'] : [];
    const call: PanelRow[] = content.call ? ['call'] : [];
    const files: PanelRow[] = shelf ? ['shelf'] : [];
    const shown = shownControls(content.layout, content.toggles, content.clipboard);
    const toggles: PanelRow[] = shown.toggles.length > 0 ? ['toggles'] : [];
    const tiles: PanelRow[] = shown.tiles.length > 0 ? ['tiles'] : [];
    return [
        'date',
        ...event,
        ...recording,
        ...call,
        ...Array<PanelRow>(activities).fill('activity'),
        ...Array<PanelRow>(clocks).fill('clock'),
        ...files,
        ...toggles,
        ...tiles,
    ];
}
