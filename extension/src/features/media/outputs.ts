import Gvc from 'gi://Gvc';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Volume from 'resource:///org/gnome/shell/ui/status/volume.js';

import { Listeners } from '../../shared/listeners.js';
import { outputIds, probeOutputIds, sortedOutputs, type AudioOutput } from './logic/outputs.js';

/** How far past the last output id found the fallback search looks. */
const PROBE_MARGIN = 64;

/** The parts of Quick Settings' output slider used here; GNOME 46 to 51 have them. */
interface OutputSlider {
    _deviceItems?: Map<number, unknown>;
}

/** The output ids Quick Settings' sound menu lists, or null when it is not where it was. */
function quickSettingsIds(): number[] | null {
    const quickSettings = (Main.panel.statusArea as unknown as Record<string, unknown>).quickSettings as
        | { _volumeOutput?: { _output?: OutputSlider } }
        | undefined;
    const items = quickSettings?._volumeOutput?._output?._deviceItems;
    return items instanceof Map ? [...items.keys()] : null;
}

/**
 * The sound outputs GNOME's mixer knows and the one in use, with a way to
 * switch, like Quick Settings' sound menu. GNOME's mixer only announces
 * outputs as they come, so the ones already there are read from Quick
 * Settings' own list (or looked up by id when that is not there).
 */
export class AudioOutputs {
    private readonly control: Gvc.MixerControl;
    private readonly ids: number[] = [];
    private outputs: AudioOutput[] = [];
    private active: number | null = null;
    /** Outputs Gvc announced; Quick Settings may not list them yet. */
    private readonly announced = new Set<number>();
    private readonly listeners = new Listeners();

    constructor() {
        this.control = Volume.getMixerControl();
        this.ids.push(
            this.control.connect('output-added', (_control, id: number) => {
                this.announced.add(id);
                this.read();
            }),
            this.control.connect('output-removed', (_control, id: number) => {
                this.announced.delete(id);
                this.read();
            }),
            this.control.connect('active-output-update', (_control, id: number) => {
                this.active = id;
                this.listeners.emit();
            }),
            this.control.connect('state-changed', () => this.read()),
        );
        this.read();
    }

    /** By name; empty until GNOME's mixer is ready. */
    list(): readonly AudioOutput[] {
        return this.outputs;
    }

    activeId(): number | null {
        return this.active;
    }

    select(id: number): void {
        const device = this.control.lookup_output_id(id);
        if (device) this.control.change_output(device);
    }

    onChanged(callback: () => void): number {
        return this.listeners.add(callback);
    }

    disconnect(id: number): void {
        this.listeners.remove(id);
    }

    /** GNOME owns the mixer; only the signals go. */
    destroy(): void {
        for (const id of this.ids) this.control.disconnect(id);
        this.ids.length = 0;
        this.listeners.clear();
    }

    private read(): void {
        const ready = this.control.get_state() === Gvc.MixerControlState.READY;
        const sink = ready ? this.control.get_default_sink() : null;
        this.active = sink ? (this.control.lookup_device_from_stream(sink)?.get_id() ?? null) : null;
        const listed = ready
            ? (quickSettingsIds() ??
              probeOutputIds((id) => this.control.lookup_output_id(id) !== null, this.active ?? 0, PROBE_MARGIN))
            : [];
        const ids = ready ? outputIds(listed, this.announced) : [];
        const outputs: AudioOutput[] = [];
        for (const id of ids) {
            const device = this.control.lookup_output_id(id);
            if (!device) continue;
            outputs.push({
                id,
                description: device.get_description() ?? '',
                origin: device.get_origin() ?? '',
                iconName: device.get_icon_name() ?? '',
            });
        }
        this.outputs = sortedOutputs(outputs);
        this.listeners.emit();
    }
}
