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
/**
 * Stream watchdog (2026-10-28). In the live eval, 1 in 5 onboarding streams STALLED at the
 * gateway: no chunk (or a partial reply, then nothing) for ~16 minutes, with no finishReason or
 * usage, until the socket died. The AI SDK `timeout` above did not end them. Observed healthy
 * streams: first chunk 0.6–2 s, chunks every < 1 s, whole reply < 4 s. So a stream that sends no
 * first chunk within STREAM_FIRST_CHUNK_MS, goes quiet for STREAM_IDLE_MS, or runs past
 * MODEL_TIMEOUT_MS is aborted here and surfaces as a ModelStallError (the caller retries).
 */
export const STREAM_FIRST_CHUNK_MS = 12_000;
export const STREAM_IDLE_MS = 8_000;

/** AbortSignal.any where available (Node ≥ 20), else a manual combination (jsdom tests). */
export function anySignal(a: AbortSignal, b: AbortSignal): AbortSignal {
  if (typeof (AbortSignal as any).any === 'function') return (AbortSignal as any).any([a, b]);
  const ctl = new AbortController();
  for (const s of [a, b]) {
    if (s.aborted) {
      ctl.abort(s.reason);
      break;
    }
    s.addEventListener('abort', () => ctl.abort(s.reason), { once: true });
  }
  return ctl.signal;
}

export class ModelStallError extends Error {
  constructor(
    readonly kind: 'first_chunk' | 'idle' | 'total',
    readonly afterMs: number
  ) {
    super(`model stream stalled (${kind} after ${afterMs} ms)`);
    this.name = 'ModelStallError';
  }
}

/**
 * Re-yields `source`, failing with ModelStallError when the next item takes longer than the
 * first-chunk / idle budget or the total deadline passes. `onStall` runs first (abort the request).
 */
export async function* watchdog<T>(
  source: AsyncIterable<T>,
  opts: { firstChunkMs?: number; idleMs?: number; totalMs?: number; onStall?: (e: ModelStallError) => void } = {}
): AsyncGenerator<T> {
  const firstChunkMs = opts.firstChunkMs ?? STREAM_FIRST_CHUNK_MS;
  const idleMs = opts.idleMs ?? STREAM_IDLE_MS;
  const totalMs = opts.totalMs ?? MODEL_TIMEOUT_MS;
  const it = source[Symbol.asyncIterator]();
  const started = Date.now();
  let gotFirst = false;
  let finished = false;
  try {
    for (;;) {
      const left = totalMs - (Date.now() - started);
      const step = gotFirst ? idleMs : firstChunkMs;
      const budget = Math.max(0, Math.min(step, left));
      const kind: ModelStallError['kind'] = left <= step ? 'total' : gotFirst ? 'idle' : 'first_chunk';
      const next = it.next();
      next.catch(() => {}); // a stalled read may reject after we gave up on it
      let timer: ReturnType<typeof setTimeout> | undefined;
      const stall = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new ModelStallError(kind, kind === 'total' ? totalMs : budget)), budget);
      });
      let res: IteratorResult<T>;
      try {
        res = await Promise.race([next, stall]);
      } catch (err) {
        if (err instanceof ModelStallError) opts.onStall?.(err);
        throw err;
      } finally {
        clearTimeout(timer);
      }
      if (res.done) {
        finished = true;
        return;
      }
      if (!gotFirst && (typeof res.value !== 'string' || res.value.length > 0)) gotFirst = true;
      yield res.value;
    }
  } finally {
    // Never await: return() on a stalled iterator can hang too.
    if (!finished) void Promise.resolve(it.return?.()).catch(() => {});
  }
}

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
 * Runs `fn` with an abort signal that fires after `ms` (or with `parent`), and rejects with a
 * ModelStallError at the deadline even if the request ignores the abort (see watchdog).
 */
export async function withDeadline<T>(ms: number, parent: AbortSignal | undefined, fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const ctl = new AbortController();
  const signal = parent ? anySignal(ctl.signal, parent) : ctl.signal;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const work = fn(signal);
  work.catch(() => {});
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const e = new ModelStallError('total', ms);
      ctl.abort(e);
      reject(e);
    }, ms);
  });
  try {
    return await Promise.race([work, deadline]);
  } finally {
    clearTimeout(timer);
  }
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
      const res = await withDeadline(MODEL_TIMEOUT_MS + 2_000, opts.abortSignal, (signal) =>
        generateText(callOptions(model, { ...opts, abortSignal: signal }) as Parameters<typeof generateText>[0])
      );
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
 * Stream text from `model`. Yields chunks; resolves usage at the end. Errors (including a
 * ModelStallError from the watchdog) surface from the iterator so the caller can decide whether a
 * retry is still possible (nothing emitted yet).
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
  const stallCtl = new AbortController();
  const signal = opts.abortSignal ? anySignal(stallCtl.signal, opts.abortSignal) : stallCtl.signal;
  const result = streamText({
    ...callOptions(opts.model, {
      system: opts.system,
      messages: opts.messages,
      abortSignal: signal,
      maxOutputTokens: opts.maxOutputTokens,
      thinking: opts.thinking,
    }),
    onError: () => {
      /* surfaced through textStream */
    },
  } as Parameters<typeof streamText>[0]);
  return {
    /** Model text, guarded by the stall watchdog (a stall aborts the request and throws ModelStallError). */
    textStream: watchdog(result.textStream as AsyncIterable<string>, { onStall: (e) => stallCtl.abort(e) }),
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
