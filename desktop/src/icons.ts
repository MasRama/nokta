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
    const key = own ?? (BATTERIES.has(bare) ? bare : null);
    if (span.dataset.icon === (key ?? '')) return;
    span.dataset.icon = key ?? '';
    span.innerHTML = (own ? SOURCES.get(own) : key && BATTERIES.get(key)) ?? '';
    span.style.width = span.style.height = `${size}px`;
    const svg = span.querySelector('svg');
    if (svg) {
        svg.setAttribute('width', String(size));
        svg.setAttribute('height', String(size));
    }
}
