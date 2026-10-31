import { fractionOf, positionAt } from '@ext/features/media/logic/progress.js';
import { formatDuration } from '@ext/shared/logic/format.js';

/**
 * Elapsed time, a bar and the total time. Click or drag the bar to seek;
 * while dragging the bar follows the pointer and the seek is sent on release.
 */
export class ProgressBar {
    readonly element: HTMLDivElement;
    private readonly elapsed: HTMLSpanElement;
    private readonly total: HTMLSpanElement;
    private readonly hit: HTMLDivElement;
    private readonly track: HTMLDivElement;
    private readonly fill: HTMLDivElement;
    private lengthUs = 0;
    private positionUs = 0;
    private seekable = false;
    private dragUs: number | null = null;

    constructor(private readonly onSeek: (us: number) => void) {
        this.element = document.createElement('div');
        this.element.className = 'nokta-progress';
        this.elapsed = document.createElement('span');
        this.total = document.createElement('span');
        for (const time of [this.elapsed, this.total]) time.className = 'nokta-time';
        // A taller hit area around the thin bar.
        this.hit = document.createElement('div');
        this.hit.className = 'nokta-progress-hit';
        this.track = document.createElement('div');
        this.track.className = 'nokta-progress-track';
        this.fill = document.createElement('div');
        this.fill.className = 'nokta-progress-fill';
        this.track.append(this.fill);
        this.hit.append(this.track);
        this.element.append(this.elapsed, this.hit, this.total);

        this.hit.addEventListener('pointerdown', (e) => {
            if (!this.seekable || e.button !== 0) return;
            this.hit.setPointerCapture(e.pointerId);
            this.drag(e);
        });
        this.hit.addEventListener('pointermove', (e) => {
            if (this.dragUs !== null) this.drag(e);
        });
        this.hit.addEventListener('pointerup', (e) => {
            if (this.dragUs === null) return;
            this.drag(e);
            const us = this.dragUs;
            this.dragUs = null;
            this.positionUs = us;
            this.redraw();
            this.onSeek(us);
        });
        this.hit.addEventListener('lostpointercapture', () => {
            if (this.dragUs === null) return;
            this.dragUs = null;
            this.redraw();
        });
    }

    setColors(accent: string, trackColor: string): void {
        this.fill.style.backgroundColor = accent;
        this.track.style.backgroundColor = trackColor;
    }

    /** Hidden when the length is unknown. */
    update(positionUs: number, lengthUs: number, seekable: boolean): void {
        this.lengthUs = lengthUs;
        this.positionUs = positionUs;
        this.seekable = seekable && lengthUs > 0;
        this.element.hidden = lengthUs <= 0;
        this.hit.classList.toggle('nokta-seekable', this.seekable);
        if (this.dragUs === null) this.redraw();
    }

    private drag(e: PointerEvent): void {
        const box = this.track.getBoundingClientRect();
        this.dragUs = positionAt(e.clientX - box.left, box.width, this.lengthUs);
        this.redraw();
    }

    private redraw(): void {
        const shown = this.dragUs ?? this.positionUs;
        this.fill.style.width = `${fractionOf(shown, this.lengthUs) * 100}%`;
        this.elapsed.textContent = formatDuration(shown);
        this.total.textContent = formatDuration(this.lengthUs);
    }
}
