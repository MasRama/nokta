import { _, format } from '../../../shared/logic/i18n.js';

/** Home's row about an update. */
export interface UpdateRow {
    text: string;
    /** It has an Update button, and its text opens the release's page. */
    canInstall: boolean;
}

/** `0.12.0` as numbers; null for anything else. */
function parts(version: string): number[] | null {
    const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
    return match ? match.slice(1).map(Number) : null;
}

/** Whether version `a` is newer than `b`; an unknown one never is. */
export function isNewer(a: string, b: string): boolean {
    const [x, y] = [parts(a), parts(b)];
    if (!x || !y) return false;
    const i = x.findIndex((n, k) => n !== y[k]);
    return i >= 0 && x[i] > y[i];
}

/**
 * The row for `latest`, the newer release the daemon found (empty for
 * none), given the running daemon's version and this extension's. A daemon
 * newer than the extension was just updated: GNOME loads the new extension
 * only at the next login. Null hides the row.
 */
export function updateRow(
    latest: string,
    daemonVersion: string,
    extensionVersion: string,
    installing: boolean,
): UpdateRow | null {
    if (isNewer(daemonVersion, extensionVersion))
        return { text: _('Log out and back in to finish updating Nokta'), canInstall: false };
    if (latest === '') return null;
    return { text: format(_('Nokta %s is available'), latest), canInstall: !installing };
}
