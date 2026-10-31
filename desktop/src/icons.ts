import { noktaIconName, type NoktaIcon } from '@ext/shared/logic/icon-names.js';

// The extension's own icons, so both draw the same ones.
const FILES = import.meta.glob<string>('../../extension/icons/nokta-*-symbolic.svg', {
    query: '?raw',
    import: 'default',
    eager: true,
});

/** The extension draws its icons in GNOME's symbolic grey; here they take the text colour. */
const SYMBOLIC = /fill="#2e3436"/g;

const SOURCES = new Map<string, string>(
    Object.entries(FILES).map(([path, svg]) => {
        const name = /nokta-(.+)-symbolic\.svg$/.exec(path)?.[1] ?? '';
        return [name, svg.replace(SYMBOLIC, 'fill="currentColor"')];
    }),
);

/** A battery 16 px wide, its outline and nub, around `inside`. */
const battery = (inside: string): string =>
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor">' +
    '<path fill-rule="evenodd" d="M3 4h8a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zm0 1.5a.5.5 0 0 0-.5.5v4a.5.5 0 0 0 .5.5h8a.5.5 0 0 0 .5-.5V6a.5.5 0 0 0-.5-.5z"/>' +
    '<rect x="13.75" y="6.5" width="1.5" height="3" rx=".5"/>' +
    inside +
    '</svg>';
const level = (width: number): string => `<rect x="3.5" y="6.5" width="${width}" height="3" rx=".5"/>`;

/**
 * The battery icons the device alerts name. GNOME draws them on Linux;
 * Windows has no icon theme, so the app draws its own.
 */
const BATTERIES = new Map<string, string>([
    ['battery-good', battery(level(5))],
    ['battery-low', battery(level(2))],
    ['battery-caution', battery('<rect x="6.25" y="6" width="1.5" height="2.5" rx=".5"/><circle cx="7" cy="9.75" r=".75"/>')],
    ['battery-full-charged', battery(level(7))],
    ['battery-good-charging', battery('<path d="M7.75 5.5 4.75 8.5h2.5l-1 2.5 3-3h-2.5z"/>')],
]);

/** A weather icon 16 px wide, drawn in lines. */
const lines = (inside: string): string =>
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke="currentColor" ' +
    'stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' +
    inside +
    '</svg>';
/** A cloud across the middle, moved by `transform`. */
const cloud = (transform = ''): string =>
    `<path ${transform ? `transform="${transform}" vector-effect="non-scaling-stroke" ` : ''}` +
    'd="M4.5 12h7a2.5 2.5 0 0 0 0-5 3.4 3.4 0 0 0-6.7.5A2.25 2.25 0 0 0 4.5 12z"/>';
/** The cloud raised for rain, snow or a storm under it. */
const HIGH = 'translate(0 -2)';
/** A small cloud at the bottom right, beside a sun or a moon. */
const LOW = 'translate(3 3) scale(.8)';
const sun = '<circle cx="8" cy="8" r="3"/><path d="M8 1.5V3M8 13v1.5M1.5 8H3M13 8h1.5M3.4 3.4l1 1M11.6 11.6l1 1M3.4 12.6l1-1M11.6 4.4l1-1"/>';
const smallSun = '<circle cx="5" cy="5" r="2"/><path d="M5 1v.6M1 5h.6M2.2 2.2l.4.4M7.8 2.2l-.4.4M2.2 7.8l.4-.4"/>';
const moon = '<path d="M12.5 10.2A5 5 0 0 1 5.8 3.5a5 5 0 1 0 6.7 6.7z"/>';
const smallMoon = '<path d="M7.6 6.2A3.2 3.2 0 0 1 3.4 2a3.2 3.2 0 1 0 4.2 4.2z"/>';

/**
 * The weather icons home names (weather/logic/weather.ts): GNOME's icon
 * theme draws them on Linux, so here the app draws its own.
 */
const WEATHER = new Map<string, string>([
    ['weather-clear', lines(sun)],
    ['weather-clear-night', lines(moon)],
    ['weather-few-clouds', lines(smallSun + cloud(LOW))],
    ['weather-few-clouds-night', lines(smallMoon + cloud(LOW))],
    ['weather-overcast', lines(cloud())],
    ['weather-fog', lines('<path d="M3 5h10M2 8h12M3 11h10"/>')],
    ['weather-showers-scattered', lines(cloud(HIGH) + '<path d="M6.5 12.5 6 14.5M10.5 12.5 10 14.5"/>')],
    ['weather-showers', lines(cloud(HIGH) + '<path d="M5.5 12.5 5 14.5M8.5 12.5 8 14.5M11.5 12.5 11 14.5"/>')],
    [
        'weather-snow',
        lines(
            cloud(HIGH) +
                '<g fill="currentColor" stroke="none"><circle cx="5.5" cy="13.5" r=".9"/>' +
                '<circle cx="8.5" cy="14.5" r=".9"/><circle cx="11.5" cy="13.5" r=".9"/></g>',
        ),
    ],
    ['weather-storm', lines(cloud(HIGH) + '<path d="M8.75 10.5 7 13h2.25L7.75 15.5"/>')],
]);

/** The icons the app draws itself, beside Nokta's own. */
const DRAWN = new Map<string, string>([...BATTERIES, ...WEATHER]);

/**
 * Nokta's icon for `name` (its own, or the GNOME name the extension uses,
 * like `media-playback-start-symbolic`) as an element `size` px square in
 * the text colour; empty for one Nokta does not draw.
 */
export function icon(name: NoktaIcon | string, size: number): HTMLSpanElement {
    const span = document.createElement('span');
    span.className = 'nokta-icon';
    setIcon(span, name, size);
    return span;
}

/** Draws `name` in an element made by `icon`. */
export function setIcon(span: HTMLElement, name: NoktaIcon | string, size: number): void {
    const own = noktaIconName(name) ?? noktaIconName(`nokta-${name}`);
    const bare = name.replace(/-symbolic$/, '');
    const key = own ?? (DRAWN.has(bare) ? bare : null);
    if (span.dataset.icon === (key ?? '')) return;
    span.dataset.icon = key ?? '';
    span.innerHTML = (own ? SOURCES.get(own) : key && DRAWN.get(key)) ?? '';
    span.style.width = span.style.height = `${size}px`;
    const svg = span.querySelector('svg');
    if (svg) {
        svg.setAttribute('width', String(size));
        svg.setAttribute('height', String(size));
    }
}
