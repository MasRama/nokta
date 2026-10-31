import type { PanelRow } from '@ext/features/panel/logic/height.js';
import type { HomeLayout, HomeTile, QuickToggle, QuickToggles } from '@ext/features/panel/logic/layout.js';
import type { WeatherLine } from '@ext/features/weather/logic/weather.js';
import { TONES } from '@ext/shared/logic/tones.js';

import { icon, setIcon } from '../icons.js';
import { Tile, TogglePill, type ControlColors } from './controls.js';
import { CallRow, type CallHandlers, type HomeCall } from './privacy.js';
import { ClockRow, type ClockHandlers, type HomeClock } from './timer.js';

/** Home shows the newest clocks, at most this many, as the extension's. */
export const MAX_HOME_CLOCKS = 3;

/** Each toggle's icon, name and tone, as the extension's panel/view.ts. */
const TOGGLES: Array<[QuickToggle, string, string, string]> = [
    ['do_not_disturb', 'bell-off', 'Do Not Disturb', TONES.do_not_disturb],
    ['caffeine', 'caffeine', 'Caffeine', TONES.caffeine],
    ['dark_style', 'dark-style', 'Dark Style', TONES.dark_style],
    ['night_light', 'night-light', 'Night Light', TONES.night_light],
];

/** Each tile's icon, name and tone. */
const TILES: Array<[HomeTile, string, string, string]> = [
    ['notifications', 'bell', 'Notifications', TONES.notifications],
    ['focus', 'focus', 'Focus', TONES.focus],
    ['timer', 'timer', 'Timer', TONES.countdown],
    ['clipboard', 'clipboard', 'Clipboard', TONES.clipboard],
    ['settings', 'settings', 'Settings', TONES.settings],
    ['screenshot', 'screenshot', 'Screenshot', TONES.screenshot],
    ['system', 'system', 'System', TONES.system],
];

export interface HomeHandlers extends ClockHandlers, CallHandlers {
    openPlayer(): void;
    toggle(which: QuickToggle): void;
    openTile(which: HomeTile): void;
}

/** What home lists above its controls. */
export interface HomeContent {
    call?: boolean;
    clocks?: number;
}

/** Home's rows for its content and `layout`'s controls, top to bottom, as panel/logic/height.ts counts them. */
export function homeRows(layout: HomeLayout, { call = false, clocks = 0 }: HomeContent = {}): PanelRow[] {
    return [
        'date',
        ...(call ? (['call'] as const) : []),
        ...Array<PanelRow>(Math.min(clocks, MAX_HOME_CLOCKS)).fill('clock'),
        ...(layout.toggles.length > 0 ? (['toggles'] as const) : []),
        ...(layout.tiles.length > 0 ? (['tiles'] as const) : []),
    ];
}

/** Today's weather at the right of the heading: icon and temperature, the place and range dimmed under them. */
class WeatherBox {
    readonly element: HTMLDivElement;
    private readonly glyph: HTMLSpanElement;
    private readonly temperature: HTMLSpanElement;
    private readonly detail: HTMLSpanElement;

    constructor() {
        this.element = document.createElement('div');
        this.element.className = 'nokta-panel-weather';
        this.element.hidden = true;
        const now = document.createElement('div');
        now.className = 'nokta-panel-weather-now';
        this.glyph = icon('', 20);
        this.temperature = document.createElement('span');
        this.temperature.className = 'nokta-panel-weather-temperature';
        now.append(this.glyph, this.temperature);
        this.detail = document.createElement('span');
        this.detail.className = 'nokta-panel-weather-detail';
        this.element.append(now, this.detail);
    }

    show(weather: WeatherLine | null): void {
        this.element.hidden = weather === null;
        if (!weather) return;
        setIcon(this.glyph, weather.icon, 20);
        this.temperature.textContent = weather.temperature;
        this.detail.textContent = weather.detail;
    }
}

/** Which tiles show their feature on: a focus session, and clocks for the timer. */
export type TileStates = Partial<Record<HomeTile, boolean>>;

/**
 * Home, the open notch's other page: the weekday over the date with the
 * weather beside them, the way back to a player, the call, the clocks, then the
 * quick toggles and a row of tiles. The Windows twin of the extension's HomePanel, which
 * it grows into part by part.
 */
