import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';

import type { Rect } from './logic/items.js';
import { parseHelperLine, type HelperEvent } from './logic/protocol.js';

/** A helper that keeps dying is left dead after this many new starts. */
const MAX_RESPAWNS = 3;
/** Where the window waits while nothing needs it: off every monitor. */
const AWAY: Rect = { x: -10000, y: -10000, width: 1, height: 1 };

/** GNOME 49 and later: one call spawns the client; the window itself becomes a dock. */
interface ModernClient {
    new_subprocess?(context: Meta.Context, launcher: Gio.SubprocessLauncher, argv: string[]): Meta.WaylandClient;
}
interface ModernWindow {
    set_type?(type: Meta.WindowType): void;
    hide_from_window_list?(): void;
}

/**
 * The shelf's helper window (shelf-helper/main.js) as the shell's own
 * Wayland client: a dock above every window, not in Alt-Tab or the
 * overview, placed where the shell asks. It is started again if it dies,
 * at most MAX_RESPAWNS times. destroy() ends it.
 */
export class ShelfHelper {
    private client: Meta.WaylandClient | null = null;
    private process: Gio.Subprocess | null = null;
    /** The helper's window, from its creation. */
    private adopted: Meta.Window | null = null;
    /** The same window once it has drawn, so it can be placed. */
    private window: Meta.Window | null = null;
    private windowIds: number[] = [];
    private createdId = 0;
    private respawns = 0;
    private rect: Rect = AWAY;
    private readonly cancellable = new Gio.Cancellable();
    private destroyed = false;

    constructor(
        private readonly script: string,
        private readonly onEvent: (event: HelperEvent) => void,
    ) {
        this.spawn();
    }

    /** Puts the window over `rect` in stage coordinates, or away. */
    place(rect: Rect | null): void {
        this.rect = rect ?? AWAY;
        this.applyPlace();
    }

    destroy(): void {
        if (this.destroyed) return;
        this.destroyed = true;
        this.cancellable.cancel();
        this.forgetWindow();
        if (this.createdId) global.display.disconnect(this.createdId);
        this.createdId = 0;
        this.process?.force_exit();
        this.process = null;
        this.client = null;
    }

    private spawn(): void {
        const gjs = GLib.find_program_in_path('gjs');
        if (!gjs) {
            console.warn('Nokta: gjs is missing, so the file shelf cannot take drops');
            return;
        }
        const argv = [gjs, '-m', this.script];
        const launcher = new Gio.SubprocessLauncher({ flags: Gio.SubprocessFlags.STDOUT_PIPE });
        // The window draws nothing; software drawing is enough and needs no GPU context.
        launcher.setenv('GSK_RENDERER', 'cairo', true);
        launcher.setenv('GTK_A11Y', 'none', true);
        try {
            const modern = Meta.WaylandClient as unknown as ModernClient;
            if (modern.new_subprocess) {
                this.client = modern.new_subprocess(global.context, launcher, argv);
                this.process = (this.client as unknown as { get_subprocess(): Gio.Subprocess }).get_subprocess();
            } else {
                this.client = Meta.WaylandClient.new(global.context, launcher);
                this.process = this.client.spawnv(global.display, argv);
            }
        } catch (error) {
            console.warn('Nokta: cannot start the file shelf helper', error);
            this.client = null;
            this.process = null;
            return;
        } finally {
            // The launcher holds the helper's end of its Wayland socket. Kept
            // open, the shell would only see the helper go when the launcher
            // is garbage collected, too late for its window to be removed.
            launcher.close();
        }
        if (!this.createdId)
            this.createdId = global.display.connect('window-created', (_d, window: Meta.Window) => this.adopt(window));
        this.read(this.process);
        this.process.wait_async(this.cancellable, (process, result) => {
            try {
                process?.wait_finish(result);
            } catch {
                // Cancelled: destroy() ended it.
            }
            this.onExit(process);
        });
    }

    private adopt(window: Meta.Window): void {
        const client = this.client;
        if (!client || !client.owns_window(window)) return;
        this.forgetWindow();
        const modern = window as unknown as ModernWindow;
        const legacy = client as unknown as {
            make_dock(window: Meta.Window): void;
            hide_from_window_list(window: Meta.Window): void;
        };
        if (modern.set_type) modern.set_type(Meta.WindowType.DOCK);
        else legacy.make_dock(window);
        if (modern.hide_from_window_list) modern.hide_from_window_list();
        else legacy.hide_from_window_list(window);
        this.windowIds = [
            // Mutter cannot move a window that has not drawn yet.
            window.connect('shown', () => {
                window.make_above();
                window.stick();
                this.window = window;
                this.applyPlace();
            }),
            window.connect('unmanaged', () => this.forgetWindow()),
        ];
        this.adopted = window;
    }

    private applyPlace(): void {
        const window = this.window;
        if (!window) return;
        const { x, y, width, height } = this.rect;
        // A resize waits for the client to draw the new size, and a window
        // off every monitor never draws. Moving needs no client, so move first.
        window.move_frame(false, x, y);
        window.move_resize_frame(false, x, y, width, height);
    }

    private forgetWindow(): void {
        for (const id of this.windowIds) this.adopted?.disconnect(id);
        this.windowIds = [];
        this.adopted = null;
        this.window = null;
    }

    /** One event per line the helper prints; anything else it prints is ignored. */
    private read(process: Gio.Subprocess): void {
        const pipe = process.get_stdout_pipe();
        if (!pipe) return;
        const lines = new Gio.DataInputStream({ base_stream: pipe, close_base_stream: true });
        const next = (): void => {
            lines.read_line_async(GLib.PRIORITY_DEFAULT, this.cancellable, (_s, result) => {
                let line: string | null;
                try {
                    [line] = lines.read_line_finish_utf8(result);
                } catch {
                    return;
                }
                if (line === null || this.destroyed) return;
                const event = parseHelperLine(line);
                if (event) this.onEvent(event);
                next();
            });
        };
        next();
    }

    private onExit(process: Gio.Subprocess | null): void {
        if (this.destroyed || process !== this.process) return;
        this.forgetWindow();
        this.client = null;
        this.process = null;
        // The pointer may have been over it.
        this.onEvent({ kind: 'drag', active: false });
        this.onEvent({ kind: 'leave' });
        if (this.respawns >= MAX_RESPAWNS) {
            console.warn('Nokta: the file shelf helper keeps stopping; drops on the notch are off');
            return;
        }
        this.respawns++;
        this.spawn();
    }
}
