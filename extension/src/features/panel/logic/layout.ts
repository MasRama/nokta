/** A quick toggle, by its name in home.toggles. */
export type QuickToggle = 'do_not_disturb' | 'caffeine' | 'dark_style' | 'night_light';

/** The quick toggles' states, read from GNOME's settings; Night Light is null where GNOME has none. */
export type QuickToggles = Record<Exclude<QuickToggle, 'night_light'>, boolean> & { night_light: boolean | null };

/** A tile, by its name in home.tiles. */
export type HomeTile = 'notifications' | 'focus' | 'timer' | 'clipboard' | 'settings' | 'screenshot' | 'system';

/** Which toggles and tiles home shows, in order. */
export interface HomeLayout {
    toggles: readonly QuickToggle[];
    tiles: readonly HomeTile[];
}

/** The layout's toggles and tiles that this session can offer: no Night Light without GNOME's, no clipboard without its history. */
export function shownControls(layout: HomeLayout, toggles: QuickToggles, clipboard: boolean): HomeLayout {
    return {
        toggles: layout.toggles.filter((name) => toggles[name] !== null),
        tiles: layout.tiles.filter((name) => name !== 'clipboard' || clipboard),
    };
}
