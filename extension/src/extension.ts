import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import { SettingsClient } from './features/settings/client.js';
import { IdleClock } from './shared/clock.js';
import { unwatchDaemon, watchDaemon } from './shared/dbus.js';
import { Notch } from './shared/notch.js';

const isCancelled = (error: unknown): boolean =>
    error instanceof GLib.Error && error.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED);

/** Everything one enable() creates; destroy() undoes all of it. */
class Session {
    private readonly settings: SettingsClient;
    private readonly notch: Notch;
    private readonly clock = new IdleClock();
    private readonly monitorsId: number;
    private readonly watchId: number;
    private cancellable = new Gio.Cancellable();

    constructor() {
        this.settings = new SettingsClient(() => this.applySettings());
        this.notch = new Notch(this.settings.appearance);
        this.notch.body.add_child(this.clock.actor);
        Main.layoutManager.addTopChrome(this.notch.actor, { affectsStruts: false, trackFullscreen: true });
        this.monitorsId = Main.layoutManager.connect('monitors-changed', () => this.placeOnMonitor());
        this.placeOnMonitor();
        const { idleWidth, height } = this.settings.appearance;
        this.notch.jumpTo(idleWidth, height);
        this.clock.start();
        this.watchId = watchDaemon(
            (connection) => this.onDaemonAppeared(connection),
            () => this.onDaemonVanished(),
        );
    }

    destroy(): void {
        unwatchDaemon(this.watchId);
        this.cancellable.cancel();
        this.settings.detach();
        Main.layoutManager.disconnect(this.monitorsId);
        this.clock.destroy();
        Main.layoutManager.removeChrome(this.notch.actor);
        this.notch.destroy();
    }

    private onDaemonAppeared(connection: Gio.DBusConnection): void {
        this.settings.attach(connection, this.cancellable).catch((error: unknown) => {
            if (!isCancelled(error)) console.error('Nokta: cannot read io.nokta.Settings1', error);
        });
    }

    private onDaemonVanished(): void {
        this.cancellable.cancel();
        this.cancellable = new Gio.Cancellable();
        this.settings.detach();
    }

    private applySettings(): void {
        const { idleWidth, height } = this.settings.appearance;
        this.notch.setAppearance(this.settings.appearance);
        this.notch.resizeTo(idleWidth, height, 'width');
    }

    private placeOnMonitor(): void {
        const monitor = Main.layoutManager.primaryMonitor;
        if (monitor) this.notch.setMonitor({ x: monitor.x, y: monitor.y, width: monitor.width });
    }
}

export default class NoktaExtension extends Extension {
    private session: Session | null = null;

    override enable(): void {
        this.session = new Session();
    }

    override disable(): void {
        this.session?.destroy();
        this.session = null;
    }
}
