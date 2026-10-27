import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseHexColor, withAlpha } from '../src/shared/logic/color.js';

test('parse_hex_color_channels', () => {
    assert.deepEqual(parseHexColor('#000000'), { r: 0, g: 0, b: 0 });
    assert.deepEqual(parseHexColor('#FF0033'), { r: 1, g: 0, b: 0.2 });
});

test('parse_hex_color_invalid_uses_fallback', () => {
    const fallback = { r: 0.5, g: 0.5, b: 0.5 };
    assert.deepEqual(parseHexColor('red', fallback), fallback);
    assert.deepEqual(parseHexColor('#fff', fallback), fallback);
    assert.deepEqual(parseHexColor('#0000000'), { r: 0, g: 0, b: 0 });
});

test('with_alpha_makes_rgba', () => {
    assert.equal(withAlpha('#ff8000', 0.25), 'rgba(255, 128, 0, 0.25)');
    assert.equal(withAlpha('bad', 0.5), 'rgba(0, 0, 0, 0.5)');
});

test('alpha_is_clamped_and_rounded', () => {
    assert.equal(withAlpha('#000000', 1.4), 'rgba(0, 0, 0, 1)');
    assert.equal(withAlpha('#000000', -1), 'rgba(0, 0, 0, 0)');
    assert.equal(withAlpha('#000000', 0.333333), 'rgba(0, 0, 0, 0.333)');
    assert.equal(withAlpha('#000000', Number.NaN), 'rgba(0, 0, 0, 1)');
});
