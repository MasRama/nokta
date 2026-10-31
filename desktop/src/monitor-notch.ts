import { visibleLyric } from '@ext/features/lyrics/logic/visible.js';
import { lineProgress, nextLyric } from '@ext/features/lyrics/logic/karaoke.js';
import { romanize } from '@ext/features/lyrics/logic/romanize.js';
import { PEEK_MS, shouldPeek, type PeekTrack } from '@ext/features/media/logic/peek.js';
import type { MediaSnapshot } from '@ext/features/media/logic/snapshot.js';
import { OsdTimer } from '@ext/features/osd/logic/timer.js';
import { panelHeight, subPageHeight, type PanelRow } from '@ext/features/panel/logic/height.js';
import type { HomeTile } from '@ext/features/panel/logic/layout.js';
import { callDetail, callText, msUntilElapsedSecond } from '@ext/features/privacy/logic/call.js';
import { dotsFor } from '@ext/features/privacy/logic/dots.js';
import {
    clockColor,
    clockDetail,
    clockText,
    clockTitle,
    clockValueAt,
    indicatorClock,
    msUntilClockChange,
} from '@ext/features/timer/logic/clocks.js';
import { formatRemaining, msUntilNextSecond, phaseColor, remainingAt } from '@ext/features/timer/logic/timer.js';
import { drawnView, resizeKind, showsAlert, viewSize, type Drawn } from '@ext/logic/views.js';
import { motionKicks, type AlertMotion } from '@ext/shared/logic/alert-motion.js';
import { backdropFor, backdropPalette } from '@ext/shared/logic/backdrop.js';
import { withAlpha } from '@ext/shared/logic/color.js';
import { formatClock, uses24h } from '@ext/shared/logic/format.js';
import { fullscreenView, showsOverFullscreen } from '@ext/shared/logic/fullscreen.js';
import { glowColor, type AlertTone } from '@ext/shared/logic/glow.js';
import { _ } from '@ext/shared/logic/i18n.js';
import { chooseIndicator, type Indicator } from '@ext/shared/logic/indicator.js';
import { keyframeSteps, PULSE, SHAKE, SHAKE_STEP_MS } from '@ext/shared/logic/keyframes.js';
import { NotchMachine } from '@ext/shared/logic/machine.js';
import { progressLine, type Span } from '@ext/shared/logic/progress-line.js';
import { depthFor, paletteFor, themeFor, type Palette } from '@ext/shared/logic/theme.js';

import { Alerts, CLOCK_ICON, clockDoneRequest, finishedRequest, TIMER_ICON, type OsdRequest } from './alerts.js';
import type { Bridge } from './bridge/bridge.js';
import { focusFirst, keyActionOf, moveFocus } from './focus.js';
import { Lyrics, Media, nowUs } from './media.js';
import { Notch, type Box, type Frames, type NotchStyle } from './notch/notch.js';
import { Privacy } from './privacy.js';
import { Settings } from './settings.js';
import { Timer } from './timer.js';
import { Toggles, windowsControls } from './toggles.js';
import { everyMinute } from './views/clock.js';
import { CollapsedView } from './views/collapsed.js';
import { ExpandedView } from './views/expanded.js';
import { HomeView, homeRows } from './views/home.js';
import { IdleView } from './views/idle.js';
import { LYRIC_ROW_EXTRA } from './views/lyric-line.js';
import { OsdView } from './views/osd.js';
import { PeekView } from './views/peek.js';
import { CallLabel, PrivacyDots, type HomeCall } from './views/privacy.js';
import { ProgressLine } from './views/progress-line.js';
import { SubPage } from './views/subpage.js';
import { TimerLabel, TimerPage, type HomeClock } from './views/timer.js';
import { Weather } from './weather.js';

/** What the page needs from where it runs: the app or the browser mock. */
export interface Host {
    /** Whether Windows' region shows a 24-hour clock. */
    systemUses24h(): boolean;
    /** Tells the window which part takes clicks. */
    setHit(hit: Box): void;
    /** Calls back when the pointer comes over the notch or leaves it. */
    onPointer(cb: (inside: boolean) => void, hit: () => Box | null): void;
    /** Calls back when a fullscreen app comes over the monitor or goes; none in a browser. */
    onFullscreen?(cb: (fullscreen: boolean) => void): void;
    /** Calls back when the open shortcut is pressed for this window; none in a browser. */
    onKeyboard?(cb: () => void): void;
    /** The notch the shortcut opened closed: the window it took the keyboard from gets it back. */
    releaseKeyboard?(): void;
    /** Opens one of Windows' panels or a web page. */
    openUri?(uri: string): void;
}

