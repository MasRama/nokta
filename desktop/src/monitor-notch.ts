import { uses24h } from '@ext/shared/logic/format.js';
import { NotchMachine, type NotchMode } from '@ext/shared/logic/machine.js';
import { depthFor, paletteFor, themeFor } from '@ext/shared/logic/theme.js';
import { panelHeight } from '@ext/features/panel/logic/height.js';
import { drawnView, resizeKind, viewSize, type Drawn } from '@ext/logic/views.js';

import type { Bridge } from './bridge/bridge.js';
import { Notch, type Box, type Frames, type NotchStyle } from './notch/notch.js';
import { Settings } from './settings.js';
import { everyMinute } from './views/clock.js';
import { HomeView } from './views/home.js';
import { IdleView } from './views/idle.js';

/** What the page needs from where it runs: the app or the browser mock. */
export interface Host {
    /** Whether Windows' region shows a 24-hour clock. */
    systemUses24h(): boolean;
    /** Tells the window which part takes clicks. */
    setHit(hit: Box): void;
    /** Calls back when the pointer comes over the notch or leaves it. */
    onPointer(cb: (inside: boolean) => void, hit: () => Box | null): void;
}

/**
 * The notch of one window, on one monitor: the settings from the core, the
 * state machine the pointer drives, and the view for each state. The
 * Windows twin of the extension's monitor-notch.ts, which it grows into
 * part by part.
 */
export class MonitorNotch {
    readonly notch: Notch;
    readonly settings: Settings;
    private readonly machine: NotchMachine;
    private readonly idle = new IdleView();
    private readonly home = new HomeView();
    private drawn: Drawn = 'idle';
    private hit: Box | null = null;
    private stopClock: (() => void) | null = null;

    constructor(
        bridge: Bridge,
        private readonly host: Host,
        root: HTMLElement,
        frames?: Frames,
    ) {
        this.settings = new Settings(bridge, () => this.restyle());
        this.notch = new Notch(this.style(), this.palette(), (hit) => this.report(hit), frames);
        this.notch.body.append(this.idle.element, this.home.element);
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
            (mode) => this.redraw(mode),
        );
        this.notch.body.addEventListener('click', () => this.machine.click());
        host.onPointer((inside) => this.machine.pointer(inside), () => this.hit);
    }

    /** Lays out in a window `width` CSS px wide and follows the settings. */
    async start(width: number): Promise<void> {
        this.notch.setArea(width);
        this.restyle();
        this.stopClock = everyMinute((now) => this.tick(now));
        await this.settings.attach();
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
        this.stopClock?.();
        this.settings.detach();
        this.machine.destroy();
        this.notch.destroy();
    }

    private style(): NotchStyle {
        return { ...this.settings.appearance };
    }

    private palette() {
        const a = this.settings.appearance;
        const { path, color, tone } = this.settings.picture;
        // The system's light style follows in a later part; Windows' default is dark.
        return paletteFor(themeFor(a, true), a, null, { path, color, tone, darken: a.pictureDarken });
    }

    private restyle(): void {
        this.notch.setAppearance(this.style());
        const palette = this.palette();
        this.notch.setPalette(palette);
        this.notch.setDepth(depthFor(palette.light, this.settings.appearance.depth));
        this.tick(new Date());
        this.redraw(this.machine.mode, true);
    }

    private tick(now: Date): void {
        const b = this.settings.behavior;
        this.idle.update(now, uses24h(b.clockFormat, this.host.systemUses24h() ? '24h' : '12h'), b.showClock);
        this.home.update(now);
    }

    private redraw(mode: NotchMode, jump = false): void {
        const previous = this.drawn;
        this.drawn = drawnView({
            dropping: false,
            osd: false,
            notification: null,
            mode,
            peek: false,
            page: false,
            homeOpen: false,
            player: false,
            tour: false,
        });
        const [width, height] = viewSize(this.drawn, {
            appearance: this.settings.appearance,
            notificationButtons: false,
            panelHeight: panelHeight(this.settings.appearance.height, ['date']),
            pageHeight: 0,
            expandedExtra: 0,
        });
        this.idle.element.classList.toggle('nokta-shown', this.drawn === 'idle');
        this.home.element.classList.toggle('nokta-shown', this.drawn === 'panel');
        if (jump) this.notch.jumpTo(width, height);
        else this.notch.resizeTo(width, height, resizeKind(previous, this.drawn));
    }

    private report(hit: Box): void {
        this.hit = hit;
        this.host.setHit(hit);
    }
}
