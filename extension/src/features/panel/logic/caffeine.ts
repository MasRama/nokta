/** GNOME's session manager: Inhibit gives a cookie that Uninhibit hands back. */
export interface Inhibitor {
    inhibit(): Promise<number>;
    uninhibit(cookie: number): Promise<void>;
}

/**
 * Keeps the screen awake while on, by holding one idle inhibitor. The
 * session manager answers later, so a click never waits: `on` is what the
 * user asked for, and the inhibitor follows it.
 */
export class Caffeine {
    private wanted = false;
    private cookie: number | null = null;
    private waiting = false;
    private released = false;

    constructor(
        private readonly port: Inhibitor,
        private readonly onChanged: () => void,
    ) {}

    get on(): boolean {
        return this.wanted;
    }

    set(on: boolean): void {
        if (this.released || on === this.wanted) return;
        this.wanted = on;
        this.onChanged();
        this.sync();
    }

    /** Lets the screen sleep again; for the end of the extension. */
    release(): void {
        this.wanted = false;
        this.released = true;
        this.sync();
    }

    private sync(): void {
        if (this.waiting) return;
        if (this.wanted && this.cookie === null) {
            this.waiting = true;
            this.port.inhibit().then(
                (cookie) => {
                    this.waiting = false;
                    this.cookie = cookie;
                    this.sync();
                },
                (error: unknown) => {
                    this.waiting = false;
                    console.warn(`Nokta: cannot keep the screen awake: ${error}`);
                    if (!this.wanted) return;
                    this.wanted = false;
                    this.onChanged();
                },
            );
        } else if (!this.wanted && this.cookie !== null) {
            const cookie = this.cookie;
            this.cookie = null;
            this.port.uninhibit(cookie).catch(() => {});
        }
    }
}