/** What a home tile opens on Windows, for the tiles that open one of its panels (desktop/src-tauri/src/links.rs). */
const TILE_URIS: Partial<Record<HomeTile, string>> = {
    notifications: 'ms-actioncenter:',
    screenshot: 'ms-screenclip:',
};

/** No click goes to the notch while it hides. */
const NO_HIT: Box = { x: 0, y: 0, width: 0, height: 0 };

/** An alert pushes the notch this much wider before it springs back. */
const ALERT_KICK = 0.06;

/** A page a home tile opens. */
type PageName = 'timer';

/** How often the open player moves its progress and its lyric on, and home its clocks. */
const TICK_MS = 250;

/** Tells one song from the next, as the extension's. */
function trackKey(s: MediaSnapshot): string {
    return [s.playerId, s.title, ...s.artists].join('\n');
}

/**
 * The notch of one window, on one monitor: the settings and the player from
 * the core, the state machine the pointer drives, and the view for each
 * state. The Windows twin of the extension's monitor-notch.ts, which it
 * grows into part by part.
 */
export class MonitorNotch {
    readonly notch: Notch;
    readonly settings: Settings;
    readonly media: Media;
    readonly lyrics: Lyrics;
    readonly privacy: Privacy;
    readonly weather: Weather;
    readonly toggles: Toggles;
    readonly timer: Timer;
    private readonly machine: NotchMachine;
    private readonly idle = new IdleView();
    private readonly home: HomeView;
    private readonly collapsed: CollapsedView;
    private readonly peek: PeekView;
    private readonly expanded: ExpandedView;
    private readonly osd = new OsdView();
    private readonly osdTimer: OsdTimer;
    private readonly alerts: Alerts;
    private readonly privacyDots = new PrivacyDots();
    private readonly progress = new ProgressLine();
    /** The call in the idle view and in the collapsed one. */
    private readonly calls = { idle: new CallLabel(), collapsed: new CallLabel() };
    /** The focus timer or a clock, in the same two places. */
    private readonly timerLabels = { idle: new TimerLabel(), collapsed: new TimerLabel() };
    private readonly timerPage: TimerPage;
    /** The pages home's tiles open, one shown at a time. */
    private readonly pages: HTMLDivElement;
    private readonly subPages: Record<PageName, HTMLElement>;
    private page: PageName | null = null;
    /** Home moves its clocks on while it shows them. */
    private homeTicker = 0;
    private readonly views: Partial<Record<Drawn, HTMLElement>>;
    private drawn: Drawn = 'idle';
    private hit: Box | null = null;
    private homeOpen = false;
    /** Home's rows, for its height. */
    private homeRows: PanelRow[] = ['date'];
    private peekTimer = 0;
    private peekTrack: PeekTrack | null = null;
    private ticker = 0;
    private shownPalette: Palette | null = null;
    private stopClock: (() => void) | null = null;
    private privacyCount = 0;
    /** Until the closed notch's call, timer or clock shows its next second. */
    private indicatorTimer = 0;
    /** What the closed notch's one spot shows. */
    private indicator: Indicator | null = null;
    /** A fullscreen app covers the monitor: the notch hides. */
    private inFullscreen = false;
    /** An alert let through over the fullscreen app shows until it ends. */
    private alertOverFullscreen = false;
    /** The pointer is over the notch, as the window last said. */
    private pointerOver = false;
    /** The open shortcut opened the notch, and it has the keyboard. */
    private keyboard = false;
    private readonly onKeyDown = (event: KeyboardEvent) => this.onKey(event);
    /** The window lost the keyboard: a click or a switch elsewhere closes the notch. */
    private readonly onBlur = () => {
        if (this.keyboard && this.machine.held) this.machine.close();
    };

