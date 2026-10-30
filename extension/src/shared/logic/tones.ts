import { darkenTo, textOn, withAlpha } from './color.js';

/**
 * Each kind of thing the notch shows has its own color: its icon, its
 * toggle or tile when on, its glow and its progress line take it.
 */
export const TONES = {
    focus: '#ff7b63',
    break: '#57e389',
    countdown: '#ffb340',
    stopwatch: '#5ac8fa',
    alarm: '#bf9cff',
    do_not_disturb: '#7d7aff',
    caffeine: '#ffb340',
    dark_style: '#a2a2ab',
    night_light: '#ff9f0a',
    notifications: '#ff453a',
    clipboard: '#40c8e0',
    settings: '#a2a2ab',
    screenshot: '#ff6482',
    downloads: '#30d5a0',
    calendar: '#ff453a',
    device: '#0a84ff',
    call: '#ff9500',
    recording: '#ff453a',
    urgent: '#ff453a',
    success: '#30d158',
} as const;
export type Tone = keyof typeof TONES;

/** An icon or text in `tone`: as it is on a dark notch, darkened until it reads on a light one. */
export function toneOn(tone: string, light: boolean): string {
    return light ? darkenTo(tone, 0.25) : tone;
}

/** The icon and text color on a fill of `tone`. */
export const onTone = (tone: string): string => textOn(tone);

/** A row's icon chip in home: a square of the tone at 20 % under the icon in the tone. */
export function toneChip(tone: string, light: boolean): { fill: string; icon: string } {
    return { fill: withAlpha(tone, 0.2), icon: toneOn(tone, light) };
}
