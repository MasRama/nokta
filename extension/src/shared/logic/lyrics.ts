/** (start_us, text) pairs sorted by start, as in io.nokta.Lyrics1.Lines. */
export type LyricLines = ReadonlyArray<readonly [number, string]>;

/** Index of the line playing at `positionUs`, or -1 before the first line. */
export function currentLineIndex(lines: LyricLines, positionUs: number): number {
    let low = 0;
    let high = lines.length - 1;
    let found = -1;
    while (low <= high) {
        const mid = (low + high) >> 1;
        if (lines[mid][0] <= positionUs) {
            found = mid;
            low = mid + 1;
        } else {
            high = mid - 1;
        }
    }
    return found;
}

/** When the next line starts, or null after the last one. */
export function nextLineStartUs(lines: LyricLines, positionUs: number): number | null {
    const next = lines[currentLineIndex(lines, positionUs) + 1];
    return next ? next[0] : null;
}
