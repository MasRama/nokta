import type { HomeLayout, HomeTile, QuickToggle, QuickToggles } from '@ext/features/panel/logic/layout.js';

import type { Bridge } from './bridge/bridge.js';
import { Follower } from './follower.js';

/** The toggles Windows has: it has no public Do Not Disturb or Night Light. */
const WINDOWS_TOGGLES: readonly QuickToggle[] = ['caffeine', 'dark_style'];

/** The tiles whose page, panel or window the Windows app has. */
const WINDOWS_TILES: readonly HomeTile[] = ['notifications', 'focus', 'timer', 'clipboard', 'settings', 'screenshot', 'system'];

/** The layout's toggles and tiles the Windows app can offer, in its order; no clipboard tile while its history is off. */
export function windowsControls(layout: HomeLayout, clipboard: boolean): HomeLayout {
    return {
        toggles: layout.toggles.filter((name) => WINDOWS_TOGGLES.includes(name)),
        tiles: layout.tiles.filter((name) => WINDOWS_TILES.includes(name) && (name !== 'clipboard' || clipboard)),
    };
}

/**
 * Toggles1: home's quick toggles, Windows' dark style and Caffeine, as the
 * extension reads them from GNOME's settings.
 */
export class Toggles extends Follower {
    state: QuickToggles = { do_not_disturb: false, caffeine: false, dark_style: true, night_light: null };

    constructor(bridge: Bridge, onChanged: () => void) {
        super(bridge, 'Toggles1', onChanged);
    }

    /** Turns `which` the other way; the new state comes back as a change. */
    toggle(which: QuickToggle): void {
        this.call('Set', which, !this.state[which]);
    }

    protected override read(): void {
        const { DarkStyle, Caffeine } = this.props;
        // Until the app says, the notch keeps its own dark default.
        this.state = { ...this.state, dark_style: DarkStyle !== false, caffeine: Caffeine === true };
    }
}
