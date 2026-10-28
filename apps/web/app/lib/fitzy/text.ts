/** Small text helpers shared by Fitzy services (no imports, so no cycles). */
const cp = (s: string) => [...s].length;

/**
 * Over-long bodies are trimmed at the last sentence end that fits rather than rejected: the
 * live eval showed Haiku overshooting 240 chars on ~25% of cards, which sent users the static
 * fallback and re-ran the model on every open. Null when no whole sentence fits.
 */
export function fitBody(body: string, max: number): string | null {
  if (!body) return null;
  if (cp(body) <= max) return body;
  const head = Array.from(body).slice(0, max).join('');
  const m = head.match(/^[\s\S]*[.!?…](?=\s|$)/);
  const cut = m ? m[0].trim() : '';
  return cut && cp(cut) >= 40 ? cut : null;
}

/** Whitespace-separated word count (same rule as the live eval). */
export const wordCount = (s: string) => (s.match(/\S+/g) || []).length;

/**
 * `text` cut to at most `maxWords` words at the last sentence end or line break that fits
 * (onboarding answers are an opening sentence, bullets, a closing line). Returns `text` unchanged
 * when it already fits; when not even the first sentence fits, the first `maxWords` words + "…".
 */
export function capAtSentence(text: string, maxWords: number): string {
  if (wordCount(text) <= maxWords) return text;
  const boundary = /[.!?…](?=\s|$)|\n/g;
  let best = 0;
  let m: RegExpExecArray | null;
  while ((m = boundary.exec(text))) {
    const end = m.index + m[0].length;
    if (wordCount(text.slice(0, end)) > maxWords) break;
    best = end;
  }
  if (best > 0) return text.slice(0, best).replace(/\s+$/, '');
  return `${(text.match(/\S+/g) || []).slice(0, maxWords).join(' ')}…`;
}

/**
 * Drops a trailing line with no letters (e.g. " 0 2 4 6", seen once in 30 live onboarding replies
 * where the model emitted digits instead of the META block). Applied only to the end of a reply.
 */
export function trimTrailingNoise(text: string): string {
  return text.replace(/\n[^\p{L}\n]*\S[^\p{L}\n]*\s*$/u, '').replace(/\s+$/, '') || text;
}
