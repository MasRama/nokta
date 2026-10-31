import type { Props } from '../bridge/bridge.js';

/** A state of the browser mock: what the core says, and whether the notch opens. */
export interface Scene {
    props: Record<string, Props>;
    open?: boolean;
}

const appearance = (table: Props): Record<string, Props> => ({ Settings1: { Appearance: table } });

/** The scenes `?mock=<name>` shows, for the shots and for working on the page. */
export const SCENES: Record<string, Scene> = {
    idle: { props: {} },
    home: { props: {}, open: true },
    glass: { props: appearance({ theme: 'glass' }), open: true },
    paper: { props: appearance({ theme: 'paper' }), open: true },
    aurora: { props: appearance({ theme: 'aurora' }), open: true },
    custom: {
        props: appearance({ theme: 'custom', background: '#1d2b53', gradient: 'diagonal', background_end: '#7e2553' }),
        open: true,
    },
};

/** The scene for `search` (the page's query string); idle when none or unknown. */
export function sceneFor(search: string): Scene {
    const name = new URLSearchParams(search).get('mock') ?? 'idle';
    return SCENES[name] ?? SCENES.idle;
}
