import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';

// The settings window runs in GNOME's preferences process, where the shell's
// own libraries are missing: one import of them anywhere below prefs.ts
// turns the window into GNOME's error page.
const SHELL_ONLY = /^(gi:\/\/(St|Clutter|Meta|Shell|Mtk|Cogl)(\?.*)?|resource:\/\/\/org\/gnome\/shell\/.*)$/;
const IMPORT = /^\s*(?:import|export)\s[^'"]*?from\s+['"]([^'"]+)['"]/gm;

function imports(file: string): string[] {
    return [...readFileSync(file, 'utf8').matchAll(IMPORT)].map((match) => match[1]);
}

test('nothing the settings window imports needs the shell', () => {
    const src = resolve(process.cwd(), 'src');
    const seen = new Set<string>();
    const found: string[] = [];
    const visit = (file: string) => {
        if (seen.has(file)) return;
        seen.add(file);
        for (const name of imports(file)) {
            if (SHELL_ONLY.test(name)) found.push(`${file.slice(src.length + 1)}: ${name}`);
            else if (name.startsWith('.')) visit(join(dirname(file), name.replace(/\.js$/, '.ts')));
        }
    };
    visit(join(src, 'prefs.ts'));
    assert.ok(seen.size > 5, `only ${seen.size} files were read`);
    assert.deepEqual(found, []);
});
