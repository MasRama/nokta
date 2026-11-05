import {
    cardsFrom,
    pluginAlert,
    pluginsFrom,
    type Plugin,
    type PluginAlert,
    type PluginCard,
} from '@ext/features/plugins/logic/plugins.js';

import type { Bridge } from './bridge/bridge.js';
import { Follower } from './follower.js';

/**
 * Plugins1: the add-on plugins and the cards of the ones that run, the
 * page's PluginsClient. A plugin's alert goes to `onAlert`.
 */
export class Plugins extends Follower {
    list: Plugin[] = [];
    cards: PluginCard[] = [];
    private stopAlert: (() => void) | null = null;

    constructor(
        bridge: Bridge,
        onChanged: () => void,
        private readonly onAlert: (alert: PluginAlert) => void,
    ) {
        super(bridge, 'Plugins1', onChanged);
    }

    override async attach(): Promise<void> {
        const text = (value: unknown): string => (typeof value === 'string' ? value : '');
        this.stopAlert = this.bridge.onSignal('Plugins1', 'Alert', (id, title, detail, icon, tone, important) => {
            const plugin = this.list.find((p) => p.id === id);
            this.onAlert(pluginAlert(text(title), text(detail), text(icon), text(tone), important === true, plugin));
        });
        await super.attach();
    }

    override detach(): void {
        this.stopAlert?.();
        this.stopAlert = null;
        super.detach();
    }

    /** Runs plugin `id` now, telling it `action`. */
    run(id: string, action: string): void {
        this.call('Run', id, action);
    }

    protected override read(): void {
        this.list = pluginsFrom(this.props.Plugins);
        this.cards = cardsFrom(this.props.Cards, this.list);
    }
}
