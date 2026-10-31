import { activitiesFrom, type Activity } from '@ext/features/activities/logic/activities.js';

import type { Bridge } from './bridge/bridge.js';
import { Follower } from './follower.js';

/** One `Activities1.Ended` signal. */
export interface Ended {
    title: string;
    success: boolean;
    message: string;
    elapsedUs: number;
}

/**
 * Activities1: the live activities apps and scripts show, newest first,
 * the page's ActivitiesClient. Their start times are on the wall clock,
 * as `nowUs()` reads it.
 */
export class Activities extends Follower {
    list: Activity[] = [];
    private stopEnded: (() => void) | null = null;

    constructor(
        bridge: Bridge,
        onChanged: () => void,
        private readonly onEnded: (ended: Ended) => void,
    ) {
        super(bridge, 'Activities1', onChanged);
    }

    override async attach(): Promise<void> {
        this.stopEnded = this.bridge.onSignal('Activities1', 'Ended', (_id, title, success, message, elapsedUs) =>
            this.onEnded({
                title: typeof title === 'string' ? title : '',
                success: success === true,
                message: typeof message === 'string' ? message : '',
                elapsedUs: typeof elapsedUs === 'number' ? elapsedUs : 0,
            }),
        );
        await super.attach();
    }

    override detach(): void {
        this.stopEnded?.();
        this.stopEnded = null;
        super.detach();
    }

    protected override read(): void {
        this.list = activitiesFrom(this.props.Activities);
    }
}
