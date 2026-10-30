import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import type { Inhibitor } from './logic/caffeine.js';
import { _ } from '../../shared/logic/i18n.js';

/** `GsmInhibitorFlag`: keep the session from going idle, so the screen stays on. */
const INHIBIT_IDLE = 8;

function callSessionManager(method: string, params: GLib.Variant): Promise<GLib.Variant> {
    return new Promise((resolve, reject) => {
        Gio.DBus.session.call(
            'org.gnome.SessionManager',
            '/org/gnome/SessionManager',
            'org.gnome.SessionManager',
            method,
            params,
            null,
            Gio.DBusCallFlags.NONE,
            -1,
            null,
            (connection, result) => {
                try {
                    resolve(connection!.call_finish(result));
                } catch (error) {
                    reject(error);
                }
            },
        );
    });
}

/** GNOME's session manager over D-Bus, without blocking the shell. */
export function sessionInhibitor(): Inhibitor {
    return {
        inhibit: async () => {
            const reply = await callSessionManager(
                'Inhibit',
                new GLib.Variant('(susu)', ['nokta', 0, _('Caffeine is on in Nokta'), INHIBIT_IDLE]),
            );
            const [cookie] = reply.deepUnpack() as [number];
            return cookie;
        },
        uninhibit: async (cookie) => {
            await callSessionManager('Uninhibit', new GLib.Variant('(u)', [cookie]));
        },
    };
}