    constructor(
        bridge: Bridge,
        private readonly host: Host,
        root: HTMLElement,
        frames?: Frames,
    ) {
        this.settings = new Settings(bridge, () => this.restyle());
        this.media = new Media(bridge, () => this.onMedia());
        this.lyrics = new Lyrics(bridge, () => this.onLyrics());
        this.privacy = new Privacy(bridge, () => this.onPrivacy());
        this.weather = new Weather(bridge, () => this.onHome());
        this.toggles = new Toggles(bridge, () => this.onToggles());
        this.timer = new Timer(
            bridge,
            () => this.onTimer(),
            (phase) => this.onTimerFinished(phase),
            (kind, label) => this.onClockDone(kind, label),
        );
        this.home = new HomeView({
            openPlayer: () => this.setHomeOpen(false),
            pauseClock: (id, pause) => this.timer.pauseClock(id, pause),
            removeClock: (id) => this.timer.removeClock(id),
            toggleCallMute: () => this.privacy.toggleMute(),
            hideCall: () => {
                this.privacy.hideCall();
                this.onPrivacy();
            },
            toggle: (which) => this.toggles.toggle(which),
            openTile: (which) => this.openTile(which),
        });
        this.collapsed = new CollapsedView(() => this.media.levels());
        this.peek = new PeekView(() => this.media.levels());
        this.expanded = new ExpandedView(this.media, () => this.setHomeOpen(true));
        // What a preset starts shows in home, so it goes back there.
        this.timerPage = new TimerPage({
            countdown: (minutes) => {
                this.timer.addCountdown(minutes);
                this.setPage(null);
            },
            stopwatch: () => {
                this.timer.addStopwatch();
                this.setPage(null);
            },
        });
        this.subPages = { timer: new SubPage('Timer', this.timerPage.element, () => this.setPage(null)).element };
        this.pages = document.createElement('div');
        this.pages.className = 'nokta-view nokta-pages';
        this.pages.append(...Object.values(this.subPages));
        this.views = {
            idle: this.idle.element,
            collapsed: this.collapsed.element,
            peek: this.peek.element,
            expanded: this.expanded.element,
            panel: this.home.element,
            page: this.pages,
            osd: this.osd.element,
        };
        this.notch = new Notch(this.style(), this.palette(), (hit) => this.report(hit), frames);
        this.notch.body.append(...Object.values(this.views), this.privacyDots.element, this.progress.element);
        // A view with no buttons leaves the focus on the notch.
        this.notch.element.tabIndex = -1;
        root.append(this.notch.element);
        this.machine = new NotchMachine(
            (ms, fn) => {
                const timer = window.setTimeout(fn, ms);
                return () => window.clearTimeout(timer);
            },
            () => {
                const b = this.settings.behavior;
                return { openMs: b.openDelayMs, closeMs: b.closeDelayMs, openOn: b.openOn };
            },
            () => this.onMode(),
        );
        // A click on a button does its own thing; anywhere else it opens or closes.
        this.notch.body.addEventListener('click', (e) => {
            if (!(e.target as HTMLElement).closest('button, .nokta-progress-hit')) this.machine.click();
        });
        this.osdTimer = new OsdTimer(
            (ms, fn) => {
                const timer = window.setTimeout(fn, ms);
                return () => window.clearTimeout(timer);
            },
            () => this.settings.behavior.osdDurationMs,
            (active) => this.onOsdTimer(active),
        );
        this.alerts = new Alerts(
            bridge,
            () => ({ behavior: this.settings.behavior, motions: this.settings.appearance.alertMotion }),
            (request) => this.showOsd(request),
        );
        host.onPointer(
            (inside) => {
                this.pointerOver = inside;
                this.machine.pointer(this.pointerInside());
            },
            () => this.hit,
        );
        host.onFullscreen?.((fullscreen) => this.setFullscreen(fullscreen));
        host.onKeyboard?.(() => this.toggleKeyboard());
        document.addEventListener('keydown', this.onKeyDown);
        window.addEventListener('blur', this.onBlur);
    }

    /** Lays out in a window `width` CSS px wide and follows the core. */
    async start(width: number): Promise<void> {
        this.notch.setArea(width);
        this.restyle();
        this.stopClock = everyMinute((now) => this.tickClock(now));
        this.alerts.attach();
        await Promise.all([
            this.settings.attach(),
            this.media.attach(),
            this.lyrics.attach(),
            this.privacy.attach(),
            this.weather.attach(),
            this.toggles.attach(),
            this.timer.attach(),
        ]);
    }

