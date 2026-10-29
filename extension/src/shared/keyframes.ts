import Clutter from 'gi://Clutter';

import type { Step } from './logic/keyframes.js';

/** The actor properties a motion moves; `scale` moves both axes. */
type Property = 'translation_x' | 'rotation_angle_z' | 'scale';

/**
 * Eases `actor` through `steps`, one after the other. Removing the
 * property's transition stops the chain, as the next step only follows a
 * step that finished.
 */
export function playSteps(actor: Clutter.Actor, property: Property, steps: readonly Step[]): void {
    const [step, ...rest] = steps;
    if (!step) return;
    // Hyphens: ease() finds its transition by replacing only the first
    // underscore, so `rotation_angle_z` would end every step at once.
    const target =
        property === 'scale'
            ? { 'scale-x': step.value, 'scale-y': step.value }
            : { [property.replace(/_/g, '-')]: step.value };
    actor.ease({
        ...target,
        duration: step.ms,
        mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        onStopped: (finished: boolean) => {
            if (finished) playSteps(actor, property, rest);
        },
    });
}
