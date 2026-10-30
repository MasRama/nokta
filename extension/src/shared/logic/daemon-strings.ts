import { N_ } from './i18n.js';

/**
 * Text noktad puts on screen in English: activity titles and details. They
 * are translated where they arrive (`activitiesFrom`); this list only lets
 * `scripts/i18n.mjs` find them. Keep it in step with
 * `core/src/features/activities/packagekit.rs` and `launcher.rs`.
 */
export const DAEMON_STRINGS: readonly string[] = [
    // PackageKit titles.
    N_('Installing software'),
    N_('Removing software'),
    N_('Installing updates'),
    N_('Upgrading the system'),
    // PackageKit details.
    N_('Downloading'),
    N_('Installing'),
    N_('Updating'),
    N_('Removing'),
    N_('Cleaning up'),
    N_('Resolving dependencies'),
    N_('Checking signatures'),
    N_('Testing changes'),
    N_('Applying changes'),
    N_('Cancelling'),
    N_('Waiting'),
    N_('Waiting for authorization'),
    N_('Preparing'),
    // Apps that report progress through the launcher API.
    N_('Working on files'),
    N_('In progress'),
];
