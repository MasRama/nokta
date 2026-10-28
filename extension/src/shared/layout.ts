import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';

/** Where a child of `size` goes in `space`; FILL takes all of it. */
function place(align: Clutter.ActorAlign, space: number, size: number): [number, number] {
    switch (align) {
        case Clutter.ActorAlign.FILL:
            return [0, space];
        case Clutter.ActorAlign.START:
            return [0, size];
        case Clutter.ActorAlign.END:
            return [space - size, size];
        default:
            return [Math.round((space - size) / 2), size];
    }
}

/**
 * Like a BinLayout, but each child keeps its own size even when the parent
 * is smaller, and the children never make the parent bigger. The notch's
 * body uses it, so the body follows the animated size alone and a view
 * larger than it is clipped instead of reflowed.
 */
export const OverlayLayout = GObject.registerClass(
    { GTypeName: 'NoktaOverlayLayout' },
    class OverlayLayout extends Clutter.LayoutManager {
        override vfunc_get_preferred_width(): [number, number] {
            return [0, 0];
        }

        override vfunc_get_preferred_height(): [number, number] {
            return [0, 0];
        }

        override vfunc_allocate(container: Clutter.Actor, box: Clutter.ActorBox): void {
            const width = box.get_width();
            const height = box.get_height();
            for (const child of container.get_children()) {
                if (!child.visible) continue;
                const [, , naturalWidth, naturalHeight] = child.get_preferred_size();
                const [x, w] = place(child.x_align, width, naturalWidth);
                const [y, h] = place(child.y_align, height, naturalHeight);
                child.allocate(new Clutter.ActorBox({ x1: x, y1: y, x2: x + w, y2: y + h }));
            }
        }
    },
);
