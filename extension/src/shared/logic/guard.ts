/**
 * Runs Nokta's part of a GNOME hook. When it throws, the error is reported
 * and GNOME's own behavior runs instead, so a Nokta bug never takes a
 * desktop feature (banners, the volume popup) down with it.
 */
export function orGnome<T>(nokta: () => T, gnome: () => T, report: (error: unknown) => void): T {
    try {
        return nokta();
    } catch (error) {
        report(error);
        return gnome();
    }
}
