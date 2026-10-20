/** Small shared helpers for the Fitzy live-model eval: pool, retries, error classes, stats, telemetry. */

export type ErrorClass = 'auth' | 'transient' | 'timeout' | 'model';

/** Unwrap AI SDK RetryError / cause chains to the most specific error. */
function root(err: unknown): any {
  let e: any = err;
  for (let i = 0; i < 4 && e; i++) {
    const next = e.lastError ?? (Array.isArray(e.errors) ? e.errors.at(-1) : undefined) ?? e.cause;
    if (!next || next === e) break;
    if (typeof next === 'object' && ('statusCode' in next || 'name' in next)) e = next;
    else break;
  }
  return e;
}

/**
 * auth      → credentials problem: abort the whole run.
 * transient → gateway 429/5xx, socket/DNS errors: retried, never counted as a model failure.
 * timeout   → production MODEL_TIMEOUT_MS hit: retried once, counted if it persists.
 * model     → everything else (bad request, empty/truncated output, …): a real failure.
 */
export function classifyError(err: unknown): ErrorClass {
  const all = [err, root(err)] as any[];
  const text = all.map((e) => `${e?.name ?? ''} ${e?.message ?? e ?? ''} ${e?.type ?? ''}`).join(' ');
  const status = all.map((e) => e?.statusCode ?? e?.status ?? e?.response?.status).find((s) => typeof s === 'number');
  if (status === 401 || status === 403 || /GatewayAuthenticationError|Unauthenticated|authentication|invalid api key|oidc/i.test(text)) return 'auth';
  if (/TimeoutError|AbortError|timed?\s?out|aborted/i.test(text)) return 'timeout';
  if (status === 429 || (typeof status === 'number' && status >= 500) || /RateLimit|InternalServer|ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|UND_ERR|fetch failed|socket hang up|network|overloaded/i.test(text)) return 'transient';
  return 'model';
}

export const errorText = (err: unknown) => {
  const r = root(err);
  const s = `${r?.name ?? 'Error'}: ${r?.message ?? String(err)}`;
  return s.length > 300 ? s.slice(0, 300) + '…' : s;
};

export class AuthAbort extends Error {}

/**
 * Run `fn`; when it reports a transient/timeout error, retry with backoff. `fn` returns
 * `{ retryable?: ErrorClass }` to ask for a retry (so model failures are never retried).
 */
export async function withRetries<T extends { retryClass?: ErrorClass | null }>(fn: () => Promise<T>, opts: { transient?: number; timeout?: number } = {}): Promise<T & { retries: Array<ErrorClass> }> {
  const max = { transient: opts.transient ?? 2, timeout: opts.timeout ?? 1 };
  const used = { transient: 0, timeout: 0 };
  const retries: ErrorClass[] = [];
  for (;;) {
    const res = await fn();
    const c = res.retryClass;
    if (c === 'auth') throw new AuthAbort('Gateway authentication failed');
    if ((c === 'transient' || c === 'timeout') && used[c] < max[c]) {
      used[c]++;
      retries.push(c);
      await new Promise((r) => setTimeout(r, 2000 * (used.transient + used.timeout)));
      continue;
    }
    return { ...res, retries };
  }
}

export async function pool<I, O>(items: I[], n: number, fn: (item: I, i: number) => Promise<O>): Promise<O[]> {
  let next = 0;
  const out: O[] = new Array(items.length);
  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(n, items.length)) }, async () => {
      while (next < items.length) {
        const k = next++;
        out[k] = await fn(items[k], k);
      }
    })
  );
  return out;
}

export const median = (xs: Array<number | null | undefined>) => {
  const s = xs.filter((x): x is number => typeof x === 'number').sort((a, b) => a - b);
  return s.length ? s[Math.floor((s.length - 1) / 2)] : null;
};
export const p90 = (xs: Array<number | null | undefined>) => {
  const s = xs.filter((x): x is number => typeof x === 'number').sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor(0.9 * s.length))] : null;
};
export const mean = (xs: Array<number | null | undefined>) => {
  const s = xs.filter((x): x is number => typeof x === 'number');
  return s.length ? s.reduce((a, b) => a + b, 0) / s.length : null;
};
export const sum = (xs: Array<number | null | undefined>) => xs.reduce<number>((a, b) => a + (typeof b === 'number' ? b : 0), 0);
export const words = (s: string) => (s.match(/\S+/g) || []).length;

/** Normalised telemetry from AI SDK usage + Vercel AI Gateway provider metadata. */
export interface Telemetry {
  finishReason: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  reasoningTokens: number | null;
  cachedInputTokens: number | null;
  costUsd: number | null;
  provider: string | null;
}

export function telemetry(finishReason: unknown, usage: any, providerMetadata: any): Telemetry {
  const gw = providerMetadata?.gateway ?? {};
  const cost = gw.cost ?? gw.marketCost;
  const num = (x: unknown) => (x == null || x === '' || Number.isNaN(Number(x)) ? null : Number(x));
  return {
    finishReason: typeof finishReason === 'string' ? finishReason : null,
    inputTokens: num(usage?.inputTokens),
    outputTokens: num(usage?.outputTokens),
    reasoningTokens: num(usage?.outputTokenDetails?.reasoningTokens ?? usage?.reasoningTokens),
    cachedInputTokens: num(usage?.inputTokenDetails?.cacheReadTokens ?? usage?.cachedInputTokens),
    costUsd: num(cost),
    provider: gw.routing?.finalProvider ?? gw.routing?.resolvedProvider ?? null,
  };
}

export const fmt = (x: number | null | undefined, d = 0) => (x == null ? '–' : x.toFixed(d));
export const pct = (x: number | null | undefined) => (x == null ? '–' : `${(x * 100).toFixed(0)}%`);
export const usd = (x: number | null | undefined) => (x == null ? '–' : `$${x < 0.01 ? x.toFixed(5) : x.toFixed(3)}`);
