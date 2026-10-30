import Clutter from 'gi://Clutter';
import St from 'gi://St';

import { setVertical } from '../../shared/compat.js';
import { withAlpha } from '../../shared/logic/color.js';
import { _ } from '../../shared/logic/i18n.js';
import { TONES, toneOn } from '../../shared/logic/tones.js';
import { cpuLabel, memoryLabel, networkLabel, temperatureLabel, type Usage } from './logic/format.js';
import { History, HISTORY_LENGTH } from './logic/history.js';

const ROW_HEIGHT = 26;
const SPACING = 6;
/** The CPU line's bars, as `.nokta-system-spark` sets them. */
const SPARK_HEIGHT = 18;
const SPARK_BAR = 3;
const SPARK_GAP = 1;
/** A bar is at least this tall, so an idle CPU still draws a line. */
const SPARK_MIN = 1;

/** One row: its name on the left, what it shows on the right, and an optional drawing between. */
class SystemRow {
    readonly actor: St.BoxLayout;
    readonly value: St.Label;
    private readonly name: St.Label;

    constructor(name: string, middle?: St.Widget) {
        this.name = new St.Label({ style_class: 'nokta-system-name', text: name, y_align: Clutter.ActorAlign.CENTER });
        this.value = new St.Label({ style_class: 'nokta-system-value', y_align: Clutter.ActorAlign.CENTER });
        this.actor = new St.BoxLayout({ style_class: 'nokta-system-row', height: ROW_HEIGHT, x_expand: true });
        this.actor.add_child(this.name);
        this.actor.add_child(middle ?? new St.Widget({ x_expand: true }));
        this.actor.add_child(this.value);
    }

    setColors(foreground: string): void {
        this.name.style = `color: ${withAlpha(foreground, 0.65)};`;
        this.value.style = `color: ${foreground};`;
    }
}

/**
 * The System tile's page: CPU with a line of its last minute, memory as a
 * bar, the CPU's temperature and the network's speed. It shows what
 * `SystemClient` publishes and keeps the CPU history while it is open.
 */
export class SystemPage {
    readonly actor: St.BoxLayout;
    readonly height = 4 * ROW_HEIGHT + 3 * SPACING;
    private readonly history = new History();
    private readonly bars: St.Widget[] = [];
    private readonly memoryTrack: St.Widget;
    private readonly memoryFill: St.Widget;
    private readonly cpu: SystemRow;
    private readonly memory: SystemRow;
    private readonly temperature: SystemRow;
    private readonly network: SystemRow;
    private readonly rows: SystemRow[];
    private tone: string = TONES.system;

    constructor() {
        const spark = new St.BoxLayout({
            style_class: 'nokta-system-spark',
            height: SPARK_HEIGHT,
            x_expand: true,
            x_align: Clutter.ActorAlign.END,
            y_align: Clutter.ActorAlign.CENTER,
        });
        for (let i = 0; i < HISTORY_LENGTH; i++) {
            const bar = new St.Widget({
                style_class: 'nokta-system-spark-bar',
                width: SPARK_BAR,
                height: SPARK_MIN,
                y_align: Clutter.ActorAlign.END,
            });
            this.bars.push(bar);
            spark.add_child(bar);
        }
        spark.style = `spacing: ${SPARK_GAP}px;`;

        this.memoryTrack = new St.Widget({
            style_class: 'nokta-system-track',
            layout_manager: new Clutter.BinLayout(),
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        // Scaled from the left edge, like the OSD bar.
        this.memoryFill = new St.Widget({ style_class: 'nokta-system-fill', x_expand: true, y_expand: true });
        this.memoryFill.set_pivot_point(0, 0.5);
        this.memoryFill.scale_x = 0;
        this.memoryTrack.add_child(this.memoryFill);

        this.cpu = new SystemRow(_('CPU'), spark);
        this.memory = new SystemRow(_('Memory'), this.memoryTrack);
        this.temperature = new SystemRow(_('Temperature'));
        this.network = new SystemRow(_('Network'));
        this.rows = [this.cpu, this.memory, this.temperature, this.network];
        this.actor = setVertical(new St.BoxLayout({ style_class: 'nokta-system-page', x_expand: true }));
        this.actor.style = `spacing: ${SPACING}px;`;
        for (const row of this.rows) this.actor.add_child(row.actor);
        this.show(null, false);
    }

    /** A new sample, or null before the first; the CPU line moves on with each. */
    show(usage: Usage | null, fahrenheit: boolean): void {
        if (usage) this.history.push(usage.cpu);
        const values = this.history.values();
        // Newest on the right; bars without a sample yet stay flat.
        this.bars.forEach((bar, i) => {
            const value = values[values.length - HISTORY_LENGTH + i];
            bar.height = Math.max(SPARK_MIN, Math.round((value ?? 0) * SPARK_HEIGHT));
        });
        const dash = '–';
        this.cpu.value.text = usage ? cpuLabel(usage.cpu) : dash;
        this.memory.value.text = usage ? memoryLabel(usage.memoryUsed, usage.memoryTotal) : dash;
        this.memoryFill.scale_x = usage ? Math.min(1, usage.memoryUsed / usage.memoryTotal) : 0;
        this.temperature.value.text = usage ? temperatureLabel(usage.temperature, fahrenheit) : dash;
        this.network.value.text = usage ? networkLabel(usage.download, usage.upload) : dash;
    }

    /** The page opened again: a new line from now. */
    reset(): void {
        this.history.clear();
        this.show(null, false);
    }

    setColors({ foreground, light }: { foreground: string; light: boolean }): void {
        this.tone = toneOn(TONES.system, light);
        for (const row of this.rows) row.setColors(foreground);
        for (const bar of this.bars) bar.style = `background-color: ${this.tone};`;
        this.memoryTrack.style = `background-color: ${withAlpha(foreground, 0.2)};`;
        this.memoryFill.style = `background-color: ${this.tone};`;
    }

    destroy(): void {
        this.actor.destroy();
    }
}
