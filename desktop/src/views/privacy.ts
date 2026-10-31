import { CALL_COLORS } from '@ext/features/privacy/logic/call.js';
import { DOT_COLORS, DOT_GAP, DOT_SIZE, dotsPlace, type Dot } from '@ext/features/privacy/logic/dots.js';
import { _ } from '@ext/shared/logic/i18n.js';
import { TONES } from '@ext/shared/logic/tones.js';

import { icon, setIcon } from '../icons.js';
import { IconChip } from './controls.js';

/** A row of dots at the closed notch's left edge, over the idle and collapsed views. */
export class PrivacyDots {
    readonly element: HTMLDivElement;
    private shown = '';

    constructor() {
        this.element = document.createElement('div');
        this.element.className = 'nokta-privacy-dots';
        this.element.hidden = true;
    }

    /**
     * `height` and `cornerRadius` are the closed notch's. Returns where
     * content beside the dots may start, 0 without dots.
     */
    update(dots: readonly Dot[], height: number, cornerRadius: number): number {
        const place = dotsPlace(height, cornerRadius, dots.length);
        const key = `${dots.join()}@${height}/${cornerRadius}`;
        if (key === this.shown) return place.contentLeft;
        this.shown = key;
        this.element.replaceChildren(
            ...dots.map((dot) => {
                const el = document.createElement('span');
                el.className = 'nokta-privacy-dot';
                el.style.background = DOT_COLORS[dot];
                return el;
            }),
        );
        const style = this.element.style;
        style.gap = `${DOT_GAP}px`;
        style.left = `${place.left}px`;
        style.top = `${place.top}px`;
        style.setProperty('--nokta-dot', `${DOT_SIZE}px`);
        return place.contentLeft;
    }

    setVisible(visible: boolean): void {
        this.element.hidden = !visible;
    }
}

/** The closed notch's call: a microphone, red while muted, and how long it has been on. */
export class CallLabel {
    readonly element: HTMLSpanElement;
    private readonly icon = icon('mic', 14);
    private readonly time: HTMLSpanElement;

    constructor() {
        this.element = document.createElement('span');
        this.element.className = 'nokta-call';
        this.time = document.createElement('span');
        this.time.className = 'nokta-call-time';
        this.element.append(this.icon, this.time);
    }

    update(text: string, muted: boolean): void {
        this.time.textContent = text;
        setIcon(this.icon, muted ? 'mic-off' : 'mic', 14);
        this.icon.style.color = muted ? CALL_COLORS.muted : CALL_COLORS.live;
    }
}

/** The call, as home's row shows it. */
export interface HomeCall {
    title: string;
    /** Like `Microphone · 12:03`. */
    detail: string;
    muted: boolean;
}

export interface CallHandlers {
    toggleCallMute(): void;
    hideCall(): void;
}

/**
 * The call: a microphone on a chip in the call's colour (red while muted),
 * the app, the time, and mute and hide buttons. The extension shows the
 * app's icon; Windows names only the app.
 */
export class CallRow {
    readonly element: HTMLDivElement;
    readonly chip = new IconChip();
    private readonly title: HTMLSpanElement;
    private readonly detail: HTMLSpanElement;
    private readonly mute: HTMLButtonElement;
    private readonly muteIcon = icon('mic', 14);

    constructor(handlers: CallHandlers) {
        this.title = document.createElement('span');
        this.title.className = 'nokta-panel-call-title';
        this.detail = document.createElement('span');
        this.detail.className = 'nokta-panel-call-detail';
        this.mute = document.createElement('button');
        this.mute.className = 'nokta-button';
        this.mute.append(this.muteIcon);
        this.mute.addEventListener('click', () => handlers.toggleCallMute());
        const hide = document.createElement('button');
        hide.className = 'nokta-button';
        hide.setAttribute('aria-label', _('Hide'));
        hide.append(icon('close', 14));
        hide.addEventListener('click', () => handlers.hideCall());
        this.element = document.createElement('div');
        this.element.className = 'nokta-panel-call';
        this.element.hidden = true;
        this.element.append(this.chip.element, this.title, this.detail, this.mute, hide);
    }

    show(call: HomeCall | null): void {
        this.element.hidden = call === null;
        if (!call) return;
        this.chip.show(call.muted ? 'mic-off' : 'mic', call.muted ? TONES.urgent : TONES.call);
        this.title.textContent = call.title;
        this.detail.textContent = call.detail;
        this.mute.setAttribute('aria-label', call.muted ? _('Unmute') : _('Mute'));
        this.mute.setAttribute('aria-pressed', String(call.muted));
        setIcon(this.muteIcon, call.muted ? 'mic-off' : 'mic', 14);
        this.muteIcon.style.color = call.muted ? TONES.urgent : '';
    }
}
