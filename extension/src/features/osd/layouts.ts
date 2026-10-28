import * as Keyboard from 'resource:///org/gnome/shell/ui/status/keyboard.js';

import { inputSourceShown } from './logic/content.js';

/** The parts of ui/status/keyboard.js InputSource used here. */
interface InputSource {
    id: string;
    displayName: string;
}

/** The parts of ui/status/keyboard.js InputSourceManager used here. */
interface InputSourceManager {
    currentSource: InputSource | null;
    inputSources: Record<string, InputSource>;
    connect(signal: 'current-source-changed', callback: (manager: unknown, old: InputSource | null) => void): number;
    disconnect(id: number): void;
}

/** Calls `onChange` with the new layout's name when the user switches keyboard layouts. */
export class InputSourceWatcher {
    private readonly manager: InputSourceManager | null;
    private readonly changedId: number = 0;

    constructor(onChange: (name: string) => void) {
        const get = (Keyboard as unknown as { getInputSourceManager?: () => InputSourceManager })
            .getInputSourceManager;
        this.manager = get?.() ?? null;
        if (!this.manager) return;
        const manager = this.manager;
        this.changedId = manager.connect('current-source-changed', (_manager, old) => {
            const current = manager.currentSource;
            const change = {
                previous: old?.id ?? null,
                current: current?.id ?? null,
                sources: Object.keys(manager.inputSources).length,
            };
            if (current && inputSourceShown(change)) onChange(current.displayName);
        });
    }

    destroy(): void {
        if (this.changedId) this.manager?.disconnect(this.changedId);
    }
}
