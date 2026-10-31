import { icon } from '../icons.js';

/**
 * Home, the open notch's other page: for now the weekday over the date,
 * and with a player the way back to it.
 */
export class HomeView {
    readonly element: HTMLDivElement;
    private readonly weekday: HTMLSpanElement;
    private readonly date: HTMLSpanElement;
    private readonly music: HTMLButtonElement;

    constructor(openPlayer: () => void) {
        this.element = document.createElement('div');
        this.element.className = 'nokta-view nokta-panel';
        const heading = document.createElement('div');
        heading.className = 'nokta-panel-heading';
        this.weekday = document.createElement('span');
        this.weekday.className = 'nokta-panel-weekday';
        this.date = document.createElement('span');
        this.date.className = 'nokta-panel-date';
        heading.append(this.weekday, this.date);
        this.music = document.createElement('button');
        this.music.className = 'nokta-button nokta-home-button nokta-panel-music';
        this.music.append(icon('audio-x-generic', 16));
        this.music.hidden = true;
        this.music.addEventListener('click', openPlayer);
        this.element.append(heading, this.music);
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
}
