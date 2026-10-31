import { afterEach, describe, expect, it } from 'vitest';

import { _, ngettext, setTranslator } from '@ext/shared/logic/i18n.js';

import { MockBridge } from '../src/bridge/mock.js';
import { chooseLanguage, parsePo, translator, useSystemLanguage } from '../src/i18n.js';
import { SettingsWindow } from '../src/prefs/window.js';

const PO = `msgid ""
msgstr ""
"Language: xx\\n"
"Plural-Forms: nplurals=1; plural=0;\\n"

msgid "Join"
msgstr "Gabung"

msgid "A long "
"line"
msgstr "Baris "
"panjang"

#, fuzzy
msgid "Draft"
msgstr "Konsep"

msgid "Empty"
msgstr ""

msgid "%d file"
msgid_plural "%d files"
msgstr[0] "%d berkas"
`;

afterEach(() => {
    setTranslator(null);
    document.body.replaceChildren();
});

describe('translations on Windows', () => {
    it('reads a .po file: its finished entries, joined lines and plural rule', () => {
        const t = translator(parsePo(PO));
        expect(t.gettext('Join')).toBe('Gabung');
        expect(t.gettext('A long line')).toBe('Baris panjang');
        expect(t.gettext('Draft')).toBe('Draft');
        expect(t.gettext('Empty')).toBe('Empty');
        expect(t.ngettext('%d file', '%d files', 3)).toBe('%d berkas');
        expect(t.ngettext('%d page', '%d pages', 3)).toBe('%d pages');
    });

    it("takes Windows' first display language Nokta has, and English before any", () => {
        expect(chooseLanguage(['id-ID', 'en-US'], ['id'])).toBe('id');
        expect(chooseLanguage(['fr-FR', 'id'], ['id'])).toBe('id');
        expect(chooseLanguage(['en-US', 'id-ID'], ['id'])).toBeNull();
        expect(chooseLanguage(['fr-FR'], ['id'])).toBeNull();
    });

    it("draws the settings window in Indonesian from the extension's translations", async () => {
        useSystemLanguage(['id-ID']);
        expect(_('Join')).toBe('Gabung');
        expect(ngettext('%d item', '%d items', 2)).toBe('%d items');
        const prefs = new SettingsWindow(new MockBridge(), { openConfig: () => {}, pickPicture: async () => null }, document.body);
        await prefs.start();
        const navs = [...document.querySelectorAll('.nokta-prefs-nav span:not(.nokta-icon)')].map((n) => n.textContent);
        expect(navs.slice(0, 2)).toEqual(['Tampilan', 'Perilaku']);
        expect(document.body.textContent).toContain('Kalender');
        prefs.stop();

        useSystemLanguage(['en-GB', 'id-ID']);
        expect(_('Join')).toBe('Join');
    });
});
