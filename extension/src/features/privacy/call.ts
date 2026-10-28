import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Gvc from 'gi://Gvc';
import Shell from 'gi://Shell';
import * as Volume from 'resource:///org/gnome/shell/ui/status/volume.js';

import { Listeners } from '../../shared/listeners.js';
import { callingStream, callTitle, type RecordingStream } from './logic/call.js';

const MICROPHONE_ICON = 'audio-input-microphone-symbolic';

/** The microphone in use: by which app, since when, and whether it is muted. */
export interface Call {
    title: string;
    icon: Gio.Icon;
    /** Monotonic time the microphone came on. */
    startedUs: number;
    muted: boolean;
}

/**
 * A call, as far as GNOME can tell: while its microphone indicator shows,
 * the app recording (from GNOME's mixer, the one Quick Settings uses), how
 * long the microphone has been on and the default microphone's mute. The
 * user can hide it until the microphone goes off.
 */
export class CallMonitor {
    private readonly control: Gvc.MixerControl;
    private readonly ids: number[] = [];
    private source: Gvc.MixerStream | null = null;
    private sourceId = 0;
    private startedUs: number | null = null;
    private hidden = false;
    private readonly listeners = new Listeners();

    constructor() {
        this.control = Volume.getMixerControl();
        this.ids.push(
            this.control.connect('stream-added', () => this.listeners.emit()),
            this.control.connect('stream-removed', () => this.listeners.emit()),
            this.control.connect('default-source-changed', () => this.readSource()),
            this.control.connect('state-changed', () => this.readSource()),
        );
        this.readSource();
    }

    /** GNOME's microphone indicator showed or went away. */
    setMicrophone(on: boolean): void {
        if (on === (this.startedUs !== null)) return;
        this.startedUs = on ? GLib.get_monotonic_time() : null;
        this.hidden = false;
        this.listeners.emit();
    }

    /** Null while the microphone is off or the user hid the call. */
    call(): Call | null {
        if (this.startedUs === null || this.hidden) return null;
        const stream = callingStream(this.recording());
        const app = stream ? lookupApp(stream.appId) : null;
        const iconName = stream?.iconName || MICROPHONE_ICON;
        return {
            title: callTitle(app?.get_name() ?? null, stream),
            icon: app?.get_icon() ?? new Gio.ThemedIcon({ name: iconName }),
            startedUs: this.startedUs,
            muted: this.source?.is_muted ?? false,
        };
    }

    toggleMute(): void {
        this.source?.change_is_muted(!this.source.is_muted);
    }

    /** Until the microphone goes off. */
    hide(): void {
        if (this.startedUs === null || this.hidden) return;
        this.hidden = true;
        this.listeners.emit();
    }

    onChanged(callback: () => void): number {
        return this.listeners.add(callback);
    }

    disconnect(id: number): void {
        this.listeners.remove(id);
    }

    /** GNOME owns the mixer; only the signals go. */
    destroy(): void {
        this.watchSource(null);
        for (const id of this.ids) this.control.disconnect(id);
        this.ids.length = 0;
        this.listeners.clear();
    }

    private recording(): RecordingStream[] {
        if (this.control.get_state() !== Gvc.MixerControlState.READY) return [];
        return this.control.get_source_outputs().map((output) => ({
            appId: output.get_application_id() ?? '',
            name: output.get_name() ?? '',
            iconName: output.get_icon_name() ?? '',
        }));
    }

    private readSource(): void {
        const ready = this.control.get_state() === Gvc.MixerControlState.READY;
        this.watchSource(ready ? this.control.get_default_source() : null);
        this.listeners.emit();
    }

    private watchSource(source: Gvc.MixerStream | null): void {
        if (source === this.source) return;
        if (this.sourceId) this.source?.disconnect(this.sourceId);
        this.source = source;
        this.sourceId = source ? source.connect('notify::is-muted', () => this.listeners.emit()) : 0;
    }
}

/** The app by its id, as a desktop file or a window class. */
function lookupApp(appId: string): Shell.App | null {
    if (!appId) return null;
    const apps = Shell.AppSystem.get_default();
    return apps.lookup_app(`${appId}.desktop`) ?? apps.lookup_desktop_wmclass(appId);
}
