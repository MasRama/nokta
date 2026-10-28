import type Clutter from 'gi://Clutter';

/**
 * Lets the pointer reach the helper window under some shell actors: while
 * on, they and everything in them stop being reactive. restore() puts back
 * what each one was.
 */
export class PassThrough {
    private readonly saved = new Map<Clutter.Actor, { reactive: boolean; destroyId: number }>();

    get active(): boolean {
        return this.saved.size > 0;
    }

    set(roots: readonly Clutter.Actor[]): void {
        this.restore();
        const walk = (actor: Clutter.Actor): void => {
            if (!this.saved.has(actor)) {
                const destroyId = actor.connect('destroy', () => this.saved.delete(actor));
                this.saved.set(actor, { reactive: actor.reactive, destroyId });
                actor.reactive = false;
            }
            for (const child of actor.get_children()) walk(child);
        };
        for (const root of roots) walk(root);
    }

    restore(): void {
        for (const [actor, { reactive, destroyId }] of this.saved) {
            actor.disconnect(destroyId);
            actor.reactive = reactive;
        }
        this.saved.clear();
    }
}
