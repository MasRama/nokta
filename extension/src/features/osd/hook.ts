import type Gio from 'gi://Gio';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import { replaceMethod as replace } from '../../shared/patch.js';
import type { Restore } from '../../shared/topbar.js';
import { fromLevels, type LevelRequest, type OsdLevel } from './logic/levels.js';

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
    /** The monitor whose level wins when GNOME names several (GNOME 49 and later). */
    focusedMonitor(): number;
}

/** GNOME 46 to 48: `show(monitorIndex, icon, label, level, maxLevel)`, -1 for all monitors. */
type MonitorShow = (
    monitorIndex: number,
    icon: Gio.Icon | null,
    label?: string | null,
    level?: number | null,
    maxLevel?: number | null,
) => void;

/** GNOME 49 and later: `show(icon, label, levels)`; `showOne` calls it, `showAll` does not. */
type LevelsShow = (icon: Gio.Icon | null, label: string | null | undefined, levels: Record<number, OsdLevel>) => void;
type ShowAll = (icon: Gio.Icon | null, label?: string | null, level?: number | null, maxLevel?: number | null) => void;

/** The parts of ui/osdWindow.js OsdWindowManager used here. */
interface OsdWindowManager {
    show: MonitorShow | LevelsShow;
    showAll?: ShowAll;
    hideAll: () => void;
}

const replaceMethod = (target: object, name: string, replacement: unknown): Restore =>
    replace(target, 'osdWindowManager', name, replacement);

/** Sends GNOME's OSD requests to `handlers` until the returned function runs. */
export function takeOverOsd(handlers: OsdHandlers): Restore {
    const manager = Main.osdWindowManager as unknown as OsdWindowManager;
    const restores = manager.showAll ? hookLevels(manager, handlers) : hookMonitor(manager, handlers);
    const originalHideAll = manager.hideAll;
    restores.push(
        replaceMethod(manager, 'hideAll', () => {
            originalHideAll.call(manager);
            handlers.hideAll();
        }),
    );
    return () => restores.forEach((restore) => restore());
}

function hookMonitor(manager: OsdWindowManager, handlers: OsdHandlers): Restore[] {
    const originalShow = manager.show as MonitorShow;
    const show: MonitorShow = (monitorIndex, icon, label, level, maxLevel) => {
        const gnomeMonitor = handlers.show({ monitorIndex, icon, label, level, maxLevel });
        if (gnomeMonitor !== null) originalShow.call(manager, gnomeMonitor, icon, label, level, maxLevel);
    };
    return [replaceMethod(manager, 'show', show)];
}

function hookLevels(manager: OsdWindowManager, handlers: OsdHandlers): Restore[] {
    const originalShow = manager.show as LevelsShow;
    const request = (icon: Gio.Icon | null, label: string | null | undefined, wanted: LevelRequest) => {
        const gnomeMonitor = handlers.show({ icon, label, ...wanted });
        if (gnomeMonitor !== null) {
            const { level, maxLevel } = wanted;
            originalShow.call(manager, icon, label, { [gnomeMonitor]: { level, maxLevel } });
        }
    };
    const show: LevelsShow = (icon, label, levels) => {
        const wanted = fromLevels(levels, handlers.focusedMonitor());
        if (wanted) {
            request(icon, label, wanted);
        } else {
            // No monitor named: GNOME cancels its popups, the notch hides its OSD.
            originalShow.call(manager, icon, label, {});
            handlers.hideAll();
        }
    };
    const showAll: ShowAll = (icon, label, level, maxLevel) => request(icon, label, { monitorIndex: -1, level, maxLevel });
    return [replaceMethod(manager, 'show', show), replaceMethod(manager, 'showAll', showAll)];
}
