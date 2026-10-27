import type Gio from 'gi://Gio';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import type { Restore } from '../../shared/topbar.js';

/** One osdWindowManager.show() call. */
export interface OsdRequest {
    /** -1 when the request names no monitor. */
    monitorIndex: number;
    icon: Gio.Icon | null;
    label: string | null | undefined;
    level: number | null | undefined;
    maxLevel: number | null | undefined;
}

export interface OsdHandlers {
    /** Returns null when the notch drew it, else the monitor for GNOME's own popup. */
    show(request: OsdRequest): number | null;
    hideAll(): void;
}

type ShowFn = (
    monitorIndex: number,
    icon: Gio.Icon | null,
    label?: string | null,
    level?: number | null,
    maxLevel?: number | null,
) => void;

/** The parts of ui/osdWindow.js OsdWindowManager used here (GNOME Shell 46). */
interface OsdWindowManager {
    show: ShowFn;
    hideAll: () => void;
}

/**
 * Sets `name` on the object itself, shadowing the class method. The undo
 * only removes Nokta's function: if something replaced it since, it is left
 * alone.
 */
function replaceMethod<K extends keyof OsdWindowManager>(
    target: OsdWindowManager,
    name: K,
    replacement: OsdWindowManager[K],
): Restore {
    const hadOwn = Object.hasOwn(target, name);
    const original = target[name];
    target[name] = replacement;
    return () => {
        if (target[name] !== replacement) {
            console.warn(`Nokta: osdWindowManager.${name} was replaced by someone else, leaving it alone`);
        } else if (hadOwn) {
            target[name] = original;
        } else {
            delete target[name];
        }
    };
}

/** Sends GNOME's OSD requests to `handlers` until the returned function runs. */
export function takeOverOsd(handlers: OsdHandlers): Restore {
    const manager = Main.osdWindowManager as OsdWindowManager;
    const originalShow = manager.show;
    const originalHideAll = manager.hideAll;
    const restoreShow = replaceMethod(manager, 'show', (monitorIndex, icon, label, level, maxLevel) => {
        const gnomeMonitor = handlers.show({ monitorIndex, icon, label, level, maxLevel });
        if (gnomeMonitor !== null) originalShow.call(manager, gnomeMonitor, icon, label, level, maxLevel);
    });
    const restoreHideAll = replaceMethod(manager, 'hideAll', () => {
        originalHideAll.call(manager);
        handlers.hideAll();
    });
    return () => {
        restoreShow();
        restoreHideAll();
    };
}
