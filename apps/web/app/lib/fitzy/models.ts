/**
 * Fitzy model routing (docs/FITZY_V2_SPEC.md §1).
 *  - FITZY_CHAT_MODEL (Haiku 5.5): every chat turn, daily focus, plan teaser, memory extraction.
 *  - FITZY_DEEP_MODEL (Sonnet 5.5): weekly plan + Sunday recap (Pro).
 *  - Fallback: on error/timeout (25 s) try the other model once; callers then use SAFE_FALLBACK.
 *  - Prompt caching: the static system prompt is its own system message carrying the Anthropic
 *    cache breakpoint (`providerOptions.anthropic.cacheControl`, passed through by the Vercel AI
 *    Gateway); the per-user grounding is a second, uncached system message.
 */
import { generateText, streamText, type ModelMessage } from 'ai';

export const DEFAULT_CHAT_MODEL = 'anthropic/claude-haiku-5.5';
export const DEFAULT_DEEP_MODEL = 'anthropic/claude-sonnet-5.5';
export const MODEL_TIMEOUT_MS = 25_000;

export const chatModel = () => process.env.FITZY_CHAT_MODEL?.trim() || DEFAULT_CHAT_MODEL;
export const deepModel = () => process.env.FITZY_DEEP_MODEL?.trim() || DEFAULT_DEEP_MODEL;

/** The other model (for the one fallback attempt). */
export function fallbackFor(model: string): string {
  return model === chatModel() ? deepModel() : chatModel();
}

/** Anthropic prompt-cache breakpoint, as the AI SDK / Gateway expect it on a message. */
export const CACHE_EPHEMERAL = { anthropic: { cacheControl: { type: 'ephemeral' as const } } };

/** [static (cached) system message, grounding (uncached) system message?]. */
export function systemMessages(staticPrompt: string, grounding?: string | null): ModelMessage[] {
  const out: ModelMessage[] = [{ role: 'system', content: staticPrompt, providerOptions: CACHE_EPHEMERAL }];
  if (grounding && grounding.trim()) out.push({ role: 'system', content: grounding });
  return out;
}

export interface GenerationResult {
  text: string;
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
}

type Turn = { role: 'user' | 'assistant'; content: string };

/**
 * generateText on `primary`, then once on the fallback model. Throws only if both fail.
 */
export async function generateWithFallback(opts: {
  primary: string;
  system: ModelMessage[];
  messages: Turn[];
  maxOutputTokens?: number;
}): Promise<GenerationResult> {
  const order = [opts.primary, fallbackFor(opts.primary)];
  let lastError: unknown = null;
  for (const model of order) {
    try {
      const res = await generateText({
        model,
        messages: [...opts.system, ...opts.messages],
        allowSystemInMessages: true,
        timeout: MODEL_TIMEOUT_MS,
        ...(opts.maxOutputTokens ? { maxOutputTokens: opts.maxOutputTokens } : {}),
      } as Parameters<typeof generateText>[0]);
      const text = (res.text ?? '').trim();
      if (!text) throw new Error('empty completion');
      return { text, model, inputTokens: res.usage?.inputTokens ?? null, outputTokens: res.usage?.outputTokens ?? null };
    } catch (err) {
      lastError = err;
      console.error(`[fitzy] ${model} failed:`, (err as any)?.message ?? err);
    }
  }
  throw lastError instanceof Error ? lastError : new Error('generation failed');
}

/**
 * Stream text from `model`. Yields chunks; resolves usage at the end. Errors surface from the
 * iterator so the caller can decide whether a fallback is still possible (nothing emitted yet).
 */
export function streamFrom(opts: { model: string; system: ModelMessage[]; messages: Turn[]; abortSignal?: AbortSignal }) {
  const result = streamText({
    model: opts.model,
    messages: [...opts.system, ...opts.messages],
    allowSystemInMessages: true,
    timeout: MODEL_TIMEOUT_MS,
    abortSignal: opts.abortSignal,
    onError: () => {
      /* surfaced through textStream */
    },
  } as Parameters<typeof streamText>[0]);
  return {
    textStream: result.textStream as AsyncIterable<string>,
    usage: async (): Promise<{ inputTokens: number | null; outputTokens: number | null }> => {
      try {
        const u = await result.usage;
        return { inputTokens: u?.inputTokens ?? null, outputTokens: u?.outputTokens ?? null };
      } catch {
        return { inputTokens: null, outputTokens: null };
      }
    },
  };
}