    /** Opens the notch at once; `hold` keeps it open until it is closed. */
    open(hold = false): void {
        this.machine.open(hold);
    }

    /** The window's width changed. */
    setArea(width: number): void {
        this.notch.setArea(width);
    }

    stop(): void {
        document.removeEventListener('keydown', this.onKeyDown);
        window.removeEventListener('blur', this.onBlur);
        this.stopClock?.();
        this.settings.detach();
        this.media.detach();
        this.lyrics.detach();
        this.privacy.detach();
        this.weather.detach();
        this.toggles.detach();
        this.timer.detach();
        window.clearTimeout(this.indicatorTimer);
        window.clearInterval(this.homeTicker);
        this.alerts.detach();
        this.osdTimer.destroy();
        this.machine.destroy();
        window.clearTimeout(this.peekTimer);
        window.clearInterval(this.ticker);
        this.collapsed.destroy();
        this.peek.destroy();
        this.expanded.destroy();
        this.notch.destroy();
    }

    /**
     * A volume, a key or an alert in place of what shows, until its time
     * runs out. An alert (`tone` set) kicks the notch and glows; a volume or
     * a key does not.
     */
    showOsd({ content, icon, kind, durationMs, tone, motion = 'kick' }: OsdRequest): void {
        if (this.inFullscreen) {
            if (!showsOverFullscreen(kind, this.settings.behavior.fullscreenAlerts)) return;
            this.alertOverFullscreen = true;
            this.applyFullscreen();
        }
        window.clearTimeout(this.peekTimer);
        this.peekTimer = 0;
        const speed = this.settings.appearance.animationSpeed;
        this.osd.show(content, icon, this.osdTimer.active, speed);
        this.osdTimer.show(durationMs);
        if (tone) {
            this.osd.playMotion(motion, speed);
            this.alert(tone, motion);
        } else {
            this.notch.stopMotion();
            this.notch.setGlow(null);
        }
    }

    /**
     * The open shortcut: opens the notch (home or the player, as hover
     * would) with the keyboard and focuses the first button; pressed again
     * while open, closes it.
     */
    toggleKeyboard(): void {
        if (this.machine.held) {
            this.machine.close();
            return;
        }
        // A fullscreen app hides the notch: the keyboard goes back at once.
        if (!fullscreenView(this.inFullscreen, this.alertOverFullscreen).visible) {
            this.host.releaseKeyboard?.();
            return;
        }
        this.keyboard = true;
        this.machine.open(true);
        this.focusView();
    }

    /** Held open: Escape closes, Tab and the arrows move the focus; Enter and Space are the button's. */
    private onKey(event: KeyboardEvent): void {
        if (!this.machine.held) return;
        const action = keyActionOf(event);
        if (action === null) return;
        event.preventDefault();
        const view = this.views[this.drawn];
        if (action === 'close') this.machine.close();
        else if (view) moveFocus(view, action);
    }

    /** Focuses the first button of the view that shows, unless the focus is in it already. */
    private focusView(): void {
        if (!this.keyboard || !this.machine.held) return;
        const view = this.views[this.drawn];
        if (!view || view.contains(document.activeElement)) return;
        if (!focusFirst(view)) this.notch.element.focus();
    }

    /** A fullscreen app came over the monitor or went. */
    setFullscreen(fullscreen: boolean): void {
        if (fullscreen === this.inFullscreen) return;
        this.inFullscreen = fullscreen;
        this.applyFullscreen();
    }

    private onOsdTimer(active: boolean): void {
        if (!active) this.alertOverFullscreen = false;
        // Over a fullscreen app it hides first, so the views settle at once.
        this.applyFullscreen();
        this.redraw();
    }

    /** Shows or hides the notch over a fullscreen app, as the extension does. */
    private applyFullscreen(): void {
        const view = fullscreenView(this.inFullscreen, this.alertOverFullscreen);
        if (!view.visible && this.machine.held) this.machine.close();
        const hidden = this.notch.element.style.visibility === 'hidden';
        if (view.visible === hidden) {
            // Hidden at rest, so it comes back at its size and not mid-motion.
            if (!view.visible) this.notch.jumpTo(...this.sizeFor(this.drawn));
            this.notch.element.style.visibility = view.visible ? '' : 'hidden';
            if (this.hit) this.report(this.hit);
        }
        this.machine.pointer(this.pointerInside());
    }

