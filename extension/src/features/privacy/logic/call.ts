import { formatDuration } from '../../../shared/logic/format.js';
import { TONES } from '../../../shared/logic/tones.js';
import { _ } from '../../../shared/logic/i18n.js';

/** An app recording from a microphone, as GNOME's mixer names it. */
export interface RecordingStream {
    appId: string;
    name: string;
    iconName: string;
}

/**
 * Sound settings show the input level, so they record too; GNOME's
 * microphone indicator skips them as well. Nokta itself records what plays
 * for the bars that follow the music.
 */
const SKIPPED_APPS = ['org.gnome.VolumeControl', 'org.PulseAudio.pavucontrol', 'io.nokta.Nokta'];

/** The color of the call's microphone icon. */
export const CALL_COLORS = { live: TONES.call, muted: TONES.urgent } as const;

/** The dot of a screen recording, like GNOME's own. */
export const RECORDING_COLOR = TONES.recording;

/** The app on the call: the first one recording that is not a sound settings window. */
export function callingStream(streams: readonly RecordingStream[]): RecordingStream | null {
    return streams.find((s) => !SKIPPED_APPS.includes(s.appId)) ?? null;
}

/**
 * Whether someone is on the microphone: GNOME's indicator shows and, once
 * its mixer is ready (`streams` not null), an app other than those skipped
 * records. Nokta's own recording turns GNOME's indicator on too.
 */
export function microphoneInUse(indicator: boolean, streams: readonly RecordingStream[] | null): boolean {
    return indicator && (streams === null || callingStream(streams) !== null);
}

/** The app's name, else the stream's, else just the microphone. */
export function callTitle(appName: string | null, stream: RecordingStream | null): string {
    return appName || stream?.name || _('Microphone');
}

/** How long the microphone has been on: `12:03`. */
export function callText(startedUs: number, nowUs: number): string {
    return formatDuration(nowUs - startedUs);
}

/** `Microphone · 12:03`, or `Muted · 12:03`. */
export function callDetail(startedUs: number, nowUs: number, muted: boolean): string {
    return `${muted ? _('Muted') : _('Microphone')} · ${callText(startedUs, nowUs)}`;
}

/** Until the shown second changes. */
export function msUntilElapsedSecond(startedUs: number, nowUs: number): number {
    const intoSecond = Math.max(0, nowUs - startedUs) % 1_000_000;
    return Math.ceil((1_000_000 - intoSecond) / 1000);
}
