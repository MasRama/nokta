import { describe, expect, it } from 'vitest';

import { DEFAULT_APPEARANCE } from '@ext/features/settings/logic/parse.js';

import { MockBridge } from '../src/bridge/mock.js';
import { Settings } from '../src/settings.js';

describe('Settings', () => {
    it('holds the defaults until the bridge answers', () => {
        const settings = new Settings(new MockBridge(), () => {});
        expect(settings.appearance).toEqual(DEFAULT_APPEARANCE);
        expect(settings.picture).toEqual({ path: '', color: '', tone: '' });
    });

    it('reads the tables and the prepared picture', async () => {
        const bridge = new MockBridge({
            Settings1: {
                Appearance: { theme: 'glass', idle_width: 200 },
                PicturePath: 'C:\\pic.png',
                PictureColor: '#102030',
                PictureTone: 'dark',
            },
        });
        const settings = new Settings(bridge, () => {});
        await settings.attach();
        expect(settings.appearance.theme).toBe('glass');
        expect(settings.appearance.idleWidth).toBe(200);
        expect(settings.picture).toEqual({ path: 'C:\\pic.png', color: '#102030', tone: 'dark' });
    });

    it('follows a change it set itself', async () => {
        const bridge = new MockBridge({ Settings1: { Appearance: { theme: 'midnight' } } });
        let changes = 0;
        const settings = new Settings(bridge, () => changes++);
        await settings.attach();
        await settings.set('appearance', 'theme', 'aurora');
        expect(settings.appearance.theme).toBe('aurora');
        expect(changes).toBe(2);
        settings.detach();
        bridge.set('Settings1', { Appearance: { theme: 'paper' } });
        expect(settings.appearance.theme).toBe('aurora');
    });
});