    /** Whether the pointer counts as over the notch: never while a fullscreen app has it. */
    private pointerInside(): boolean {
        return fullscreenView(this.inFullscreen, this.alertOverFullscreen).hover && this.pointerOver;
    }

    /**
     * The width overshoots and springs back, and the glow comes in the
     * alert's colour. A low battery's glow beats instead of the kick, and a
     * failure shakes the notch.
     */
    private alert(tone: AlertTone, motion: AlertMotion): void {
        this.notch.stopMotion();
        if (motionKicks(motion)) this.notch.kick(ALERT_KICK);
        const { alertGlow, animationSpeed } = this.settings.appearance;
        this.notch.setGlow(alertGlow ? glowColor(tone, this.shownPalette?.accent ?? '#ffffff') : null);
        if (motion === 'pulse') this.notch.pulseGlow(PULSE.beats, PULSE.beatMs);
        if (motion === 'shake') this.notch.shake(keyframeSteps(SHAKE, SHAKE_STEP_MS, animationSpeed));
    }

    private style(): NotchStyle {
        return { ...this.settings.appearance };
    }

    /** The theme's colours with the cover's worked in, or the blurred cover's behind the open player. */
    private palette(): Palette {
        const a = this.settings.appearance;
        const { accentColor, backdropPath } = this.media.snapshot;
        const backdrop = backdropFor({ on: a.coverBackdrop, view: this.drawn, backdrop: backdropPath });
        if (backdrop) return backdropPalette(a, accentColor, backdrop);
        const { path, color, tone } = this.settings.picture;
        return paletteFor(themeFor(a, this.toggles.state.dark_style), a, accentColor || null, { path, color, tone, darken: a.pictureDarken });
    }

    private applyPalette(): void {
        const palette = this.palette();
        this.notch.setDepth(depthFor(palette.light, this.settings.appearance.depth));
        if (JSON.stringify(palette) === JSON.stringify(this.shownPalette)) return;
        this.shownPalette = palette;
        this.notch.setPalette(palette);
        this.expanded.setPalette(palette);
        this.expanded.progress.setColors(palette.accent, withAlpha(palette.foreground, 0.25));
        // The levels are the system's, not the song's: the bar takes the text color.
        this.osd.setColors(palette.foreground, withAlpha(palette.foreground, 0.2));
        this.home.setColors({ foreground: palette.foreground, light: palette.light });
        this.timerPage.setColors(palette);
        this.updateViews();
        this.applyProgress();
    }

    private restyle(): void {
        this.notch.setAppearance(this.style());
        this.shownPalette = null;
        this.applyPalette();
        this.tickClock(new Date());
        this.onPrivacy();
        this.onHome();
        this.redraw(true);
    }

    /** Windows' dark style may pick the notch's light theme. */
    private onToggles(): void {
        this.applyPalette();
        this.onHome();
    }

    /** The weather, a toggle, a clock or home's layout changed: home shows it, at its new height. */
    private onHome(): void {
        const layout = windowsControls(this.settings.home);
        const { snapshot, clocks } = this.timer;
        this.home.setWeather(this.weather.line);
        this.tickHome();
        this.home.setControls(layout, this.toggles.state, {
            focus: snapshot.state !== 'idle',
            timer: clocks.length > 0,
        });
        this.updateHomeTicker();
        const rows = homeRows(layout, { call: this.shownCall() !== null, clocks: clocks.length });
        if (rows.join() === this.homeRows.join()) return;
        this.homeRows = rows;
        if (this.drawn === 'panel') this.notch.resizeTo(...this.sizeFor('panel'), 'width');
    }

    /** The clocks as home's rows show them, newest first. */
    /** The call, unless hidden or the call indicator is off. */
    private shownCall() {
        return this.settings.behavior.callIndicator ? this.privacy.currentCall() : null;
    }

    private homeCall(): HomeCall | null {
        const call = this.shownCall();
        if (!call) return null;
        return { title: call.app || _('Microphone'), detail: callDetail(call.sinceUs, nowUs(), call.muted), muted: call.muted };
    }

