import { _ } from '../../../shared/logic/i18n.js';

/** What the notch shows for one io.nokta.Devices1.Alert. */
export interface DeviceAlert {
    icon: string;
    title: string;
    detail: string;
    /** Shown in red. */
    urgent: boolean;
}

const HEADPHONES = 'audio-headphones-symbolic';

const percent = (value: number): string =>
    Number.isInteger(value) && value >= 0 && value <= 100 ? `${value}%` : '';

/**
 * The alert for a (kind, name, percentage) signal,
 * or null for a kind this extension does not know.
 */
export function deviceAlert(kind: string, name: string, percentage: number): DeviceAlert | null {
    const device = name.trim() || _('Bluetooth device');
    const level = percent(percentage);
    const alert = (icon: string, title: string, detail: string, urgent = false): DeviceAlert => ({
        icon,
        title,
        detail,
        urgent,
    });
    switch (kind) {
        case 'bluetooth-connected':
            return alert(HEADPHONES, device, level || _('Connected'));
        case 'bluetooth-disconnected':
            return alert(HEADPHONES, device, _('Disconnected'));
        case 'charger-plugged':
            return alert('battery-good-charging-symbolic', _('Charging'), level);
        case 'charger-unplugged':
            return alert('battery-good-symbolic', _('On battery'), level);
        case 'battery-low':
            return alert('battery-low-symbolic', _('Battery low'), level);
        case 'battery-critical':
            return alert('battery-caution-symbolic', _('Battery critical'), level, true);
        case 'battery-full':
            return alert('battery-full-charged-symbolic', _('Fully charged'), level);
        default:
            return null;
    }
}

/** The battery runs low or out: the device alerts that show over a fullscreen app. */
export const isBatteryWarning = (kind: string): boolean => kind === 'battery-low' || kind === 'battery-critical';
