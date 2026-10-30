import type Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import { orGnome } from '../../shared/logic/guard.js';
import { replaceMethod } from '../../shared/patch.js';
import type { Restore } from '../../shared/topbar.js';
import type { BannerShape } from './logic/screenshot.js';

/** The parts of ui/messageTray.js Notification used here. */
export interface TrayNotification {
    title: string | null;
    body: string | null;
    urgency: number;
    gicon: Gio.Icon | null;
    source: { title: string | null; icon: Gio.Icon | null } | null;
    acknowledged: boolean;
    /** Its buttons; GNOME 46 and later. */
    actions?: ReadonlyArray<{ readonly label?: string; activate(): void }>;
    activate(): void;
    playSound?(): void;
    connect(signal: 'destroy', callback: () => void): number;
    disconnect(id: number): void;
}

/** The parts of ui/messageTray.js MessageTray used here. */
interface MessageTray {
    _showNotification: () => void;
    _notificationQueue: TrayNotification[];
    emit(signal: 'queue-changed'): void;
}

/**
 * Offers each banner GNOME is about to show to `show`, which returns true
 * when the notch took it. GNOME has already applied Do Not Disturb, the
 * per-app settings, the lock screen and fullscreen by then, so the notch
 * only ever gets what GNOME would have shown. Returns null, and changes
 * nothing, when this GNOME has no such method.
 */
export function takeOverBanners(show: (notification: TrayNotification) => boolean): Restore | null {
    const tray = Main.messageTray as unknown as MessageTray;
    if (typeof tray._showNotification !== 'function' || !Array.isArray(tray._notificationQueue)) {
        console.warn("Nokta: this GNOME Shell has no MessageTray._showNotification; notifications stay in GNOME's banner");
        return null;
    }
    const original = tray._showNotification;
    return replaceMethod(tray, 'messageTray', '_showNotification', () => {
        const next = tray._notificationQueue[0];
        // A Nokta bug leaves the banner to GNOME rather than stall its queue.
        const taken = next ? orGnome(() => show(next), () => false, reportHookError) : false;
        if (!taken) {
            original.call(tray);
            return;
        }
        // What GNOME does for a banner it shows, minus the banner.
        tray._notificationQueue.shift();
        tray.emit('queue-changed');
        next.acknowledged = true;
        next.playSound?.();
    });
}

function reportHookError(error: unknown): void {
    console.error('Nokta: cannot show a banner in the notch, GNOME shows it instead', error);
}

/** How many notifications wait in GNOME's message list; null when this GNOME does not say. */
export function notificationCount(): number | null {
    const tray = Main.messageTray as unknown as { getSources?: () => Array<{ notifications?: unknown }> };
    if (typeof tray.getSources !== 'function') return null;
    let count = 0;
    for (const source of tray.getSources()) {
        if (Array.isArray(source.notifications)) count += source.notifications.length;
    }
    return count;
}

/** The parts of ui/popupMenu.js PopupMenu used here. */
interface DateMenu {
    sourceActor: Clutter.Actor;
    isOpen: boolean;
    toggle(): void;
    close(animate?: number): void;
    connect(signal: 'open-state-changed', callback: (menu: unknown, open: boolean) => void): number;
    disconnect(id: number): void;
}

/**
 * Opens GNOME's calendar and message list in the middle of the top bar,
 * under the notch, so it works while the top bar's clock is hidden. The
 * menu points at its own clock again once it closes. Returns an undo for
 * disable(), or null when this GNOME has no such menu.
 */
export function openMessageList(): Restore | null {
    const indicator = Main.panel.statusArea.dateMenu as unknown as { menu?: DateMenu } | undefined;
    const menu = indicator?.menu;
    if (!menu || typeof menu.toggle !== 'function' || !('sourceActor' in menu)) return null;
    if (menu.isOpen) {
        menu.close();
        return null;
    }
    const clock = menu.sourceActor;
    let id = 0;
    const restore = () => {
        if (!id) return;
        menu.disconnect(id);
        id = 0;
        menu.sourceActor = clock;
    };
    id = menu.connect('open-state-changed', (_menu, open) => {
        if (!open) restore();
    });
    menu.sourceActor = Main.panel as unknown as Clutter.Actor;
    menu.toggle();
    return () => {
        if (id && menu.isOpen) menu.close();
        restore();
    };
}

/** What isScreenshotBanner needs to know about a banner. */
export function bannerShape(notification: TrayNotification): BannerShape {
    const icon = notification.source?.icon;
    const sourceIcon = icon instanceof Gio.ThemedIcon ? (icon.get_names()[0] ?? null) : null;
    // GNOME draws the screenshot itself into the notification's image.
    return { sourceIcon, hasImage: notification.gicon instanceof St.ImageContent };
}

/** The parts of ui/screenshot.js ScreenshotUI used here. */
interface ScreenshotUI {
    connect(signal: 'screenshot-taken', callback: (ui: unknown, file: Gio.File) => void): number;
    disconnect(id: number): void;
}

/**
 * Calls `onFile` with the URI of each screenshot GNOME's screenshot UI
 * saves. Its direct shortcuts save without saying so. Returns null when
 * this GNOME has no screenshot UI.
 */
export function watchScreenshots(onFile: (uri: string) => void): Restore | null {
    const ui = (Main as unknown as { screenshotUI?: ScreenshotUI | null }).screenshotUI;
    if (!ui || typeof ui.connect !== 'function') return null;
    const id = ui.connect('screenshot-taken', (_ui, file) => onFile(file.get_uri()));
    return () => ui.disconnect(id);
}
