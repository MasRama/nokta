/**
 * What the helper window tells the shell, one line each on its standard
 * output: the pointer entering and leaving it, the slot under the pointer,
 * and its own drags starting and ending.
 */

import type { Hit } from './layout.js';

export type HelperEvent =
    | { kind: 'enter' }
    | { kind: 'leave' }
    | { kind: 'hover'; hit: Hit | null }
    | { kind: 'drag'; active: boolean };

export function helperLine(event: HelperEvent): string {
    switch (event.kind) {
        case 'enter':
        case 'leave':
            return event.kind;
        case 'drag':
            return `drag ${event.active ? 'begin' : 'end'}`;
        case 'hover': {
            const { hit } = event;
            if (!hit) return 'hover none';
            return `hover ${hit.kind} ${hit.index} ${hit.close ? 'close' : 'open'}`;
        }
    }
}

/** The event on one line, or null for anything else the helper prints. */
export function parseHelperLine(line: string): HelperEvent | null {
    const words = line.trim().split(' ');
    switch (words[0]) {
        case 'enter':
        case 'leave':
            return words.length === 1 ? { kind: words[0] } : null;
        case 'drag':
            if (words.length !== 2 || (words[1] !== 'begin' && words[1] !== 'end')) return null;
            return { kind: 'drag', active: words[1] === 'begin' };
        case 'hover': {
            if (words.length === 2 && words[1] === 'none') return { kind: 'hover', hit: null };
            const [, kind, index, close] = words;
            if (words.length !== 4 || (kind !== 'stack' && kind !== 'item')) return null;
            if (close !== 'close' && close !== 'open') return null;
            if (!/^-?\d+$/.test(index)) return null;
            return { kind: 'hover', hit: { kind, index: Number(index), close: close === 'close' } };
        }
        default:
            return null;
    }
}
