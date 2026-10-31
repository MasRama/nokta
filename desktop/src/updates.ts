import type { Bridge } from './bridge/bridge.js';
import { Follower } from './follower.js';

/** Updates1: the newer Nokta GitHub has, empty for none, and its release page. */
export class Updates extends Follower {
    latest = '';
    url = '';

    constructor(bridge: Bridge, onChanged: () => void) {
        super(bridge, 'Updates1', onChanged);
    }

    protected override read(): void {
        const { Latest, ReleaseUrl } = this.props;
        this.latest = typeof Latest === 'string' ? Latest : '';
        this.url = typeof ReleaseUrl === 'string' ? ReleaseUrl : '';
    }
}
