import type { Restore } from './topbar.js';

/**
 * Sets `name` on the object itself, shadowing the class method. The undo
 * only removes Nokta's function: if something replaced it since, it is left
 * alone. `owner` names the object in the warning, like `osdWindowManager`.
 */
export function replaceMethod(target: object, owner: string, name: string, replacement: unknown): Restore {
    const methods = target as Record<string, unknown>;
    const hadOwn = Object.hasOwn(methods, name);
    const original = methods[name];
    methods[name] = replacement;
    return () => {
        if (methods[name] !== replacement) {
            console.warn(`Nokta: ${owner}.${name} was replaced by someone else, leaving it alone`);
        } else if (hadOwn) {
            methods[name] = original;
        } else {
            delete methods[name];
        }
    };
}
