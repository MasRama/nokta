import type { Bridge } from './bridge/bridge.js';
import { Follower } from './follower.js';

/** Updates1: the newer Nokta GitHub has, empty for none, its release page, and installing it. */
export class Updates extends Follower {
    latest = '';
    url = '';
    /** Install was pressed; the update shows itself as an activity from then on. */
    installing = false;

    constructor(bridge: Bridge, onChanged: () => void) {
        super(bridge, 'Updates1', onChanged);
    }

    protected override read(): void {
        const { Latest, ReleaseUrl } = this.props;
        this.latest = typeof Latest === 'string' ? Latest : '';
        this.url = typeof ReleaseUrl === 'string' ? ReleaseUrl : '';
    }

    /** Starts `nokta update --yes`; `failed` hears why it could not. */
    install(failed: (message: string) => void): void {
        this.installing = true;
        this.bridge.call('Updates1', 'Install').catch((err: unknown) => {
            this.installing = false;
            failed(String(err));
        });
    }
}
