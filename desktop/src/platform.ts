import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

import type { Box } from './notch/notch.js';

/** The app's event for the pointer crossing the notch (desktop/src-tauri/src/win/pointer.rs). */
const POINTER_EVENT = 'nokta://pointer';

/** Whether the page runs in the Windows app, not in a plain browser (the mock). */
export function inTauri(): boolean {
    return '__TAURI_INTERNALS__' in window;
}

/**
 * Tells the app which part of the window takes clicks; a click anywhere
 * else goes to the window under the notch.
 */
export async function setHitRegion(rect: Box): Promise<void> {
    if (inTauri()) await invoke('set_hit_region', { rect });
}

/**
 * Calls `cb` when the pointer comes over the notch or leaves it. In the app
 * the window follows the pointer, as the page gets no events while clicks
 * pass through; in a browser the page's own moves are tested against `hit`.
 */
export function onPointer(cb: (inside: boolean) => void, hit: () => Box | null): void {
    if (inTauri()) {
        void listen<boolean>(POINTER_EVENT, ({ payload }) => cb(payload));
        return;
    }
    let inside = false;
    const test = (x: number, y: number) => {
        const box = hit();
        const now = !!box && x >= box.x && y >= box.y && x < box.x + box.width && y < box.y + box.height;
        if (now !== inside) cb((inside = now));
    };
    document.addEventListener('pointermove', (e) => test(e.clientX, e.clientY));
    document.addEventListener('pointerleave', () => test(-1, -1));
}

/** A file as the page can load it: through the app's asset protocol, or as is in a browser. */
export function fileUrl(path: string): string {
    return inTauri() ? convertFileSrc(path) : path;
}

/** Whether Windows' region shows a 24-hour clock. */
export function systemUses24h(): boolean {
    const cycle = new Intl.DateTimeFormat(undefined, { hour: 'numeric' }).resolvedOptions().hourCycle;
    return cycle === 'h23' || cycle === 'h24';
}
