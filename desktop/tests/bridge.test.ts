import { describe, expect, it } from 'vitest';

import { MockBridge } from '../src/bridge/mock.js';

describe('MockBridge', () => {
    it('hands out properties and tells subscribers of changes', async () => {
        const bridge = new MockBridge({ Weather1: { Status: 'ok', Temperature: 30 } });
        const seen: unknown[] = [];
        const stop = bridge.onChanged('Weather1', (changed) => seen.push(changed));
        bridge.set('Weather1', { Temperature: 31 });
        expect(await bridge.props('Weather1')).toEqual({ Status: 'ok', Temperature: 31 });
        stop();
        bridge.set('Weather1', { Temperature: 32 });
        expect(seen).toEqual([{ Temperature: 31 }]);
    });

    it('changes a settings table on Set, as the core would', async () => {
        const bridge = new MockBridge({ Settings1: { Appearance: { theme: 'midnight', height: 32 } } });
        await bridge.call('Settings1', 'Set', 'appearance', 'theme', 'glass');
        const props = await bridge.props('Settings1');
        expect(props.Appearance).toEqual({ theme: 'glass', height: 32 });
        expect(bridge.calls).toEqual([{ iface: 'Settings1', method: 'Set', args: ['appearance', 'theme', 'glass'] }]);
    });

    it('delivers signals with their arguments', () => {
        const bridge = new MockBridge();
        const seen: unknown[][] = [];
        bridge.onSignal('Timer1', 'Finished', (...args) => seen.push(args));
        bridge.signal('Timer1', 'Finished', 'focus');
        expect(seen).toEqual([['focus']]);
    });
});
