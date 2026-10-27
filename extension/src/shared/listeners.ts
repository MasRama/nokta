/** A minimal callback list for clients that have no GObject signals. */
export class Listeners {
    private readonly callbacks = new Map<number, () => void>();
    private nextId = 1;

    add(callback: () => void): number {
        const id = this.nextId++;
        this.callbacks.set(id, callback);
        return id;
    }

    remove(id: number): void {
        this.callbacks.delete(id);
    }

    emit(): void {
        for (const callback of [...this.callbacks.values()]) callback();
    }

    clear(): void {
        this.callbacks.clear();
    }
}
