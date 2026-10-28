/**
 * A list setting like home.tiles in the settings window: every name it may
 * take, with a switch, and up and down buttons for the chosen ones.
 */

export interface OrderOption {
    value: string;
    label: string;
}

export interface OrderItem extends OrderOption {
    on: boolean;
    canUp: boolean;
    canDown: boolean;
    /** Off while the list is full and this one is not in it. */
    canSwitch: boolean;
}

/** The chosen names first, in their order, then the others in `options` order. */
export function orderItems(chosen: readonly string[], options: readonly OrderOption[], max: number): OrderItem[] {
    const picked = chosen
        .map((value) => options.find((option) => option.value === value))
        .filter((option): option is OrderOption => option !== undefined);
    const rest = options.filter((option) => !picked.includes(option));
    const full = picked.length >= max;
    return [
        ...picked.map((option, i) => ({
            ...option,
            on: true,
            canUp: i > 0,
            canDown: i < picked.length - 1,
            canSwitch: true,
        })),
        ...rest.map((option) => ({ ...option, on: false, canUp: false, canDown: false, canSwitch: !full })),
    ];
}

/** `chosen` with `value` added at the end or removed; a full list stays as it is. */
export function switchItem(chosen: readonly string[], value: string, on: boolean, max: number): string[] {
    if (!on) return chosen.filter((name) => name !== value);
    if (chosen.includes(value) || chosen.length >= max) return [...chosen];
    return [...chosen, value];
}

/** `chosen` with `value` swapped with its neighbour `by` away. */
export function moveItem(chosen: readonly string[], value: string, by: -1 | 1): string[] {
    const list = [...chosen];
    const i = list.indexOf(value);
    const j = i + by;
    if (i < 0 || j < 0 || j >= list.length) return list;
    [list[i], list[j]] = [list[j], list[i]];
    return list;
}
