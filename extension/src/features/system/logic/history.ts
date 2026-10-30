/** Samples the CPU line draws, one every 2 s: the last minute. */
export const HISTORY_LENGTH = 30;

/** The last {@link HISTORY_LENGTH} samples, oldest first. */
export class History {
    private samples: number[] = [];

    push(value: number): void {
        this.samples.push(value);
        if (this.samples.length > HISTORY_LENGTH) this.samples.shift();
    }

    values(): readonly number[] {
        return this.samples;
    }

    clear(): void {
        this.samples = [];
    }
}
