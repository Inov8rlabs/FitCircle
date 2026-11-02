/**
 * The one rule for a user's display name (`profiles.display_name`).
 *
 * Mirrored on the clients (iOS DisplayNameRules, Android DisplayNameRules) so
 * the edit sheet can validate inline; the server is authoritative.
 *
 *   1. Unicode NFC.
 *   2. Control characters and invisible format characters are removed (tabs
 *      and newlines become spaces). ZWJ survives so emoji sequences keep
 *      rendering; "blank" letters (Hangul filler, braille blank, ...) are
 *      removed.
 *   3. Runs of whitespace collapse to one space; the ends are trimmed.
 *   4. 1–40 characters, counted as user-perceived characters (grapheme
 *      clusters: an emoji family is 1). At least one letter, digit or emoji.
 *   5. No `<` or `>` (names are put into emails and push copy).
 *
 * Any script, accents, apostrophes, hyphens and emoji are allowed. (The old
 * sanitizeDisplayName() kept only ASCII letters/digits, so "José" was stored as
 * "Jos" and "李雷" as "".)
 */

export const DISPLAY_NAME_MAX_LENGTH = 40;

export type DisplayNameError = 'empty' | 'too_long' | 'invalid_characters';

export type DisplayNameResult =
  | { ok: true; value: string }
  | { ok: false; error: DisplayNameError; message: string };

export const DISPLAY_NAME_MESSAGES: Record<DisplayNameError, string> = {
  empty: 'Enter a name',
  too_long: `Names can be up to ${DISPLAY_NAME_MAX_LENGTH} characters`,
  invalid_characters: "Names can't contain < or >",
};

// Format characters (Cf: ZWSP, ZWNJ, bidi overrides, BOM, ...) except ZWJ.
const FORMAT_EXCEPT_ZWJ = /(?![\u200D])\p{Cf}/gu;
// Characters that are letters/symbols to Unicode but render as nothing.
const BLANK_LOOKING = /[\u115F\u1160\u3164\uFFA0\u2800\u180E]/gu;
const CONTROL = /\p{Cc}/gu;
const WHITESPACE_RUN = /[\s\p{Z}]+/gu;
const VISIBLE = /[\p{L}\p{N}\p{Extended_Pictographic}]/u;
const ANGLE_BRACKETS = /[<>]/;

/** Grapheme-cluster length (what a person counts as characters). */
export function displayNameLength(value: string): number {
  if (typeof Intl !== 'undefined' && typeof (Intl as any).Segmenter === 'function') {
    let n = 0;
    for (const _ of new (Intl as any).Segmenter(undefined, { granularity: 'grapheme' }).segment(value)) n++;
    return n;
  }
  return Array.from(value).length;
}

/** First `max` grapheme clusters of `value`. */
function truncateGraphemes(value: string, max: number): string {
  if (typeof Intl !== 'undefined' && typeof (Intl as any).Segmenter === 'function') {
    const parts: string[] = [];
    for (const s of new (Intl as any).Segmenter(undefined, { granularity: 'grapheme' }).segment(value)) {
      if (parts.length >= max) break;
      parts.push(s.segment);
    }
    return parts.join('');
  }
  return Array.from(value).slice(0, max).join('');
}

/** Steps 1–3: the normalized text (may be empty or too long). Pure. */
export function cleanDisplayName(raw: string | null | undefined): string {
  if (typeof raw !== 'string') return '';
  return raw
    .normalize('NFC')
    .replace(/[\t\n\r\v\f]/g, ' ')
    .replace(CONTROL, '')
    .replace(FORMAT_EXCEPT_ZWJ, '')
    .replace(BLANK_LOOKING, '')
    .replace(WHITESPACE_RUN, ' ')
    .trim();
}

/** The full rule: the stored value, or why it is rejected. Pure. */
export function validateDisplayName(raw: string | null | undefined): DisplayNameResult {
  const value = cleanDisplayName(raw);
  const fail = (error: DisplayNameError): DisplayNameResult => ({ ok: false, error, message: DISPLAY_NAME_MESSAGES[error] });
  if (!value || !VISIBLE.test(value)) return fail('empty');
  if (ANGLE_BRACKETS.test(value)) return fail('invalid_characters');
  if (displayNameLength(value) > DISPLAY_NAME_MAX_LENGTH) return fail('too_long');
  return { ok: true, value };
}

/**
 * Lenient form for account creation (register, Apple/Google sign-in, web
 * signup bootstrap), where shipped clients must never be rejected for a name:
 * the cleaned name without angle brackets, cut to the limit, or `fallback`
 * (the username) when nothing usable is left.
 */
export function coerceDisplayName(raw: string | null | undefined, fallback: string): string {
  const value = cleanDisplayName(raw).replace(/[<>]/g, '').replace(WHITESPACE_RUN, ' ').trim();
  if (!value || !VISIBLE.test(value)) return fallback;
  return truncateGraphemes(value, DISPLAY_NAME_MAX_LENGTH).trim();
}
