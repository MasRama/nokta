import type { Bridge, Props } from './bridge/bridge.js';

/** Follows an interface's properties: all of them first, then each change. */
export class Follower {
    protected props: Props = {};
    private stop: (() => void) | null = null;

    constructor(
        protected readonly bridge: Bridge,
        private readonly iface: string,
        private readonly onChanged: () => void,
    ) {}

    async attach(): Promise<void> {
        this.stop = this.bridge.onChanged(this.iface, (changed) => {
            this.props = { ...this.props, ...changed };
            this.read();
            this.onChanged();
        });
        this.props = { ...(await this.bridge.props(this.iface)), ...this.props };
        this.read();
        this.onChanged();
    }

    detach(): void {
        this.stop?.();
        this.stop = null;
    }

    protected read(): void {}

    protected call(method: string, ...args: unknown[]): void {
        this.bridge.call(this.iface, method, ...args).catch((err: unknown) => console.warn(`${this.iface}.${method}:`, err));
    }
}
