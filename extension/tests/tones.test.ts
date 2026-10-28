import assert from 'node:assert/strict';
import { test } from 'node:test';

import { luminance } from '../src/shared/logic/color.js';
import { onTone, TONES, toneOn } from '../src/shared/logic/tones.js';

test('each kind of thing keeps its own color', () => {
    assert.equal(TONES.focus, '#ff7b63');
    assert.equal(TONES.break, '#57e389');
    assert.equal(TONES.countdown, '#ffb340');
    assert.equal(TONES.stopwatch, '#5ac8fa');
    assert.equal(TONES.alarm, '#bf9cff');
    assert.equal(TONES.do_not_disturb, '#7d7aff');
    assert.equal(TONES.clipboard, '#40c8e0');
    assert.equal(TONES.urgent, '#ff453a');
    assert.equal(TONES.success, '#30d158');
});

test('on a dark notch a tone is drawn as it is', () => {
    assert.equal(toneOn(TONES.countdown, false), TONES.countdown);
});

test('on a light notch a tone used for an icon is darkened until it reads', () => {
    for (const tone of Object.values(TONES)) assert.ok(luminance(toneOn(tone, true)) <= 0.25, `${tone}`);
    // A tone that is dark enough already stays.
    assert.equal(toneOn('#3a3aa0', true), '#3a3aa0');
});

test('a fill in a light tone takes black on it, a darker one white', () => {
    assert.equal(onTone(TONES.countdown), '#000000');
    assert.equal(onTone(TONES.do_not_disturb), '#ffffff');
    assert.equal(onTone(TONES.urgent), '#ffffff');
});
