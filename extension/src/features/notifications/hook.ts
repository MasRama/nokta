import type Gio from 'gi://Gio';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import { replaceMethod } from '../../shared/patch.js';
import type { Restore } from '../../shared/topbar.js';

/** The parts of ui/messageTray.js Notification used here. */
export interface TrayNotification {
    title: string | null;
    body: string | null;
    urgency: number;
    gicon: Gio.Icon | null;
    source: { title: string | null; icon: Gio.Icon | null } | null;
    acknowledged: boolean;
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
        if (!next || !show(next)) {
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
