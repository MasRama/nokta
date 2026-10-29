import assert from 'node:assert/strict';
import { test } from 'node:test';

import { romanize } from '../src/features/lyrics/logic/romanize.js';

test('hangul is romanized syllable by syllable', () => {
    assert.equal(romanize('사랑해'), 'saranghae');
    assert.equal(romanize('안녕하세요'), 'annyeonghaseyo');
    assert.equal(romanize('너를 봐'), 'neoreul bwa');
    // No sound-change rules: each syllable as it is written.
    assert.equal(romanize('같이'), 'gati');
    assert.equal(romanize('밝다'), 'bakda');
});

test('kana is romanized by hepburn', () => {
    assert.equal(romanize('こんにちは'), 'konnichiha');
    assert.equal(romanize('ありがとう'), 'arigatou');
    assert.equal(romanize('しゃしん'), 'shashin');
    assert.equal(romanize('ちゅう'), 'chuu');
});

test('small tsu doubles the next consonant', () => {
    assert.equal(romanize('きって'), 'kitte');
    assert.equal(romanize('まっちゃ'), 'matcha');
});

test('the long vowel mark repeats the vowel', () => {
    assert.equal(romanize('ラーメン'), 'raamen');
    assert.equal(romanize('コーヒー'), 'koohii');
});

test('n before a vowel or y gets an apostrophe', () => {
    assert.equal(romanize('きんえん'), "kin'en");
    assert.equal(romanize('こんやく'), "kon'yaku");
    assert.equal(romanize('さんぽ'), 'sanpo');
});

test('katakana sounds for foreign words', () => {
    assert.equal(romanize('ファン'), 'fan');
    assert.equal(romanize('パーティー'), 'paatii');
    assert.equal(romanize('ヴィ'), 'vi');
});

test('a mixed line keeps latin and kanji as they are', () => {
    assert.equal(romanize('君が好き'), '君ga好ki');
    assert.equal(romanize('Baby 사랑해'), 'Baby saranghae');
    assert.equal(romanize('夢を見て、Oh'), '夢wo見te、Oh');
});

test('a line without hangul or kana has no romanization', () => {
    assert.equal(romanize('Hello world'), null);
    assert.equal(romanize('君'), null);
    assert.equal(romanize(''), null);
});
