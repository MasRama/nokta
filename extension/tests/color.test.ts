import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseHexColor } from '../src/shared/logic/color.js';

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
