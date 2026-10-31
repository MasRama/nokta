import { describe, expect, it } from 'vitest';

import { notchPath, notchWidth } from '../src/notch/path.js';

describe('notchPath', () => {
    it('draws the ears, the body and its rounded bottom corners', () => {
        expect(notchPath(200, 32, 10, 8)).toBe(
            'M0,0H216A8,8 0 0 0 208,8V22A10,10 0 0 1 198,32H18A10,10 0 0 1 8,22V8A8,8 0 0 0 0,0Z',
        );
    });

    it('draws square corners and no ears at zero', () => {
        expect(notchPath(100, 20, 0, 0)).toBe('M0,0H100A0,0 0 0 0 100,0V20A0,0 0 0 1 100,20H0A0,0 0 0 1 0,20V0A0,0 0 0 0 0,0Z');
    });

    it('never rounds the corners more than the body allows', () => {
        // A 20 px wide body rounds by 10 at most; a 12 px tall one by 12.
        expect(notchPath(20, 32, 50, 0)).toContain('A10,10');
        expect(notchPath(200, 12, 50, 0)).toContain('A12,12');
    });

    it('spans the body and both ears', () => {
        expect(notchWidth(200, 8)).toBe(216);
    });
});
