import { cpuLabel, memoryLabel, networkLabel, temperatureLabel, type Usage } from '@ext/features/system/logic/format.js';
import { History, HISTORY_LENGTH } from '@ext/features/system/logic/history.js';
import { withAlpha } from '@ext/shared/logic/color.js';
import { _ } from '@ext/shared/logic/i18n.js';
import { TONES, toneOn } from '@ext/shared/logic/tones.js';

const ROW_HEIGHT = 26;
const SPACING = 6;
/** The CPU line's bars, as `.nokta-system-spark` sets them. */
const SPARK_HEIGHT = 18;
/** A bar is at least this tall, so an idle CPU still draws a line. */
const SPARK_MIN = 1;

/** One row: its name on the left, what it shows on the right, and an optional drawing between. */
class SystemRow {
    readonly element: HTMLDivElement;
    readonly value: HTMLSpanElement;
    private readonly name: HTMLSpanElement;

    constructor(name: string, middle?: HTMLElement) {
        this.name = document.createElement('span');
        this.name.className = 'nokta-system-name';
        this.name.textContent = name;
        this.value = document.createElement('span');
        this.value.className = 'nokta-system-value';
        const between = middle ?? document.createElement('span');
        between.classList.add('nokta-system-middle');
        this.element = document.createElement('div');
        this.element.className = 'nokta-system-row';
        this.element.append(this.name, between, this.value);
    }

    setColors(foreground: string): void {
        this.name.style.color = withAlpha(foreground, 0.65);
        this.value.style.color = foreground;
    }
}

/**
 * The System tile's page: CPU with a line of its last minute, memory as a
 * bar, the CPU's temperature and the network's speed. It keeps the CPU
 * history while it is open. As the extension's system/page.ts.
 */
export class SystemPage {
    readonly element: HTMLDivElement;
    /** Four rows, 6 px apart. */
    static readonly HEIGHT = 4 * ROW_HEIGHT + 3 * SPACING;
    private readonly history = new History();
    private readonly bars: HTMLSpanElement[] = [];
    private readonly memoryTrack: HTMLDivElement;
    private readonly memoryFill: HTMLDivElement;
    private readonly cpu: SystemRow;
    private readonly memory: SystemRow;
    private readonly temperature: SystemRow;
    private readonly network: SystemRow;
    private readonly rows: SystemRow[];

    constructor() {
        const spark = document.createElement('div');
        spark.className = 'nokta-system-spark';
        for (let i = 0; i < HISTORY_LENGTH; i++) {
            const bar = document.createElement('span');
            bar.className = 'nokta-system-spark-bar';
            this.bars.push(bar);
            spark.append(bar);
        }
        this.memoryTrack = document.createElement('div');
        this.memoryTrack.className = 'nokta-system-track';
        // Scaled from the left edge, like the OSD bar.
        this.memoryFill = document.createElement('div');
        this.memoryFill.className = 'nokta-system-fill';
        this.memoryTrack.append(this.memoryFill);

        this.cpu = new SystemRow(_('CPU'), spark);
        this.memory = new SystemRow(_('Memory'), this.memoryTrack);
        this.temperature = new SystemRow(_('Temperature'));
        this.network = new SystemRow(_('Network'));
        this.rows = [this.cpu, this.memory, this.temperature, this.network];
        this.element = document.createElement('div');
        this.element.className = 'nokta-system-page';
        this.element.append(...this.rows.map((row) => row.element));
        this.show(null, false);
    }

    /** A new sample, or null before the first; the CPU line moves on with each. */
    show(usage: Usage | null, fahrenheit: boolean): void {
        if (usage) this.history.push(usage.cpu);
        const values = this.history.values();
        // Newest on the right; bars without a sample yet stay flat.
        this.bars.forEach((bar, i) => {
            const value = values[values.length - HISTORY_LENGTH + i];
            bar.style.height = `${Math.max(SPARK_MIN, Math.round((value ?? 0) * SPARK_HEIGHT))}px`;
        });
        const dash = '–';
        this.cpu.value.textContent = usage ? cpuLabel(usage.cpu) : dash;
        this.memory.value.textContent = usage ? memoryLabel(usage.memoryUsed, usage.memoryTotal) : dash;
        this.memoryFill.style.transform = `scaleX(${usage ? Math.min(1, usage.memoryUsed / usage.memoryTotal) : 0})`;
        this.temperature.value.textContent = usage ? temperatureLabel(usage.temperature, fahrenheit) : dash;
        this.network.value.textContent = usage ? networkLabel(usage.download, usage.upload) : dash;
    }

    /** The page opened again: a new line from now. */
    reset(): void {
        this.history.clear();
        this.show(null, false);
    }

    setColors({ foreground, light }: { foreground: string; light: boolean }): void {
        const tone = toneOn(TONES.system, light);
        for (const row of this.rows) row.setColors(foreground);
        for (const bar of this.bars) bar.style.backgroundColor = tone;
        this.memoryTrack.style.backgroundColor = withAlpha(foreground, 0.2);
        this.memoryFill.style.backgroundColor = tone;
    }
}
