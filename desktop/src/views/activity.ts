import { activityIcon, formatElapsed, progressLabel, type Activity } from '@ext/features/activities/logic/activities.js';
import { withAlpha } from '@ext/shared/logic/color.js';
import { _, format } from '@ext/shared/logic/i18n.js';
import { TONES } from '@ext/shared/logic/tones.js';

import { icon, setIcon } from '../icons.js';
import { IconChip } from './controls.js';

/**
 * The newest activity in the closed notch: its icon and the percentage, or
 * a slowly pulsing icon while the progress is unknown.
 */
export class ActivityBadge {
    readonly element: HTMLSpanElement;
    private readonly glyph = icon('', 14);
    private readonly label: HTMLSpanElement;

    constructor() {
        this.element = document.createElement('span');
        this.element.className = 'nokta-activity-badge';
        this.label = document.createElement('span');
        this.label.className = 'nokta-activity-badge-label';
        this.element.append(this.glyph, this.label);
    }

    update(activity: Activity): void {
        setIcon(this.glyph, activityIcon(activity.icon), 14);
        const label = progressLabel(activity.progress);
        this.label.textContent = label ?? '';
        this.label.hidden = label === null;
        this.glyph.classList.toggle('nokta-pulse', label === null);
    }
}

/** One live activity: icon chip in the accent, title, detail and elapsed time, and a thin bar. */
export class ActivityRow {
    readonly element: HTMLDivElement;
    readonly chip = new IconChip();
    private readonly title: HTMLSpanElement;
    private readonly detail: HTMLSpanElement;
    private readonly elapsed: HTMLSpanElement;
    private readonly track: HTMLDivElement;
    private readonly fill: HTMLDivElement;
    private accent = '#ffffff';

    constructor() {
        const span = (className: string): HTMLSpanElement => {
            const element = document.createElement('span');
            element.className = className;
            return element;
        };
        this.title = span('nokta-panel-activity-title');
        this.detail = span('nokta-panel-activity-detail');
        this.elapsed = span('nokta-panel-activity-elapsed');
        const second = document.createElement('div');
        second.className = 'nokta-panel-activity-line';
        second.append(this.detail, this.elapsed);
        this.fill = document.createElement('div');
        this.fill.className = 'nokta-panel-activity-fill';
        this.track = document.createElement('div');
        this.track.className = 'nokta-panel-activity-track';
        this.track.append(this.fill);
        const text = document.createElement('div');
        text.className = 'nokta-panel-activity-text';
        text.append(this.title, second, this.track);
        this.element = document.createElement('div');
        this.element.className = 'nokta-panel-activity';
        this.element.hidden = true;
        this.element.append(this.chip.element, text);
    }

    /** `nowUs` on the wall clock, as the activity's start. */
    show(activity: Activity | undefined, nowUs: number): void {
        this.element.hidden = activity === undefined;
        if (!activity) return;
        this.chip.show(activityIcon(activity.icon), this.accent);
        this.title.textContent = activity.title;
        this.detail.textContent = activity.detail;
        this.elapsed.textContent = formatElapsed(nowUs - activity.startedUs);
        const known = activity.progress >= 0;
        this.track.style.visibility = known ? '' : 'hidden';
        this.fill.style.transform = `scaleX(${known ? Math.min(activity.progress, 1) : 0})`;
    }

    setColors({ foreground, accent, light }: { foreground: string; accent: string; light: boolean }): void {
        this.accent = accent;
        this.chip.setLight(light);
        this.track.style.backgroundColor = withAlpha(foreground, 0.2);
        this.fill.style.backgroundColor = foreground;
    }
}

/**
 * A newer Nokta: its chip and the text, which opens the release's page.
 * Installing it from here comes with the Windows update install.
 */
export class UpdateRow {
    readonly element: HTMLButtonElement;
    readonly chip = new IconChip();
    private readonly title: HTMLSpanElement;

    constructor(openRelease: () => void) {
        this.chip.show('software-update-available-symbolic', TONES.update);
        this.title = document.createElement('span');
        this.title.className = 'nokta-panel-update-title';
        this.element = document.createElement('button');
        this.element.className = 'nokta-panel-update';
        this.element.hidden = true;
        this.element.append(this.chip.element, this.title);
        this.element.addEventListener('click', () => openRelease());
    }

    /** `latest` is the newer version; empty hides the row. */
    show(latest: string): void {
        this.element.hidden = latest === '';
        this.title.textContent = latest ? format(_('Nokta %s is available'), latest) : '';
    }
}
