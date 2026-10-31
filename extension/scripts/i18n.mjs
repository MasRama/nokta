#!/usr/bin/env node
// Finds the strings to translate and keeps the translations honest.
//
//   node scripts/i18n.mjs              write po/nokta@nokta.io.pot from src/
//                                      and the Windows app's ../desktop/src/
//   node scripts/i18n.mjs --check      fail when the template is stale, a call
//                                      has a non-literal argument, or a
//                                      translation is missing, fuzzy or drops a
//                                      placeholder
//   node scripts/i18n.mjs --extract D  print what D's .ts files mark, as JSON
//
// A call is `_('…')`, `N_('…')` or `ngettext('…', '…', n)`, with single,
// double or back quotes (no `${}`). `_(x)` with a variable is allowed only on
// a line that says `// i18n: runtime`, for text the daemon sends whose
// msgids are marked elsewhere with `N_`.
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DOMAIN = 'nokta@nokta.io';
const POT = join(ROOT, 'po', `${DOMAIN}.pot`);
const PO_DIR = join(ROOT, 'po');
/** Where `_`, `N_` and `ngettext` are defined, not called. */
const DEFINITION = join('src', 'shared', 'logic', 'i18n.ts');
/** The Windows app draws its own strings and takes the same translations. */
const DESKTOP = join(ROOT, '..', 'desktop', 'src');

function tsFiles(dir) {
    const files = [];
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) files.push(...tsFiles(path));
        else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) files.push(path);
    }
    return files;
}

/** Reads a string literal at `at`; returns its text and the index after it, or null. */
function literal(source, at) {
    const quote = source[at];
    if (quote !== "'" && quote !== '"' && quote !== '`') return null;
    let text = '';
    for (let i = at + 1; i < source.length; i++) {
        const char = source[i];
        if (char === '\\') {
            const next = source[++i];
            text += next === 'n' ? '\n' : next === 't' ? '\t' : next;
        } else if (char === quote) {
            return { text, end: i + 1 };
        } else if (quote === '`' && char === '$' && source[i + 1] === '{') {
            return null;
        } else {
            text += char;
        }
    }
    return null;
}

function skipSpace(source, at) {
    while (at < source.length && /\s/.test(source[at])) at++;
    return at;
}

/** Every marked string in `files`, in order of first use, and the calls it could not read. */
export function extract(files, base) {
    const entries = new Map();
    const errors = [];
    // Not a method (`.x_(`), a longer name (`make_(`) or a regular expression (`/_(`).
    const call = /(?<![\w$./])(ngettext|N_|_)\(/g;
    for (const file of files) {
        const name = relative(base, file);
        if (name === DEFINITION) continue;
        const source = readFileSync(file, 'utf8');
        for (const match of source.matchAll(call)) {
            const lineStart = source.lastIndexOf('\n', match.index) + 1;
            const lineEnd = source.indexOf('\n', match.index);
            const line = source.slice(lineStart, lineEnd === -1 ? undefined : lineEnd);
            const lineNumber = source.slice(0, match.index).split('\n').length;
            const first = literal(source, skipSpace(source, match.index + match[0].length));
            if (!first) {
                if (!line.includes('// i18n: runtime')) errors.push(`${name}:${lineNumber}: ${line.trim()}`);
                continue;
            }
            let plural;
            if (match[1] === 'ngettext') {
                let at = skipSpace(source, first.end);
                if (source[at] === ',') at = skipSpace(source, at + 1);
                const second = literal(source, at);
                if (!second) {
                    errors.push(`${name}:${lineNumber}: ngettext needs two literal strings`);
                    continue;
                }
                plural = second.text;
            }
            const entry = entries.get(first.text);
            if (entry) {
                if (!entry.refs.includes(name)) entry.refs.push(name);
                if (plural !== undefined && entry.plural === undefined) entry.plural = plural;
            } else {
                entries.set(first.text, { msgid: first.text, plural, refs: [name] });
            }
        }
    }
    return { entries: [...entries.values()], errors };
}

function quote(text) {
    const escaped = text.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\t/g, '\\t').replace(/\n/g, '\\n');
    return `"${escaped}"`;
}

export function template(entries) {
    const lines = [
        "# Nokta's strings.",
        '# Generated by `npm run i18n` from the extension\'s source; do not edit by hand.',
        'msgid ""',
        'msgstr ""',
        '"Project-Id-Version: nokta\\n"',
        '"MIME-Version: 1.0\\n"',
        '"Content-Type: text/plain; charset=UTF-8\\n"',
        '"Content-Transfer-Encoding: 8bit\\n"',
        '',
    ];
    for (const entry of entries) {
        lines.push(`#: ${entry.refs.join(' ')}`);
        if (entry.msgid.includes('%')) lines.push('#, c-format');
        lines.push(`msgid ${quote(entry.msgid)}`);
        if (entry.plural !== undefined) {
            lines.push(`msgid_plural ${quote(entry.plural)}`, 'msgstr[0] ""', 'msgstr[1] ""');
        } else {
            lines.push('msgstr ""');
        }
        lines.push('');
    }
    return lines.join('\n');
}

