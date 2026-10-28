/** A shortcut setting as a GSettings key list; empty for none. */
export function shortcutKeys(setting: string): string[] {
    const keys = setting.trim();
    return keys ? [keys] : [];
}
