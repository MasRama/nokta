import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import { QuickMenuToggle, SystemIndicator } from 'resource:///org/gnome/shell/ui/quickSettings.js';

import type { TimerSettings } from '../settings/logic/parse.js';
import { nextBreak, toggleSubtitle, type TimerSnapshot } from './logic/timer.js';

const ICON = 'alarm-symbolic';

export interface TimerControls {
    start(phase: 'focus' | 'break'): void;
    pause(): void;
    resume(): void;
    stop(): void;
}

/**
 * The Focus toggle in Quick Settings: a click starts focus or stops the
 * timer; its menu starts a break, pauses, resumes and stops. GNOME Shell
 * destroys the toggle itself when it shuts down; from then on updates do
 * nothing.
 */
export class FocusToggle {
    private readonly indicator = new SystemIndicator();
    private readonly toggle: QuickMenuToggle;
    private readonly startFocus = new PopupMenu.PopupMenuItem('');
    private readonly startBreak = new PopupMenu.PopupMenuItem('');
    private readonly pause = new PopupMenu.PopupMenuItem('Pause');
    private readonly resume = new PopupMenu.PopupMenuItem('Resume');
    private readonly stop = new PopupMenu.PopupMenuItem('Stop');
    private idle = true;
    private destroyed = false;

    constructor(controls: TimerControls) {
        this.toggle = new QuickMenuToggle({ title: 'Focus', iconName: ICON, toggleMode: false });
        this.toggle.connect('clicked', () => (this.idle ? controls.start('focus') : controls.stop()));
        this.toggle.menu.setHeader(ICON, 'Focus timer');
        this.startFocus.connect('activate', () => controls.start('focus'));
        this.startBreak.connect('activate', () => controls.start('break'));
        this.pause.connect('activate', () => controls.pause());
        this.resume.connect('activate', () => controls.resume());
        this.stop.connect('activate', () => controls.stop());
        for (const item of [this.startFocus, this.startBreak, this.pause, this.resume, this.stop])
            this.toggle.menu.addMenuItem(item);
        this.toggle.connect('destroy', () => (this.destroyed = true));
        this.indicator.quickSettingsItems.push(this.toggle);
        Main.panel.statusArea.quickSettings.addExternalIndicator(this.indicator);
    }

    update(timer: TimerSnapshot, nowUs: number, settings: TimerSettings): void {
        if (this.destroyed) return;
        this.idle = timer.state === 'idle';
        this.toggle.checked = !this.idle;
        this.toggle.subtitle = toggleSubtitle(timer, nowUs, settings.focusMinutes);
        this.startFocus.label.text = `Start focus, ${settings.focusMinutes} min`;
        const next = nextBreak(timer, settings);
        this.startBreak.label.text = `Start ${next.long ? 'long break' : 'break'}, ${next.minutes} min`;
        this.startBreak.visible = next.minutes > 0;
        this.pause.visible = timer.state === 'running';
        this.resume.visible = timer.state === 'paused';
        this.stop.visible = !this.idle;
    }

    destroy(): void {
        if (!this.destroyed) this.toggle.destroy();
        this.indicator.quickSettingsItems = [];
        this.indicator.destroy();
    }
}
