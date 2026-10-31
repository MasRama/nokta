import type { PrivacyState } from '@ext/features/privacy/logic/dots.js';

import type { Bridge } from './bridge/bridge.js';
import { Follower } from './follower.js';

/** The microphone on: by which app, since when (wall clock, µs), and its mute. */
export interface Microphone {
    app: string;
    sinceUs: number;
    muted: boolean;
}

/**
 * Privacy1: the camera and the microphone in use, from Windows' privacy
 * settings, as the extension reads them from GNOME's indicators. The
 * user can hide the call until the microphone goes off.
 */
export class Privacy extends Follower {
    state: PrivacyState = { camera: false, microphone: false, screen: false };
    microphone: Microphone | null = null;
    private hidden = false;

    constructor(bridge: Bridge, onChanged: () => void) {
        super(bridge, 'Privacy1', onChanged);
    }

    /** The microphone's call, unless hidden. */
    currentCall(): Microphone | null {
        return this.hidden ? null : this.microphone;
    }

    /** Until the microphone goes off. */
    hideCall(): void {
        this.hidden = this.microphone !== null;
    }

    toggleMute(): void {
        this.call('ToggleMute');
    }

    protected override read(): void {
        const { Camera, Microphone, MicrophoneApp, MicrophoneSinceUs, MicrophoneMuted } = this.props;
        const on = Microphone === true;
        // Windows has no signal for a shared screen.
        this.state = { camera: Camera === true, microphone: on, screen: false };
        if (!on) this.hidden = false;
        this.microphone = on
            ? {
                  app: typeof MicrophoneApp === 'string' ? MicrophoneApp : '',
                  sinceUs: typeof MicrophoneSinceUs === 'number' ? MicrophoneSinceUs : 0,
                  muted: MicrophoneMuted === true,
              }
            : null;
    }
}
