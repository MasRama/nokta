import type { OpenOn } from '../../../shared/logic/machine.js';
import { _, format } from '../../../shared/logic/i18n.js';
import { shortcutLabel } from '../../../shared/logic/shortcut.js';

/** How many steps the tour has. */
export const TOUR_STEPS = 4;

/** What a step says, and which buttons it has. */
export interface TourStep {
    title: string;
    body: string;
    /** It has an Open settings button. */
    settings: boolean;
    /** Next reads Done. */
    last: boolean;
}

/** How the notch opens, for the second step. */
export interface OpenHow {
    openOn: OpenOn;
    /** `[behavior] open_shortcut`, like `<Super><Alt>n`; empty for none. */
    shortcut: string;
    /** What the Super key is called where it runs: Windows calls it Win. */
    superName?: string;
}

/** Step `index` (0 to TOUR_STEPS - 1), in the user's language. */
export function tourStep(index: number, how: OpenHow): TourStep {
    const step = (title: string, body: string, settings = false): TourStep => ({
        title,
        body,
        settings,
        last: index === TOUR_STEPS - 1,
    });
    switch (index) {
        case 0:
            return step(
                _('This is Nokta'),
                _("The notch at the top of your screen shows what's happening now: your song, timers, downloads and alerts."),
            );
        case 1:
            return step(_('Open it'), openText(how));
        case 2:
            return step(_('Home'), _('With nothing playing it opens on home: your day, quick toggles and tiles.'));
        default:
            return step(_('Make it yours'), _('Right-click the notch, or use the Settings tile.'), true);
    }
}

function openText({ openOn, shortcut, superName }: OpenHow): string {
    const keys = shortcutLabel(shortcut, superName);
    if (openOn === 'click') return keys ? format(_('Click it or press %s.'), keys) : _('Click it.');
    return keys ? format(_('Rest the pointer on it or press %s.'), keys) : _('Rest the pointer on it.');
}

/** The step after `index` for a press of Next or Skip; null when the tour is done. */
export function tourAfter(index: number, press: 'next' | 'skip'): number | null {
    if (press === 'skip' || index + 1 >= TOUR_STEPS) return null;
    return index + 1;
}