    /** Home's rows that count on: the call's time and the clocks'. */
    private tickHome(): void {
        this.home.setCall(this.homeCall());
        this.home.setClocks(this.homeClocks());
    }

    private homeClocks(): HomeClock[] {
        const now = nowUs();
        const use24h = this.use24h();
        return this.timer.clocks.map((clock) => ({
            id: clock.id,
            icon: clock.kind === 'alarm' ? TIMER_ICON : CLOCK_ICON,
            color: clockColor(clock.kind),
            title: clockTitle(clock),
            detail: clockDetail(clock, clock.alarmUnixUs ? formatClock(new Date(clock.alarmUnixUs / 1000), use24h) : ''),
            time: clockText(clock, now),
            running: clock.running,
            canPause: clock.kind !== 'alarm',
        }));
    }

    /** Home moves its clocks on while it shows them. */
    private updateHomeTicker(): void {
        const run = this.drawn === 'panel' && (this.timer.clocks.length > 0 || this.shownCall() !== null);
        if (run && !this.homeTicker) {
            this.homeTicker = window.setInterval(() => this.tickHome(), TICK_MS);
        } else if (!run && this.homeTicker) {
            window.clearInterval(this.homeTicker);
            this.homeTicker = 0;
        }
    }

    /** The focus timer or the clocks changed. */
    private onTimer(): void {
        this.applyIndicator();
        this.onHome();
    }

    /** A focus session or a break ran out. */
    private onTimerFinished(phase: string): void {
        const { timer, behavior, appearance } = this.settings;
        const request = finishedRequest(phase, this.timer.snapshot, timer, behavior, appearance.alertMotion);
        if (request) this.showOsd(request);
    }

    /** A countdown ran out or an alarm went off. */
    private onClockDone(kind: string, label: string): void {
        const { behavior, appearance } = this.settings;
        const time = formatClock(new Date(), this.use24h());
        const request = clockDoneRequest(kind, label, time, behavior, appearance.alertMotion);
        if (request) this.showOsd(request);
    }

    /** A tile opens its page, works its feature, or closes the notch and opens what it stands for. */
    private openTile(which: HomeTile): void {
        if (which === 'timer') {
            this.setPage('timer');
            return;
        }
        if (which === 'focus') {
            this.timer.toggleFocus();
            return;
        }
        const uri = TILE_URIS[which];
        if (!uri) return;
        this.machine.close();
        this.host.openUri?.(uri);
    }

    /** The camera or the microphone came on or went off. */
    private onPrivacy(): void {
        const { appearance, behavior } = this.settings;
        const dots = dotsFor(this.privacy.state, behavior.privacyDots);
        this.privacyCount = dots.length;
        const inset = this.privacyDots.update(dots, appearance.height, appearance.cornerRadius);
        this.collapsed.setInset(inset);
        this.peek.setInset(inset);
        this.showPrivacyDots();
        this.applyIndicator();
        this.onHome();
    }

    /** The dots belong to the closed notch. */
    private showPrivacyDots(): void {
        const closed = this.drawn === 'idle' || this.drawn === 'collapsed' || this.drawn === 'peek';
        this.privacyDots.setVisible(this.privacyCount > 0 && closed);
    }

