/** A sound output as GNOME's mixer (Gvc) knows it. */
export interface AudioOutput {
    id: number;
    description: string;
    /** The card it is on, like `Built-in Audio`; often empty. */
    origin: string;
    /** The theme icon Gvc gives it, like `audio-headphones`. */
    iconName: string;
}

/** `Speakers – Built-in Audio`, like Quick Settings' output menu. */
export const outputLabel = ({ description, origin }: AudioOutput): string =>
    origin ? `${description} – ${origin}` : description;

/** The output button's icon: headphones, a display or speakers. */
export function outputIcon(output: AudioOutput | null): string {
    const text = output ? `${output.iconName} ${output.description}`.toLowerCase() : '';
    if (/headphone|headset|earbud|hands-?free/.test(text)) return 'audio-headphones-symbolic';
    if (/hdmi|displayport|video-display/.test(text)) return 'video-display-symbolic';
    return 'audio-speakers-symbolic';
}

export const sortedOutputs = (outputs: readonly AudioOutput[]): AudioOutput[] =>
    [...outputs].sort((a, b) => outputLabel(a).localeCompare(outputLabel(b)));

/**
 * The output ids that `has` knows, from 1 on. Gvc numbers every device it
 * ever saw, inputs too, so the ids have gaps: the search goes on `margin`
 * past the last one found, and at least `margin` past `from`.
 */
export function probeOutputIds(has: (id: number) => boolean, from: number, margin: number): number[] {
    const ids: number[] = [];
    let limit = Math.max(from, 0) + margin;
    for (let id = 1; id <= limit; id++) {
        if (!has(id)) continue;
        ids.push(id);
        limit = Math.max(limit, id + margin);
    }
    return ids;
}

/**
 * The ids Quick Settings lists with the ones Gvc announced since: its menu
 * may hear of a new output after we do.
 */
export const outputIds = (listed: readonly number[], announced: Iterable<number>): number[] =>
    [...new Set([...listed, ...announced])].sort((a, b) => a - b);
