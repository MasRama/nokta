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
    if (span.dataset.icon === own) return;
    span.dataset.icon = own ?? '';
    span.innerHTML = (own && SOURCES.get(own)) ?? '';
    span.style.width = span.style.height = `${size}px`;
    const svg = span.querySelector('svg');
    if (svg) {
        svg.setAttribute('width', String(size));
        svg.setAttribute('height', String(size));
    }
}