export class HomeView {
    readonly element: HTMLDivElement;
    private readonly weekday: HTMLSpanElement;
    private readonly date: HTMLSpanElement;
    private readonly weather = new WeatherBox();
    private readonly music: HTMLButtonElement;
    private readonly call: CallRow;
    private readonly clocks: ClockRow[] = [];
    private readonly toggles = new Map<QuickToggle, TogglePill>();
    private readonly tiles = new Map<HomeTile, Tile>();
    private readonly pills: HTMLDivElement;
    private readonly tileRow: HTMLDivElement;
    private readonly controls: HTMLDivElement;

    constructor(handlers: HomeHandlers) {
        this.element = document.createElement('div');
        this.element.className = 'nokta-view nokta-panel';
        const today = document.createElement('div');
        today.className = 'nokta-panel-today';
        this.weekday = document.createElement('span');
        this.weekday.className = 'nokta-panel-weekday';
        this.date = document.createElement('span');
        this.date.className = 'nokta-panel-date';
        today.append(this.weekday, this.date);
        this.music = document.createElement('button');
        this.music.className = 'nokta-button nokta-panel-music';
        this.music.append(icon('audio-x-generic', 16));
        this.music.hidden = true;
        this.music.addEventListener('click', () => handlers.openPlayer());
        const heading = document.createElement('div');
        heading.className = 'nokta-panel-heading';
        heading.append(today, this.weather.element, this.music);

        this.pills = document.createElement('div');
        this.pills.className = 'nokta-panel-toggles';
        for (const [which, name, label, tone] of TOGGLES) {
            const pill = new TogglePill(name, label, tone, () => handlers.toggle(which));
            this.toggles.set(which, pill);
        }
        this.tileRow = document.createElement('div');
        this.tileRow.className = 'nokta-panel-tiles';
        for (const [which, name, label, tone] of TILES) {
            const tile = new Tile(name, label, tone, () => handlers.openTile(which));
            tile.element.dataset.tile = which;
            this.tiles.set(which, tile);
        }
        this.controls = document.createElement('div');
        this.controls.className = 'nokta-panel-controls';
        this.controls.append(this.pills, this.tileRow);
        this.call = new CallRow(handlers);
        this.element.append(heading, this.call.element);
        for (let i = 0; i < MAX_HOME_CLOCKS; i++) {
            const row = new ClockRow(handlers);
            this.clocks.push(row);
            this.element.append(row.element);
        }
        this.element.append(this.controls);
    }

    /** The music button shows while a player is there. */
    setPlayer(available: boolean): void {
        this.music.hidden = !available;
    }

    update(now: Date, locale?: string): void {
        this.weekday.textContent = now.toLocaleDateString(locale, { weekday: 'long' });
        // Day before month, as the extension's `%-d %B`.
        this.date.textContent = `${now.getDate()} ${now.toLocaleDateString(locale, { month: 'long' })}`;
    }

    /** Null hides the weather. */
    setWeather(weather: WeatherLine | null): void {
        this.weather.show(weather);
    }

    /** Null hides the call's row. */
    setCall(call: HomeCall | null): void {
        this.call.show(call);
    }

    /** The newest clocks, one row each. */
    setClocks(clocks: readonly HomeClock[]): void {
        this.clocks.forEach((row, i) => row.show(clocks[i]));
    }

    /** Shows `layout`'s toggles and tiles in its order, each in its state; a row with none goes away. */
    setControls(layout: HomeLayout, toggles: QuickToggles, tiles: TileStates = {}): void {
        for (const [which, pill] of this.toggles) pill.set(toggles[which] === true);
        // Windows does not say how many notifications wait.
        for (const [which, tile] of this.tiles) tile.set(tiles[which] === true, null);
        const place = <T extends string>(row: HTMLElement, controls: Map<T, { element: HTMLElement }>, shown: readonly T[]) => {
            const wanted = shown.flatMap((name) => controls.get(name)?.element ?? []);
            // Put back only on a new order, so a focused control keeps the focus.
            if (wanted.some((element, i) => row.children[i] !== element) || row.children.length !== wanted.length) {
                row.replaceChildren(...wanted);
            }
            row.hidden = shown.length === 0;
        };
        place(this.pills, this.toggles, layout.toggles);
        place(this.tileRow, this.tiles, layout.tiles);
        this.controls.hidden = this.pills.hidden && this.tileRow.hidden;
    }

    setColors(colors: ControlColors): void {
        for (const pill of this.toggles.values()) pill.setColors(colors);
        for (const tile of this.tiles.values()) tile.setColors(colors);
        for (const row of [...this.clocks, this.call]) row.chip.setLight(colors.light);
    }
}
