import Gio from 'gi://Gio';

import { PATHS } from '../../shared/contracts.js';
import { cached, makeProxy } from '../../shared/dbus.js';
import { SETTINGS1_XML } from '../../generated/contracts.js';
import {
    appearanceFrom,
    behaviorFrom,
    DEFAULT_APPEARANCE,
    DEFAULT_BEHAVIOR,
    DEFAULT_TIMER,
    timerFrom,
    type Appearance,
    type Behavior,
    type TimerSettings,
} from './logic/parse.js';

/**
 * The notch's appearance, behavior and timer lengths from io.nokta.Settings1. Until the
 * daemon answers it holds the spec defaults; when the daemon goes away it
 * keeps the last values it saw, so a daemon restart does not flicker.
 */
export class SettingsClient {
    appearance: Appearance = { ...DEFAULT_APPEARANCE };
    behavior: Behavior = { ...DEFAULT_BEHAVIOR };
    timer: TimerSettings = { ...DEFAULT_TIMER };
    private proxy: Gio.DBusProxy | null = null;
    private changedId = 0;

    constructor(private readonly onChanged: () => void) {}

    async attach(connection: Gio.DBusConnection, cancellable: Gio.Cancellable): Promise<void> {
        const proxy = await makeProxy(SETTINGS1_XML, PATHS.Settings1, connection, cancellable);
        this.detach();
        this.proxy = proxy;
        this.changedId = proxy.connect('g-properties-changed', () => this.read());
        this.read();
    }

    detach(): void {
        if (!this.proxy) return;
        this.proxy.disconnect(this.changedId);
        this.proxy = null;
        this.changedId = 0;
    }

    private read(): void {
        if (!this.proxy) return;
        this.appearance = appearanceFrom(cached(this.proxy, 'Appearance'));
        this.behavior = behaviorFrom(cached(this.proxy, 'Behavior'));
        this.timer = timerFrom(cached(this.proxy, 'Timer'));
        this.onChanged();
    }
}
