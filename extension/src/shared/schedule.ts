import GLib from 'gi://GLib';

import type { Scheduler } from './logic/machine.js';

/** A Scheduler on the GLib main loop. */
export const glibSchedule: Scheduler = (ms, fn) => {
    let id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
        id = 0;
        fn();
        return GLib.SOURCE_REMOVE;
    });
    return () => {
        if (id) GLib.source_remove(id);
        id = 0;
    };
};
