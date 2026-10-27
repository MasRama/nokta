import type Clutter from 'gi://Clutter';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import { NO_PRIVACY, type PrivacyState } from './logic/dots.js';

type Kind = keyof PrivacyState;

/** The private parts of GNOME's panel this reads; each may be missing. */
interface Indicator {
    _indicator?: Clutter.Actor;
}
interface QuickSettings {
    _camera?: Indicator;
    _volumeInput?: Indicator;
    _remoteAccess?: Indicator;
    _indicators?: Clutter.Actor;
}

/**
 * Follows GNOME's own privacy indicators in the top bar: the camera, the
 * microphone, and screen sharing or recording. Each indicator is shown
 * while its device is in use, so this watches their `visible`. An
 * indicator a GNOME version lacks is skipped.
 */
export class PrivacyMonitor {
    private watched: Array<{ kind: Kind; actor: Clutter.Actor; ids: number[] }> = [];
    private waitId = 0;
    private readonly quickSettings: QuickSettings | undefined;

    constructor(private readonly onChanged: () => void) {
        const statusArea = Main.panel.statusArea as unknown as Record<string, unknown>;
        this.quickSettings = statusArea.quickSettings as QuickSettings | undefined;
        this.watch('screen', statusArea.screenSharing as Clutter.Actor | undefined);
        this.watch('screen', statusArea.screenRecording as Clutter.Actor | undefined);
        this.watchQuickSettings();
        // Quick Settings builds its indicators asynchronously; at login they
        // may come after the extension.
        if (!this.quickSettings?._volumeInput && this.quickSettings?._indicators) {
            this.waitId = this.quickSettings._indicators.connect('child-added', () => {
                if (!this.quickSettings?._volumeInput) return;
                this.stopWaiting();
                this.watchQuickSettings();
                this.onChanged();
            });
        }
    }

    state(): PrivacyState {
        const state = { ...NO_PRIVACY };
        for (const { kind, actor } of this.watched) if (actor.visible) state[kind] = true;
        return state;
    }

    destroy(): void {
        this.stopWaiting();
        for (const { actor, ids } of this.watched) for (const id of ids) actor.disconnect(id);
        this.watched = [];
    }

    private watchQuickSettings(): void {
        const qs = this.quickSettings;
        this.watch('camera', qs?._camera?._indicator);
        this.watch('microphone', qs?._volumeInput?._indicator);
        this.watch('screen', qs?._remoteAccess?._indicator);
    }

    private watch(kind: Kind, actor: Clutter.Actor | undefined): void {
        if (!actor || this.watched.some((w) => w.actor === actor)) return;
        const entry = { kind, actor, ids: [] as number[] };
        entry.ids.push(actor.connect('notify::visible', () => this.onChanged()));
        entry.ids.push(
            actor.connect('destroy', () => {
                this.watched = this.watched.filter((w) => w !== entry);
                this.onChanged();
            }),
        );
        this.watched.push(entry);
    }

    private stopWaiting(): void {
        if (this.waitId) this.quickSettings?._indicators?.disconnect(this.waitId);
        this.waitId = 0;
    }
}
