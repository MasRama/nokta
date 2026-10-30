/**
 * Translations. The shell and the settings window hand their extension's
 * gettext over with `setTranslator` when they start; until then, and in the
 * Node tests, every string stays English.
 *
 * Every string the user reads goes through `_` or `ngettext` where it is
 * drawn. A table built when a module loads marks its strings with `N_`
 * instead, since the translator is not there yet, and translates them where
 * they are drawn. `scripts/i18n.mjs` finds all three to make the template.
 */

export interface Translator {
    gettext(msgid: string): string;
    ngettext(singular: string, plural: string, n: number): string;
}

let translator: Translator | null = null;

export function setTranslator(next: Translator | null): void {
    translator = next;
}

/** The translation of `msgid`; an empty string stays empty, where gettext would answer with its header. */
export function _(msgid: string): string {
    return translator && msgid ? translator.gettext(msgid) : msgid;
}

/** Marks a string for translation without translating it. */
export function N_(msgid: string): string {
    return msgid;
}

export function ngettext(singular: string, plural: string, n: number): string {
    if (translator) return translator.ngettext(singular, plural, n);
    return n === 1 ? singular : plural;
}

/**
 * Fills `%s` and `%d` with `values` in order and turns `%%` into `%`. A
 * translation keeps the placeholders in the order of its values.
 */
export function format(template: string, ...values: readonly (string | number)[]): string {
    let next = 0;
    return template.replace(/%([%sd])/g, (_match, kind: string) => {
        if (kind === '%') return '%';
        const value = values[next++];
        return value === undefined ? '' : String(value);
    });
}
