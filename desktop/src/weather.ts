import { weatherLine, type WeatherLine } from '@ext/features/weather/logic/weather.js';

import type { Bridge } from './bridge/bridge.js';
import { Follower } from './follower.js';

/** Weather1: the weather the core last read for the configured place. */
export class Weather extends Follower {
    /** Null while there is no ready reading. */
    line: WeatherLine | null = null;

    constructor(bridge: Bridge, onChanged: () => void) {
        super(bridge, 'Weather1', onChanged);
    }

    /** Asks the core for new weather if its reading is stale; the answer comes as a change. */
    refresh(): void {
        this.call('Refresh');
    }

    protected override read(): void {
        this.line = weatherLine(this.props);
    }
}
