/** A level the device reported (a whole 0 to 100), else null: the alert then shows no battery. */
export function batteryLevel(percentage: number): number | null {
    return Number.isInteger(percentage) && percentage >= 0 && percentage <= 100 ? percentage : null;
}
