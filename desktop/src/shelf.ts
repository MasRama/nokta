import { itemsFrom, type ShelfItem } from '@ext/features/shelf/logic/items.js';

import type { Bridge } from './bridge/bridge.js';
import { Follower } from './follower.js';

/** Shelf1: the files parked on the notch, oldest first, with their thumbnails; the page's ShelfClient. */
export class Shelf extends Follower {
    items: ShelfItem[] = [];

    constructor(bridge: Bridge, onChanged: () => void) {
        super(bridge, 'Shelf1', onChanged);
    }

    /** Parks files the core announced, like a finished download. */
    add(uris: readonly string[]): void {
        this.call('Add', [...uris]);
    }

    remove(uri: string): void {
        this.call('Remove', uri);
    }

    clear(): void {
        this.call('Clear');
    }

    protected override read(): void {
        this.items = itemsFrom(this.props.Items, this.props.Thumbnails);
    }
}
