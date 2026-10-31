import { downloadFrom, type Download } from '@ext/features/downloads/logic/download.js';

import type { Bridge } from './bridge/bridge.js';

/** Downloads1: each file that finishes downloading, the page's DownloadsClient. */
export class Downloads {
    private stop: (() => void) | null = null;

    constructor(
        private readonly bridge: Bridge,
        private readonly onFinished: (download: Download) => void,
    ) {}

    attach(): void {
        this.detach();
        this.stop = this.bridge.onSignal('Downloads1', 'Finished', (...args) => {
            const download = downloadFrom(args);
            if (download) this.onFinished(download);
        });
    }

    detach(): void {
        this.stop?.();
        this.stop = null;
    }
}
