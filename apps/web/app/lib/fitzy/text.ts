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
