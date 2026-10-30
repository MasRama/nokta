import { _ } from '../../../shared/logic/i18n.js';
import { sizeLabel } from '../../../shared/logic/format.js';

/** One sample of io.nokta.System1.Usage. */
export interface Usage {
    /** 0 to 1. */
    cpu: number;
    memoryUsed: number;
    memoryTotal: number;
    /** °C, NaN when unknown. */
    temperature: number;
    /** Bytes a second. */
    download: number;
    upload: number;
}

/** The property's `(dttddd)`, or null before the first sample. */
export function usageFrom(raw: unknown): Usage | null {
    if (!Array.isArray(raw) || raw.length !== 6 || !raw.every((v) => typeof v === 'number')) return null;
    const [cpu, memoryUsed, memoryTotal, temperature, download, upload] = raw as number[];
    // All zero while nobody watches.
    if (memoryTotal <= 0) return null;
    return { cpu, memoryUsed, memoryTotal, temperature, download, upload };
}

/** `42%`. */
export function cpuLabel(cpu: number): string {
    return `${Math.round(cpu * 100)}%`;
}

/** `5.1 / 15.4 GB`: both in the total's unit. */
export function memoryLabel(used: number, total: number): string {
    const [value, unit] = sizeLabel(total).split(' ');
    const scale = total / Number(value);
    return `${(used / scale).toFixed(1)} / ${value} ${unit}`;
}

/** `1.2 MB/s`. */
export function rateLabel(bytesPerSecond: number): string {
    return `${sizeLabel(Math.round(bytesPerSecond))}/s`;
}

/** `↓ 1.2 MB/s  ↑ 40.0 kB/s`. */
export function networkLabel(download: number, upload: number): string {
    return `↓ ${rateLabel(download)}  ↑ ${rateLabel(upload)}`;
}

/** `45 °C`, or `113 °F` with the weather in Fahrenheit; a dash when unknown. */
export function temperatureLabel(celsius: number, fahrenheit: boolean): string {
    if (!Number.isFinite(celsius)) return '–';
    return fahrenheit ? `${Math.round((celsius * 9) / 5 + 32)} °F` : `${Math.round(celsius)} °C`;
}

/**
 * What the notch says when memory is almost full: the app using the most,
 * or the memory when none is known. It fits an alert's width.
 */
export function memoryAlert(used: number, total: number, app: string): { title: string; detail: string } {
    return { title: _('Memory is almost full'), detail: app || memoryLabel(used, total) };
}
