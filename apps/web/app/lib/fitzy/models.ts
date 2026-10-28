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

/**
 * Structured JSON tasks (plan, preview, daily focus, memory) run with thinking disabled: with a
 * small maxOutputTokens, adaptive thinking ate most of the budget and truncated the JSON
 * (bake-off 2026-10-20: 5/10 Sonnet plans and 6/10 Haiku previews fell back).
 */
export function thinkingOptions(model: string, thinking: boolean) {
  if (thinking || !model.startsWith('anthropic/')) return {};
  return { providerOptions: { anthropic: { thinking: { type: 'disabled' as const } } } };
}

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

/** One model task: messages + budget, independent of which model runs it. */
export interface ModelCall {
  system: ModelMessage[];
  messages: Turn[];
  maxOutputTokens?: number;
  /** false for structured JSON tasks (see thinkingOptions). Default true. */
  thinking?: boolean;
  abortSignal?: AbortSignal;
}

/**
 * The exact AI SDK options production sends for `call` on `model`. Shared by generateWithFallback,
 * streamFrom and the live-model eval (scripts/fitzy-eval) so the eval can't drift from production.
 */
export function callOptions(model: string, call: ModelCall) {
  return {
    model,
    messages: [...call.system, ...call.messages],
    allowSystemInMessages: true,
    timeout: MODEL_TIMEOUT_MS,
    ...(call.abortSignal ? { abortSignal: call.abortSignal } : {}),
    ...(call.maxOutputTokens ? { maxOutputTokens: call.maxOutputTokens } : {}),
    ...thinkingOptions(model, call.thinking ?? true),
  };
}

/** Per-attempt telemetry (used by the live-model eval; production passes no observer). */
export interface AttemptInfo {
  model: string;
  ok: boolean;
  ms: number;
  error?: unknown;
  text?: string;
  finishReason?: string;
  usage?: unknown;
  providerMetadata?: unknown;
}

/**
 * generateText on `primary`, then once on the fallback model. Throws only if both fail.
 */
export async function generateWithFallback(opts: ModelCall & { primary: string; onAttempt?: (a: AttemptInfo) => void }): Promise<GenerationResult> {
  const order = [opts.primary, fallbackFor(opts.primary)];
  let lastError: unknown = null;
  for (const model of order) {
    const t0 = Date.now();
    let reported = false;
    try {
      const res = await generateText(callOptions(model, opts) as Parameters<typeof generateText>[0]);
      const text = (res.text ?? '').trim();
      reported = true;
      const truncatedStructured = res.finishReason === 'length' && opts.thinking === false;
      opts.onAttempt?.({ model, ok: !!text && !truncatedStructured, ms: Date.now() - t0, text, finishReason: res.finishReason, usage: res.usage, providerMetadata: res.providerMetadata });
      if (!text) throw new Error('empty completion');
      if (res.finishReason === 'length') {
        // Structured callers can't use a cut-off JSON object: try the other model instead of
        // silently falling back to defaults. Chat keeps the (complete-sentence) text.
        console.warn(`[fitzy] ${model} hit maxOutputTokens (${opts.maxOutputTokens ?? 'default'})`);
        if (opts.thinking === false) throw new Error('truncated structured output');
      }
      return { text, model, inputTokens: res.usage?.inputTokens ?? null, outputTokens: res.usage?.outputTokens ?? null };
    } catch (err) {
      if (!reported) opts.onAttempt?.({ model, ok: false, ms: Date.now() - t0, error: err });
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
export function streamFrom(opts: {
  model: string;
  system: ModelMessage[];
  messages: Turn[];
  abortSignal?: AbortSignal;
  maxOutputTokens?: number;
  /** false disables model thinking (see thinkingOptions). Default true. */
  thinking?: boolean;
}) {
  const result = streamText({
    ...callOptions(opts.model, {
      system: opts.system,
      messages: opts.messages,
      abortSignal: opts.abortSignal,
      maxOutputTokens: opts.maxOutputTokens,
      thinking: opts.thinking,
    }),
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
    /** finishReason / full usage / gateway metadata after the stream ends (eval telemetry). */
    details: async () => {
      const r = result as any;
      const [finishReason, usage, providerMetadata] = await Promise.all([r.finishReason, r.totalUsage ?? r.usage, r.providerMetadata].map((p: any) => Promise.resolve(p).catch(() => undefined)));
      return { finishReason: finishReason as string | undefined, usage, providerMetadata };
    },
  };
}
