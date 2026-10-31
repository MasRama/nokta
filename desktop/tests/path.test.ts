import { describe, expect, it } from 'vitest';

import { bodyPath, gradientEnd, notchPath, notchWidth } from '../src/notch/path.js';

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

    it('starts at the left ear given', () => {
        expect(notchPath(200, 32, 10, 8, 100)).toBe(
            'M100,0H316A8,8 0 0 0 308,8V22A10,10 0 0 1 298,32H118A10,10 0 0 1 108,22V8A8,8 0 0 0 100,0Z',
        );
    });

    it('keeps two decimals of a size mid-spring', () => {
        expect(notchPath(200.123456, 32.5, 10, 0)).toContain('H200.12');
        expect(notchPath(200.123456, 32.5, 10, 0)).not.toContain('200.123');
        expect(notchPath(200.123456, 32.5, 10, 0)).toContain('V22.5');
    });

    it('spans the body and both ears', () => {
        expect(notchWidth(200, 8)).toBe(216);
    });
});

describe('bodyPath', () => {
    it('draws the body alone, grown on every side, its top off the window', () => {
        expect(bodyPath(10, 100, 40, 10, 4)).toBe('M6,-14H114V30A14,14 0 0 1 100,44H20A14,14 0 0 1 6,30Z');
    });

    it('never rounds more than half the width', () => {
        expect(bodyPath(0, 20, 40, 50, 0)).toContain('A10,10');
    });
});

describe('gradientEnd', () => {
    it('ends where the shader puts t = 1 on a unit body', () => {
        expect(gradientEnd([0, 1])).toEqual([0, 1]);
        expect(gradientEnd([1, 0])).toEqual([1, 0]);
        const [x, y] = gradientEnd([Math.SQRT1_2, Math.SQRT1_2]);
        expect(x).toBeCloseTo(1);
        expect(y).toBeCloseTo(1);
    });
});
