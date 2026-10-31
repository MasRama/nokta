/** Home, the open notch without a player: for now the weekday over the date, beside the camera. */
export class HomeView {
    readonly element: HTMLDivElement;
    private readonly weekday: HTMLSpanElement;
    private readonly date: HTMLSpanElement;

    constructor() {
        this.element = document.createElement('div');
        this.element.className = 'nokta-view nokta-panel';
        const heading = document.createElement('div');
        heading.className = 'nokta-panel-heading';
        this.weekday = document.createElement('span');
        this.weekday.className = 'nokta-panel-weekday';
        this.date = document.createElement('span');
        this.date.className = 'nokta-panel-date';
        heading.append(this.weekday, this.date);
        this.element.append(heading);
    }

    update(now: Date, locale?: string): void {
        this.weekday.textContent = now.toLocaleDateString(locale, { weekday: 'long' });
        // Day before month, as the extension's `%-d %B`.
        this.date.textContent = `${now.getDate()} ${now.toLocaleDateString(locale, { month: 'long' })}`;
    }
}
