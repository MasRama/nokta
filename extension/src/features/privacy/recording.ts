import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import type GObject from 'gi://GObject';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import { Listeners } from '../../shared/listeners.js';

/** The parts of GNOME's screenshot UI used here; GNOME 46 to 51 have them. */
interface ScreenshotUI extends GObject.Object {
    screencast_in_progress?: boolean;
    stopScreencast?: () => Promise<void>;
    _screencastPath?: string;
}

/**
 * A screen recording from GNOME's screenshot UI: since when it runs, a way
 * to stop it, and the file of the last one. Missing parts of the UI leave
 * it never recording.
 */
export class ScreenRecording {
    private readonly ui: ScreenshotUI | null;
    private readonly id: number;
    private startedUs: number | null = null;
    private readonly listeners = new Listeners();

    constructor() {
        const ui = (Main as unknown as { screenshotUI?: ScreenshotUI }).screenshotUI ?? null;
        this.ui = ui && 'screencast_in_progress' in ui ? ui : null;
        this.id = this.ui?.connect('notify::screencast-in-progress', () => this.read()) ?? 0;
        this.read();
    }

    /** Monotonic time it started, or null while nothing records. */
    since(): number | null {
        return this.startedUs;
    }

    stop(): void {
        this.ui?.stopScreencast?.().catch((error: unknown) => console.warn(`nokta: cannot stop the recording: ${error}`));
    }

    /** The URI of the file GNOME records to, or wrote last. */
    fileUri(): string | null {
        const path = this.ui?._screencastPath;
        return typeof path === 'string' && path ? Gio.File.new_for_path(path).get_uri() : null;
    }

    onChanged(callback: () => void): number {
        return this.listeners.add(callback);
    }

    disconnect(id: number): void {
        this.listeners.remove(id);
    }

    destroy(): void {
        if (this.id) this.ui?.disconnect(this.id);
        this.listeners.clear();
    }

    private read(): void {
        const recording = this.ui?.screencast_in_progress === true;
        if (recording === (this.startedUs !== null)) return;
        this.startedUs = recording ? GLib.get_monotonic_time() : null;
        this.listeners.emit();
    }
}
