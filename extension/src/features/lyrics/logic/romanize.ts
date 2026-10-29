/**
 * Offline romanization of lyric lines: Hangul by Revised Romanization of
 * each syllable (no sound-change rules across syllables), kana by Hepburn.
 * Kanji, Latin and everything else stay as they are.
 */

const HANGUL_FIRST = 0xac00;
const HANGUL_LAST = 0xd7a3;
const INITIALS = ['g', 'kk', 'n', 'd', 'tt', 'r', 'm', 'b', 'pp', 's', 'ss', '', 'j', 'jj', 'ch', 'k', 't', 'p', 'h'];
const VOWELS = [
    'a', 'ae', 'ya', 'yae', 'eo', 'e', 'yeo', 'ye', 'o', 'wa', 'wae',
    'oe', 'yo', 'u', 'wo', 'we', 'wi', 'yu', 'eu', 'ui', 'i',
];
/** A final consonant as it sounds at the end of its own syllable. */
const FINALS = [
    '', 'k', 'k', 'k', 'n', 'n', 'n', 't', 'l', 'k', 'm', 'l', 'l', 'l',
    'p', 'l', 'm', 'p', 'p', 't', 't', 'ng', 't', 't', 'k', 't', 'p', 't',
];

const KANA: Record<string, string> = {
    あ: 'a', い: 'i', う: 'u', え: 'e', お: 'o',
    か: 'ka', き: 'ki', く: 'ku', け: 'ke', こ: 'ko',
    さ: 'sa', し: 'shi', す: 'su', せ: 'se', そ: 'so',
    た: 'ta', ち: 'chi', つ: 'tsu', て: 'te', と: 'to',
    な: 'na', に: 'ni', ぬ: 'nu', ね: 'ne', の: 'no',
    は: 'ha', ひ: 'hi', ふ: 'fu', へ: 'he', ほ: 'ho',
    ま: 'ma', み: 'mi', む: 'mu', め: 'me', も: 'mo',
    や: 'ya', ゆ: 'yu', よ: 'yo',
    ら: 'ra', り: 'ri', る: 'ru', れ: 're', ろ: 'ro',
    わ: 'wa', ゐ: 'wi', ゑ: 'we', を: 'wo',
    が: 'ga', ぎ: 'gi', ぐ: 'gu', げ: 'ge', ご: 'go',
    ざ: 'za', じ: 'ji', ず: 'zu', ぜ: 'ze', ぞ: 'zo',
    だ: 'da', ぢ: 'ji', づ: 'zu', で: 'de', ど: 'do',
    ば: 'ba', び: 'bi', ぶ: 'bu', べ: 'be', ぼ: 'bo',
    ぱ: 'pa', ぴ: 'pi', ぷ: 'pu', ぺ: 'pe', ぽ: 'po',
    ゔ: 'vu',
    ぁ: 'a', ぃ: 'i', ぅ: 'u', ぇ: 'e', ぉ: 'o',
    ゃ: 'ya', ゅ: 'yu', ょ: 'yo', ゎ: 'wa', ゕ: 'ka', ゖ: 'ke',
};
const SMALL_Y: Record<string, string> = { ゃ: 'a', ゅ: 'u', ょ: 'o' };
const SMALL_VOWELS: Record<string, string> = { ぁ: 'a', ぃ: 'i', ぅ: 'u', ぇ: 'e', ぉ: 'o' };
/** ヷヸヹヺ, which have no hiragana. */
const VA: Record<string, string> = { ヷ: 'va', ヸ: 'vi', ヹ: 've', ヺ: 'vo' };

const isHangul = (code: number): boolean => code >= HANGUL_FIRST && code <= HANGUL_LAST;
const isKana = (code: number): boolean => (code >= 0x3041 && code <= 0x3096) || (code >= 0x30a1 && code <= 0x30fa);

/** Katakana as the hiragana with the same sound; other characters as they are. */
function hiragana(char: string): string {
    const code = char.codePointAt(0) ?? 0;
    return code >= 0x30a1 && code <= 0x30f6 ? String.fromCodePoint(code - 0x60) : char;
}

function syllable(code: number): string {
    const index = code - HANGUL_FIRST;
    return INITIALS[Math.floor(index / 588)] + VOWELS[Math.floor((index % 588) / 28)] + FINALS[index % 28];
}

/** A kana and the small kana after it as one sound, like きゃ or ふぁ. */
function joined(base: string, small: string): string | null {
    const sound = KANA[base];
    if (sound.length > 1 && sound.endsWith('i') && SMALL_Y[small]) {
        // し, ち and じ give sha, cha and ja; the others kya, nya and so on.
        const stem = /^(sh|ch|j)i$/.test(sound) ? sound.slice(0, -1) : `${sound.slice(0, -1)}y`;
        return stem + SMALL_Y[small];
    }
    if (SMALL_VOWELS[small] && base !== 'あ' && base !== 'え' && base !== 'お') {
        // ふぁ fa, てぃ ti, うぃ wi, いぇ ye, ゔぃ vi.
        const stem = base === 'う' ? 'w' : base === 'い' ? 'y' : sound.replace(/[aeiou]$/, '');
        if (stem) return stem + SMALL_VOWELS[small];
    }
    return null;
}

/** The romanized line, or null when it has no Hangul or kana. */
export function romanize(line: string): string | null {
    const chars = Array.from(line);
    if (!chars.some((c) => isHangul(c.codePointAt(0)!) || isKana(c.codePointAt(0)!))) return null;
    let out = '';
    let doubled = false;
    let afterN = false;
    for (let i = 0; i < chars.length; i++) {
        const char = chars[i];
        const code = char.codePointAt(0)!;
        if (isHangul(code)) {
            out += syllable(code);
            afterN = doubled = false;
            continue;
        }
        const kana = hiragana(char);
        if (kana === 'っ') {
            doubled = true;
            afterN = false;
            continue;
        }
        if (kana === 'ん') {
            out += 'n';
            afterN = true;
            doubled = false;
            continue;
        }
        if (char === 'ー') {
            out += /[aeiou]$/.exec(out)?.[0] ?? '';
            afterN = doubled = false;
            continue;
        }
        let sound = VA[char] ?? KANA[kana];
        if (sound === undefined) {
            out += char;
            afterN = doubled = false;
            continue;
        }
        const pair = i + 1 < chars.length && KANA[kana] ? joined(kana, hiragana(chars[i + 1])) : null;
        if (pair) {
            sound = pair;
            i++;
        }
        if (afterN && /^[aeiouy]/.test(sound)) out += "'";
        if (doubled) out += sound.startsWith('ch') ? 't' : sound[0];
        out += sound;
        afterN = doubled = false;
    }
    return out;
}
