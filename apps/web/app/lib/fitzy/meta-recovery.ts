/**
 * META recovery (2026-10-28). The chat model sometimes ends a complete, good reply without the
 * META block (1 in 30 onboarding replies, a few % of normal chat in the live eval), and a stall can
 * cut a reply before it. The text is already on the user's screen, so instead of static chips we ask
 * the chat model once, non-streaming, for just the META line of that answer. Same cached system
 * prompt (so the call is a cache hit), thinking off, a short deadline. Null on any failure: callers
 * fall back to staticSuggestions. Actions are still filtered by applyGuardrails downstream.
 */
import { generateText, type ModelMessage } from 'ai';

import { META_MARKER, parseMeta, splitMeta } from './meta';
import { callOptions, chatModel, withDeadline } from './models';

export const META_RECOVERY_MS = 6_000;
/**
 * Framed as an app instruction (a system message) plus a short app-tagged user turn. A bare user
 * request ("reply with only the META line") read like prompt extraction and was refused on safety
 * topics; assistant prefill is not supported by the chat model ("must end with a user message").
 */
export const META_RECOVERY_SYSTEM = `APP INSTRUCTION (not from the user): the assistant's last reply was saved without its META line. Write ONLY that line now: ${META_MARKER} followed by ONE JSON object as specified in META above. No other text.`;
export const META_ONLY_REQUEST = '(app) META line for the reply above, please.';

export async function recoverMeta(
  p: { system: ModelMessage[]; turns: Array<{ role: 'user' | 'assistant'; content: string }> },
  answer: string,
  abortSignal?: AbortSignal
): Promise<string | null> {
  const started = Date.now();
  // Two tries inside one META_RECOVERY_MS budget: an unparseable or failed first try gets one more.
  for (let attempt = 1; attempt <= 2; attempt++) {
    const left = META_RECOVERY_MS - (Date.now() - started);
    if (left < 1_000) break;
    try {
      const res = await withDeadline(left, abortSignal, (signal) =>
        generateText(
          callOptions(chatModel(), {
            system: [...p.system, { role: 'system', content: META_RECOVERY_SYSTEM }],
            messages: [...p.turns, { role: 'assistant', content: answer }, { role: 'user', content: META_ONLY_REQUEST }],
            maxOutputTokens: 300,
            thinking: false,
            abortSignal: signal,
          }) as Parameters<typeof generateText>[0]
        )
      );
      const text = (res.text ?? '').trim();
      const meta = splitMeta(text).metaRaw ?? text;
      if (parseMeta(meta).ok) return meta;
      console.warn(`[fitzy] META recovery attempt ${attempt} unparseable: ${text.slice(0, 120)}`);
    } catch (err) {
      console.warn(`[fitzy] META recovery attempt ${attempt} failed:`, (err as Error)?.message ?? err);
    }
  }
  return null;
}
