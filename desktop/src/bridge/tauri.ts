import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

import { Listeners, type Bridge, type Props } from './bridge.js';

/** The app's events (desktop/src-tauri/src/win/services.rs). */
const PROPS_EVENT = 'nokta://props';
const SIGNAL_EVENT = 'nokta://signal';

interface PropsPayload {
    interface: string;
    props: Props;
}

interface SignalPayload {
    interface: string;
    signal: string;
    args: unknown[];
}

/** The bridge inside the Windows app: Tauri commands and events. */
export class TauriBridge implements Bridge {
    private readonly changed = new Listeners<[Props]>();
    private readonly signals = new Listeners<unknown[]>();

    constructor() {
        void listen<PropsPayload>(PROPS_EVENT, ({ payload }) => this.changed.emit(payload.interface, payload.props));
        void listen<SignalPayload>(SIGNAL_EVENT, ({ payload }) =>
            this.signals.emit(`${payload.interface}.${payload.signal}`, ...payload.args),
        );
    }

    props(iface: string): Promise<Props> {
        return invoke<Props>('bridge_props', { interface: iface });
    }

    onChanged(iface: string, cb: (changed: Props) => void): () => void {
        return this.changed.add(iface, cb);
    }

    call(iface: string, method: string, ...args: unknown[]): Promise<unknown> {
        return invoke('bridge_call', { interface: iface, method, args });
    }

    onSignal(iface: string, signal: string, cb: (...args: unknown[]) => void): () => void {
        return this.signals.add(`${iface}.${signal}`, cb);
    }
}