    /**
     * The one spot in the closed notch, in the clock's place or beside the
     * cover: the call, else the focus timer, else a countdown, stopwatch or
     * alarm. It counts on, second by second.
     */
    private applyIndicator(): void {
        window.clearTimeout(this.indicatorTimer);
        this.indicatorTimer = 0;
        const now = nowUs();
        const call = this.shownCall();
        const { snapshot, clocks } = this.timer;
        const clock = indicatorClock(clocks, now);
        const indicator = chooseIndicator({
            recording: false,
            call: call !== null,
            timer: snapshot.state !== 'idle',
            clock: clock !== null,
            activity: false,
            shelf: false,
        });
        this.indicator = indicator;
        const shown = (place: 'idle' | 'collapsed'): HTMLElement | null => {
            if (indicator === 'call') return this.calls[place].element;
            if (indicator === 'timer' || indicator === 'clock') return this.timerLabels[place].element;
            return null;
        };
        this.idle.setAside(shown('idle'));
        this.collapsed.setAside(shown('collapsed'));
        this.setActive();
        const waits: number[] = [];
        if (call) {
            const text = callText(call.sinceUs, now);
            this.calls.idle.update(text, call.muted);
            this.calls.collapsed.update(text, call.muted);
            waits.push(msUntilElapsedSecond(call.sinceUs, now));
        }
        let label: [string, string, boolean] | null = null;
        if (indicator === 'timer') {
            label = [formatRemaining(remainingAt(snapshot, now)), phaseColor(snapshot.phase), snapshot.state === 'paused'];
            const wait = msUntilNextSecond(snapshot, now);
            if (wait !== null) waits.push(wait);
        } else if (indicator === 'clock' && clock) {
            label = [clockText(clock, now), clockColor(clock.kind), !clock.running];
        }
        if (label) for (const timer of Object.values(this.timerLabels)) timer.update(...label);
        // Also an alarm coming into its last hour takes the spot.
        const wait = msUntilClockChange(clocks, now);
        if (wait !== null) waits.push(wait);
        if (waits.length > 0) this.indicatorTimer = window.setTimeout(() => this.applyIndicator(), Math.min(...waits));
        this.applyProgress();
    }

