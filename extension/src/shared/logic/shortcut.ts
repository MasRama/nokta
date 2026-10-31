/** A shortcut setting as a GSettings key list; empty for none. */
export function shortcutKeys(setting: string): string[] {
    const keys = setting.trim();
    return keys ? [keys] : [];
}

/** GTK's modifier names as people read them. */
const MODIFIERS: Record<string, string> = { primary: 'Ctrl', control: 'Ctrl', ctrl: 'Ctrl', shift: 'Shift', alt: 'Alt' };

/** A shortcut setting as people read it, like `Super+Alt+N` (`Win+Alt+N` with `superName` 'Win'); empty for none. */
export function shortcutLabel(setting: string, superName = 'Super'): string {
    const keys = setting.trim();
    if (!keys) return '';
    const parts: string[] = [];
    const key = keys.replace(/<([^>]+)>/g, (_match, name: string) => {
        const lower = name.toLowerCase();
        parts.push(lower === 'super' ? superName : (MODIFIERS[lower] ?? name));
        return '';
    });
    parts.push(key.length === 1 ? key.toUpperCase() : key.charAt(0).toUpperCase() + key.slice(1));
    return parts.join('+');
}
