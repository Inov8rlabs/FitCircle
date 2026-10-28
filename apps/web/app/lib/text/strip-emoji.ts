/**
 * Emoji policy (docs/DESIGN_LANGUAGE.md §6): system copy never carries emoji.
 * Every LLM string that reaches a push, a feed card, a circle system post, a
 * plan title or a food name goes through stripEmoji() as a server-side backstop
 * to the prompts' "no emoji" rule. User-generated content (chat, names, notes)
 * and reaction emoji are NOT stripped.
 */

/** Pictographs plus the joiners / modifiers / selectors that build emoji sequences. */
const EMOJI_RUN =
  /[\p{Extended_Pictographic}\p{Emoji_Modifier}\p{Regional_Indicator}\u{FE0F}\u{FE0E}\u{200D}\u{20E3}\u{E0020}-\u{E007F}]+/gu;
const EMOJI_TEST =
  /[\p{Extended_Pictographic}\p{Emoji_Modifier}\p{Regional_Indicator}\u{FE0F}\u{20E3}]/u;
/** Keycap emoji (1️⃣ #️⃣): the base digit / symbol is not pictographic on its own. */
const KEYCAP = /[0-9#*]\u{FE0F}?\u{20E3}/gu;
/** Plain-text symbols that are "decorative", not punctuation; Extended_Pictographic also covers © ® ™, which we keep. */
const KEEP = new Set(['©', '®', '™']);

/** True when `text` contains an emoji / pictograph (ignores © ® ™). */
export function hasEmoji(text: string | null | undefined): boolean {
  if (!text) return false;
  for (const ch of text) if (!KEEP.has(ch) && EMOJI_TEST.test(ch)) return true;
  return /\u{20E3}/u.test(text);
}

/**
 * Removes emoji and tidies the whitespace they leave behind: "Nice work 🔥!" →
 * "Nice work!", "🎉 Big day" → "Big day". Line breaks are preserved. Text without
 * emoji is returned unchanged (same string).
 */
export function stripEmoji(text: string): string;
export function stripEmoji(text: string | null | undefined): string | null | undefined;
export function stripEmoji(text: string | null | undefined): string | null | undefined {
  if (!text || !hasEmoji(text)) return text;
  const out = text
    .replace(KEYCAP, ' ')
    .replace(EMOJI_RUN, (run) => {
      const kept = [...run].filter((ch) => KEEP.has(ch)).join('');
      return kept || ' ';
    })
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+([.,!?;:)\]}…])/g, '$1')
    .replace(/([(\[{])[ \t]+/g, '$1')
    .replace(/^[ \t]+|[ \t]+$/gm, '');
  return out.trim();
}

/** stripEmoji for optional fields: empty results become null. */
export function stripEmojiOrNull(text: string | null | undefined): string | null {
  const s = stripEmoji(text ?? null);
  return s && s.trim() ? s : null;
}

/**
 * Emoji removal for a STREAMED fragment: like stripEmoji but never trims the ends, so the spaces and
 * line breaks between released sentences survive. Used where a whole surface is emoji-free
 * (onboarding answers) and text is emitted in pieces.
 */
export function removeEmojiInline(text: string): string {
  if (!text || !hasEmoji(text)) return text;
  return text
    .replace(KEYCAP, '')
    .replace(EMOJI_RUN, (run) => [...run].filter((ch) => KEEP.has(ch)).join(''))
    .replace(/(\S)[ \t]{2,}/g, '$1 ')
    .replace(/[ \t]+([.,!?;:)\]}…])/g, '$1')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n');
}