    /** The line along the closed notch: the indicator's progress, else the song beside its cover. */
    private applyProgress(): void {
        const { appearance } = this.settings;
        if (!appearance.progressLine || (this.drawn !== 'idle' && this.drawn !== 'collapsed')) {
            this.progress.show(null, '', 0);
            return;
        }
        const now = nowUs();
        const { snapshot: focus, clocks } = this.timer;
        const clock = indicatorClock(clocks, now);
        const song = this.media.snapshot;
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
            activity: -1,
            song:
                song.lengthUs > 0
                    ? span(song.lengthUs, song.lengthUs - this.media.positionNow(), song.playbackStatus === 'Playing', song.rate)
                    : null,
        });
        this.progress.show(line, this.shownPalette?.accent ?? '#ffffff', appearance.cornerRadius);
    }

    private onMedia(): void {
        const snapshot = this.media.snapshot;
        this.applyPalette();
        this.updateViews();
        this.home.setPlayer(snapshot.available);
        this.machine.setAvailable(snapshot.available);
        this.peekOnNewTrack(snapshot);
        this.redraw();
        this.tick();
    }

    private onLyrics(): void {
        // The lyric row comes and goes with the lyrics: the open player's height follows.
        this.redraw();
        this.tick();
    }

    private updateViews(): void {
        const snapshot = this.media.snapshot;
        const accent = this.shownPalette?.accent ?? '#ffffff';
        this.collapsed.update(snapshot, accent);
        this.peek.update(snapshot, accent);
        this.expanded.update(snapshot);
        this.setActive();
    }

    /** A new song while the notch is closed on the music widens it with the title for a moment. */
    private peekOnNewTrack(snapshot: MediaSnapshot): void {
        const track = { key: trackKey(snapshot), title: snapshot.title, playing: snapshot.playbackStatus === 'Playing' };
        const state = { enabled: this.settings.behavior.trackPeek, drawn: this.drawn, fullscreen: this.inFullscreen };
        if (shouldPeek(this.peekTrack, track, state)) {
            window.clearTimeout(this.peekTimer);
            this.peekTimer = window.setTimeout(() => {
                this.peekTimer = 0;
                this.redraw();
            }, PEEK_MS);
        }
        this.peekTrack = track;
    }

    private onMode(): void {
        if (this.machine.mode === 'expanded') {
            // Opened, the player shows the song: no peek after it closes again.
            window.clearTimeout(this.peekTimer);
            this.peekTimer = 0;
            // Home's weather is new, unless the core's reading is fresh.
            this.weather.refresh();
        } else {
            // Closing goes back to the first page.
            this.homeOpen = false;
            this.page = null;
        }
        this.redraw();
        if (this.keyboard && !this.machine.held) {
            this.keyboard = false;
            (document.activeElement as HTMLElement | null)?.blur();
            this.host.releaseKeyboard?.();
        }
    }

    /** Opens a tile's page over home, or goes back to home. */
    private setPage(page: PageName | null): void {
        if (this.page === page) return;
        this.page = page;
        // Back from a page lands on home, also over a player.
        if (page) this.homeOpen = true;
        for (const [name, element] of Object.entries(this.subPages)) element.hidden = name !== page;
        this.redraw();
    }

    private setHomeOpen(open: boolean): void {
        if (this.homeOpen === open) return;
        this.homeOpen = open;
        this.redraw();
    }

    /** Whether times show on a 24-hour clock: Nokta's `clock_format`, or Windows' region. */
    private use24h(): boolean {
        return uses24h(this.settings.behavior.clockFormat, this.host.systemUses24h() ? '24h' : '12h');
    }

    private tickClock(now: Date): void {
        this.idle.update(now, this.use24h(), this.settings.behavior.showClock);
        this.home.update(now);
    }

    private lyricsAvailable(): boolean {
        const { status, lines } = this.lyrics;
        return status === 'synced' && lines.length > 0 && this.settings.behavior.showLyrics;
    }

    private sizeFor(drawn: Drawn): [number, number] {
        const appearance = this.settings.appearance;
        return viewSize(drawn, {
            appearance,
            notificationButtons: false,
            panelHeight: panelHeight(appearance.height, this.homeRows),
            pageHeight: subPageHeight(TimerPage.HEIGHT),
            expandedExtra: this.lyricsAvailable() ? LYRIC_ROW_EXTRA : 0,
        });
    }

    /** Draws the view for the notch's state; `jump` skips the animation. */
    private redraw(jump = false): void {
        const previous = this.drawn;
        this.drawn = drawnView({
            dropping: false,
            osd: this.osdTimer.active,
            notification: null,
            mode: this.machine.mode,
            peek: this.peekTimer !== 0,
            page: this.page !== null,
            homeOpen: this.homeOpen,
            player: this.media.snapshot.available,
            tour: false,
        });
        // The open player may show the blurred cover.
        if (previous !== this.drawn) this.applyPalette();
        // The glow goes with the alert.
        if (!showsAlert(this.drawn)) {
            this.notch.stopMotion();
            this.notch.setGlow(null);
        }
        for (const [drawn, element] of Object.entries(this.views)) {
            element.classList.toggle('nokta-shown', drawn === this.drawn);
        }
        this.showPrivacyDots();
        this.applyProgress();
        const [width, height] = this.sizeFor(this.drawn);
        if (jump) this.notch.jumpTo(width, height);
        else this.notch.resizeTo(width, height, resizeKind(previous, this.drawn));
        this.setActive();
        if (this.drawn === 'expanded' && previous !== 'expanded') {
            this.media.refreshPosition();
            this.tick();
        }
        this.updateTicker();
        this.updateHomeTicker();
        // The focus follows to the new view.
        this.focusView();
    }

    /** Only the view on screen runs its equalizer. */
    private setActive(): void {
        this.collapsed.setActive(this.drawn === 'collapsed');
        this.peek.setActive(this.drawn === 'peek');
        this.expanded.setActive(this.drawn === 'expanded');
    }

    /** The open player ticks while the music plays. */
    private updateTicker(): void {
        const run = this.drawn === 'expanded' && this.media.snapshot.playbackStatus === 'Playing';
        if (run && !this.ticker) this.ticker = window.setInterval(() => this.tick(), TICK_MS);
        else if (!run && this.ticker) {
            window.clearInterval(this.ticker);
            this.ticker = 0;
        }
    }

    /** Moves the progress and the lyric to where the track is now. */
    private tick(): void {
        if (this.drawn !== 'expanded') return;
        const snapshot = this.media.snapshot;
        const position = this.media.positionNow();
        this.expanded.progress.update(position, snapshot.lengthUs, snapshot.canSeek);
        const { lines, status } = this.lyrics;
        const text = visibleLyric(status, lines, this.settings.behavior.showLyrics, position);
        this.expanded.lyric.show(
            text === null
                ? null
                : {
                      text,
                      next: nextLyric(lines, position),
                      romanized: this.settings.lyrics.romanize ? romanize(text) : null,
                      ...lineProgress(lines, position, snapshot.rate),
                      playing: snapshot.playbackStatus === 'Playing',
                  },
        );
    }

    private report(hit: Box): void {
        this.hit = hit;
        this.host.setHit(this.notch.element.style.visibility === 'hidden' ? NO_HIT : hit);
    }
}
