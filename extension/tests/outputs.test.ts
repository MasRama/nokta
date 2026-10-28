import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
    outputIcon,
    outputIds,
    outputLabel,
    probeOutputIds,
    sortedOutputs,
    type AudioOutput,
} from '../src/features/media/logic/outputs.js';

const output = (id: number, description: string, origin = '', iconName = 'audio-card'): AudioOutput => ({
    id,
    description,
    origin,
    iconName,
});

test('an output is named like Quick Settings names it', () => {
    assert.equal(outputLabel(output(1, 'Speakers', 'Built-in Audio')), 'Speakers – Built-in Audio');
    assert.equal(outputLabel(output(1, 'Pixel Buds')), 'Pixel Buds');
});

test('the button shows headphones, a display or speakers', () => {
    assert.equal(outputIcon(output(1, 'Pixel Buds', '', 'audio-headphones')), 'audio-headphones-symbolic');
    assert.equal(outputIcon(output(1, 'Headset', '', 'audio-headset')), 'audio-headphones-symbolic');
    assert.equal(outputIcon(output(1, 'Headphones', 'Built-in Audio')), 'audio-headphones-symbolic');
    assert.equal(outputIcon(output(1, 'HDMI / DisplayPort', 'Built-in Audio')), 'video-display-symbolic');
    assert.equal(outputIcon(output(1, 'LG TV', '', 'video-display')), 'video-display-symbolic');
    assert.equal(outputIcon(output(1, 'Speakers', 'Built-in Audio', 'audio-speakers')), 'audio-speakers-symbolic');
    assert.equal(outputIcon(null), 'audio-speakers-symbolic');
});

test('outputs are listed by name', () => {
    const list = sortedOutputs([output(3, 'Speakers'), output(1, 'HDMI'), output(2, 'headphones')]);
    assert.deepEqual(
        list.map((o) => o.id),
        [1, 2, 3],
    );
});

test('probing finds outputs past gaps in the ids, up to a margin after the last one', () => {
    const present = new Set([2, 5, 40, 90]);
    assert.deepEqual(probeOutputIds((id) => present.has(id), 0, 40), [2, 5, 40]);
    // Starting from the active output's id reaches further.
    assert.deepEqual(probeOutputIds((id) => present.has(id), 90, 40), [2, 5, 40, 90]);
});

test('outputs announced before Quick Settings lists them still count, once each', () => {
    assert.deepEqual(outputIds([3], [5, 3]), [3, 5]);
    assert.deepEqual(outputIds([], []), []);
});