function unquote(text) {
    return JSON.parse(text);
}

/** The entries of a .po file: msgid to { plural, translations, fuzzy }. */
export function parsePo(source) {
    const entries = new Map();
    let current = null;
    let field = null;
    let fuzzy = false;
    const finish = () => {
        if (current && current.msgid !== '') entries.set(current.msgid, current);
        current = null;
        field = null;
    };
    for (const raw of source.split('\n')) {
        const line = raw.trim();
        if (line === '') {
            finish();
            fuzzy = false;
            continue;
        }
        if (line.startsWith('#,')) {
            if (line.includes('fuzzy')) fuzzy = true;
            continue;
        }
        if (line.startsWith('#')) continue;
        let match;
        if ((match = /^msgid (".*")$/.exec(line))) {
            finish();
            current = { msgid: unquote(match[1]), plural: undefined, translations: [], fuzzy };
            field = 'msgid';
        } else if ((match = /^msgid_plural (".*")$/.exec(line))) {
            current.plural = unquote(match[1]);
            field = 'plural';
        } else if ((match = /^msgstr(?:\[(\d+)\])? (".*")$/.exec(line))) {
            const index = Number(match[1] ?? 0);
            current.translations[index] = unquote(match[2]);
            field = index;
        } else if (/^".*"$/.test(line) && current) {
            const more = unquote(line);
            if (field === 'msgid') current.msgid += more;
            else if (field === 'plural') current.plural += more;
            else current.translations[field] += more;
        }
    }
    finish();
    return entries;
}

function placeholders(text) {
    return (text.replace(/%%/g, '').match(/%[sd]/g) ?? []).join('');
}

/** What is wrong with `po` against the template's entries. */
export function poProblems(language, entries, po) {
    const problems = [];
    const wanted = new Set(entries.map((entry) => entry.msgid));
    for (const entry of entries) {
        const translated = po.get(entry.msgid);
        const label = `${language}: ${JSON.stringify(entry.msgid)}`;
        if (!translated || translated.translations.length === 0 || translated.translations.some((text) => !text)) {
            problems.push(`${label} is not translated`);
        } else if (translated.fuzzy) {
            problems.push(`${label} is fuzzy`);
        } else if (translated.translations.some((text) => placeholders(text) !== placeholders(entry.msgid))) {
            problems.push(`${label} does not keep its placeholders in order`);
        }
    }
    for (const msgid of po.keys()) if (!wanted.has(msgid)) problems.push(`${language}: ${JSON.stringify(msgid)} is no longer used`);
    return problems;
}

function languages() {
    const linguas = join(PO_DIR, 'LINGUAS');
    if (!existsSync(linguas)) return [];
    return readFileSync(linguas, 'utf8')
        .split('\n')
        .map((line) => line.replace(/#.*/, '').trim())
        .filter(Boolean);
}

function main(args) {
    if (args[0] === '--extract') {
        const dir = args[1];
        const { entries, errors } = extract(tsFiles(dir), dir);
        if (errors.length) {
            console.error(`Strings that are not literals:\n${errors.join('\n')}`);
            return 1;
        }
        console.log(JSON.stringify(entries.map(({ msgid, plural }) => (plural === undefined ? { msgid } : { msgid, plural }))));
        return 0;
    }
    const sources = [...tsFiles(join(ROOT, 'src')), ...(existsSync(DESKTOP) ? tsFiles(DESKTOP) : [])];
    const { entries, errors } = extract(sources, ROOT);
    if (errors.length) {
        console.error(`Strings that are not literals (mark a daemon string's line with // i18n: runtime):\n${errors.join('\n')}`);
        return 1;
    }
    const pot = template(entries);
    if (args[0] !== '--check') {
        writeFileSync(POT, pot);
        console.log(`Wrote ${relative(ROOT, POT)}: ${entries.length} strings`);
        return 0;
    }
    const problems = [];
    if (!existsSync(POT) || readFileSync(POT, 'utf8') !== pot) problems.push(`${relative(ROOT, POT)} is out of date: run npm run i18n`);
    for (const language of languages()) {
        const file = join(PO_DIR, `${language}.po`);
        if (!existsSync(file)) {
            problems.push(`${language}: po/${language}.po is missing`);
            continue;
        }
        problems.push(...poProblems(language, entries, parsePo(readFileSync(file, 'utf8'))));
        try {
            execFileSync('msgfmt', ['--check', '-o', '/dev/null', file], { stdio: 'pipe' });
        } catch (error) {
            if (error.code !== 'ENOENT') problems.push(`${language}: msgfmt --check failed:\n${error.stderr}`);
        }
    }
    if (problems.length) {
        console.error(problems.join('\n'));
        return 1;
    }
    console.log(`Translations check out: ${entries.length} strings, ${languages().join(', ') || 'no languages'}`);
    return 0;
}

process.exitCode = main(process.argv.slice(2));
