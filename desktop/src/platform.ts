import { invoke } from '@tauri-apps/api/core';

/** A rectangle in the page's CSS px. */
export interface HitRect {
    x: number;
    y: number;
    width: number;
    height: number;
}

/** Whether the page runs in the Windows app, not in a plain browser (the mock). */
export function inTauri(): boolean {
    return '__TAURI_INTERNALS__' in window;
}

/**
 * Tells the app which part of the window takes the pointer; a click
 * anywhere else goes to the window under the notch.
 */
export async function setHitRegion(rect: HitRect): Promise<void> {
    if (inTauri()) await invoke('set_hit_region', { rect });
}

/** Whether Windows' region shows a 24-hour clock. */
export function systemUses24h(): boolean {
    const cycle = new Intl.DateTimeFormat(undefined, { hour: 'numeric' }).resolvedOptions().hourCycle;
    return cycle === 'h23' || cycle === 'h24';
}
