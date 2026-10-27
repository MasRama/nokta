// Fixes for @girs/gnome-shell 46.0.2 typings.
//
// Its `ease()` augmentation of Clutter.Actor omits the class's type
// parameters and targets the package index rather than the module that
// declares the namespace, so TypeScript does not merge it.
import '@girs/clutter-14/clutter-14';

declare module '@girs/clutter-14/clutter-14' {
    export namespace Clutter {
        type EaseProperties = Partial<
            Pick<Actor, 'x' | 'y' | 'width' | 'height' | 'opacity' | 'scale_x' | 'scale_y' | 'translation_x' | 'translation_y'>
        >;

        interface EaseParams extends EaseProperties {
            duration?: number;
            delay?: number;
            mode?: AnimationMode;
            onComplete?: () => void;
            onStopped?: (finished: boolean) => void;
            repeatCount?: number;
            autoReverse?: boolean;
        }

        // Merging requires the class's exact type parameters, used or not.
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        interface Actor<A extends LayoutManager = LayoutManager, B extends Content = Content> {
            /** GNOME Shell's wrapper around implicit transitions (ui/environment.js). */
            ease(params: EaseParams): void;
        }
    }
}
