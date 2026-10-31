import { setTranslator, type Translator } from '@ext/shared/logic/i18n.js';

// The extension's translations, bundled into the page as text.
const FILES = import.meta.glob<string>('../../extension/po/*.po', { query: '?raw', import: 'default', eager: true });

/** A .po file's translated, not fuzzy entries: msgid to its forms, and the plural rule. */
export interface Catalog {
    messages: Map<string, string[]>;
    /** The form for `n`: one form for a language without plurals, else one and other. */
    plural: (n: number) => number;
}

const unquote = (text: string): string => JSON.parse(text) as string;

export function parsePo(source: string): Catalog {
    const messages = new Map<string, string[]>();
    let msgid: string | null = null;
    let forms: string[] = [];
    let field: 'msgid' | 'plural' | number | null = null;
    let fuzzy = false;
    let header = '';
    const finish = () => {
        if (msgid === '') header = forms[0] ?? '';
        else if (msgid !== null && !fuzzy && forms.length > 0 && forms.every(Boolean)) messages.set(msgid, forms);
        msgid = null;
        forms = [];
        field = null;
    };
    for (const raw of source.split('\n')) {
        const line = raw.trim();
        let match: RegExpExecArray | null;
        if (line === '') {
            finish();
            fuzzy = false;
        } else if (line.startsWith('#,')) {
            if (line.includes('fuzzy')) fuzzy = true;
        } else if (line.startsWith('#')) {
            continue;
        } else if ((match = /^msgid (".*")$/.exec(line))) {
            finish();
            msgid = unquote(match[1]);
            field = 'msgid';
        } else if (/^msgid_plural ".*"$/.test(line)) {
            field = 'plural';
        } else if ((match = /^msgstr(?:\[(\d+)\])? (".*")$/.exec(line))) {
            field = Number(match[1] ?? 0);
            forms[field] = unquote(match[2]);
        } else if (/^".*"$/.test(line) && msgid !== null) {
            if (field === 'msgid') msgid += unquote(line);
            else if (typeof field === 'number') forms[field] += unquote(line);
        }
    }
    finish();
    const one = /nplurals\s*=\s*1\b/.test(header);
    return { messages, plural: (n) => (one ? 0 : n === 1 ? 0 : 1) };
}

export function translator({ messages, plural }: Catalog): Translator {
    return {
        gettext: (msgid) => messages.get(msgid)?.[0] ?? msgid,
        ngettext: (singular, other, n) => messages.get(singular)?.[plural(n)] ?? (n === 1 ? singular : other),
    };
}

/**
 * The first of `wanted` (BCP 47, as `navigator.languages`) that `available`
 * has, by its language; null for English, the strings' own, or none.
 */
export function chooseLanguage(wanted: readonly string[], available: readonly string[]): string | null {
    for (const tag of wanted) {
        const language = tag.toLowerCase().split(/[-_]/)[0];
        if (language === 'en') return null;
        const found = available.find((name) => name.toLowerCase().split(/[-_]/)[0] === language);
        if (found) return found;
    }
    return null;
}

/**
 * Translates the page into Windows' display language, which WebView2 gives
 * as `navigator.languages`; English when Nokta has no translation for it.
 */
export function useSystemLanguage(wanted: readonly string[] = navigator.languages): void {
    const files = new Map(
        Object.entries(FILES).map(([path, text]) => [/([^/]+)\.po$/.exec(path)?.[1] ?? '', text] as const),
    );
    const language = chooseLanguage(wanted, [...files.keys()]);
    setTranslator(language ? translator(parsePo(files.get(language)!)) : null);
}
