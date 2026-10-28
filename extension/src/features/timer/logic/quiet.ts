import type { TimerSnapshot } from './timer.js';

/** GNOME's `org.gnome.desktop.notifications show-banners` key. */
export interface BannerSetting {
    get(): boolean;
    set(value: boolean): void;
}

/** Banners stay quiet while a focus session runs, if the user wants that. */
export const wantsQuiet = (timer: TimerSnapshot, quietNotifications: boolean): boolean =>
    quietNotifications && timer.state === 'running' && timer.phase === 'focus';

/**
 * Turns banners off for focus and back on after. Only banners Nokta turned
 * off are turned on again: banners the user had off stay off, and banners
 * the user turned on in between are left as they are. Do Not Disturb set
 * from the notch is the user's: focus leaves banners alone for the rest of
 * that session, so it never undoes the choice.
 */
export class QuietBanners {
    private silenced = false;
    /** The user chose during this focus session. */
    private chosen = false;

    constructor(private readonly setting: BannerSetting) {}

    get doNotDisturb(): boolean {
        return !this.setting.get();
    }

    setDoNotDisturb(on: boolean): void {
        this.silenced = false;
        this.chosen = true;
        if (this.setting.get() === on) this.setting.set(!on);
    }

    update(quiet: boolean): void {
        if (!quiet) this.chosen = false;
        if (quiet && !this.chosen && !this.silenced && this.setting.get()) {
            this.setting.set(false);
            this.silenced = true;
        } else if (!quiet && this.silenced) {
            this.silenced = false;
            if (!this.setting.get()) this.setting.set(true);
        }
    }

    /** Puts banners back; for the end of the extension. */
    release(): void {
        this.update(false);
    }
}
