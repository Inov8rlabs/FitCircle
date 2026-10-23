/**
 * Chat suite: each case streams through the production pieces — chatSystemMessages (cached
 * SYSTEM_PROMPT + grounding), streamFrom (exact AI SDK options), StreamGuard with
 * FitzyService.guard + SAFE_FALLBACK, splitMeta/parseMeta and FitzyService.resolveMeta (chips +
 * guarded actions). Only the primary chat model runs: a production fallback is a failure here.
 */
import { META_MARKER, growthNudgeAllowed, parseMeta, splitMeta } from '../../app/lib/fitzy/meta';
import { chatModel, streamFrom } from '../../app/lib/fitzy/models';
import { StreamGuard } from '../../app/lib/fitzy/stream-guard';
import { FitzyService, SAFE_FALLBACK, chatSystemMessages, withUserFirst } from '../../app/lib/services/fitzy-service';
import type { FitzyAction } from '../../app/lib/types/fitzy';

import { runChecks } from './checks';
import { groundingFor, type ChatCase, type Fixtures } from './fixtures';
import { classifyError, errorText, telemetry, withRetries, words, type ErrorClass, type Telemetry } from './util';

export const DEFAULT_MAX_WORDS = 200; // spec: "under ~170 words" (+ slack)
export const LIST_MAX_WORDS = 350; // spec: longer allowed when a plan/list was asked for

export interface ChatResult {
  case: string;
  cat: string;
  rep: number;
  tags: string[];
  model: string;
  ok: boolean;
  error: string | null;
  errorClass: ErrorClass | null;
  retries: ErrorClass[];
  ttftMs: number | null; // first model token
  firstEmitMs: number | null; // first guarded delta the user would see
  totalMs: number | null;
  raw: string;
  answer: string; // what the user sees (SAFE_FALLBACK on a trip)
  guardTripped: boolean;
  guardTripText: string | null; // the model's visible text that tripped the guard
  metaPresent: boolean;
  metaParsed: boolean;
  metaSchemaValid: boolean;
  metaIssues: string[];
  suggestions: string[];
  actions: FitzyAction[];
  words: number;
  maxWords: number;
  checks: Array<{ id: string; fail: string | null }>;
  telemetry: Telemetry | null;
  judge?: any;
}

/** Strict schema view of the raw meta block (production parseMeta is tolerant; this flags drift). */
function metaSchema(metaRaw: string | null): { parsed: boolean; valid: boolean; issues: string[] } {
  if (metaRaw == null) return { parsed: false, valid: false, issues: ['no meta marker'] };
  const tolerant = parseMeta(metaRaw);
  if (!tolerant.ok) return { parsed: false, valid: false, issues: ['meta JSON unparseable'] };
  const issues: string[] = [];
  let j: any = null;
  try {
    j = JSON.parse(metaRaw);
  } catch {
    issues.push('not strict JSON (fences/trailing text)');
    const s = metaRaw.replace(/```(?:json)?/gi, '');
    try {
      j = JSON.parse(s.slice(s.indexOf('{'), s.lastIndexOf('}') + 1).replace(/,\s*([}\]])/g, '$1'));
    } catch {
      j = {};
    }
  }
  if (!Array.isArray(j.suggestions)) issues.push('suggestions not an array');
  if (!Array.isArray(j.actions)) issues.push('actions not an array');
  const sugg = Array.isArray(j.suggestions) ? j.suggestions : [];
  if (sugg.length > 3) issues.push(`${sugg.length} suggestions (> 3)`);
  const badSugg = sugg.filter((s: unknown) => typeof s !== 'string' || !s.trim() || [...s.trim()].length > 40);
  if (badSugg.length) issues.push(`${badSugg.length} suggestion(s) invalid/over 40 chars`);
  const acts = Array.isArray(j.actions) ? j.actions : [];
  if (acts.length > 2) issues.push(`${acts.length} actions (> 2)`);
  if (acts.length > tolerant.actions.length) issues.push(`${acts.length - tolerant.actions.length} action(s) dropped by parseMeta`);
  // "not strict JSON" alone is tolerated by production; schema validity is about content.
  const valid = issues.filter((i) => !i.startsWith('not strict JSON')).length === 0;
  return { parsed: true, valid, issues };
}

async function runOnce(k: ChatCase, f: Fixtures, rep: number) {
  const persona = f.personas[k.persona];
  const growthAllowed = growthNudgeAllowed(k.message, null);
  const grounding = groundingFor(persona, { growthAllowed, circleId: persona.circle?.id });
  // withUserFirst: production prepends a synthetic user turn when the history starts with a Fitzy push tip.
  const turns = withUserFirst([...(k.history ?? []), { role: 'user' as const, content: k.message }]);
  const model = chatModel();
  const guard = new StreamGuard(FitzyService.guard, SAFE_FALLBACK);
  const t0 = Date.now();
  let ttft: number | null = null;
  let firstEmit: number | null = null;
  let raw = '';
  let error: unknown = null;
  let tele: Telemetry | null = null;
  try {
    const stream = streamFrom({ model, system: chatSystemMessages(grounding), messages: turns });
    for await (const chunk of stream.textStream) {
      if (chunk && ttft == null) ttft = Date.now() - t0;
      raw += chunk;
      // Production stops reading on a trip; we keep reading so the report can show what tripped.
      if (!guard.isTripped) {
        const ev = guard.push(chunk);
        if (firstEmit == null && ev.length) firstEmit = Date.now() - t0;
      }
    }
    const ev = guard.finish();
    if (firstEmit == null && ev.length) firstEmit = Date.now() - t0;
    const d = await stream.details();
    tele = telemetry(d.finishReason, d.usage, d.providerMetadata);
  } catch (err) {
    error = err;
  }
  const totalMs = Date.now() - t0;
  const errClass = error ? classifyError(error) : null;
  if (!error && !guard.emittedText && !guard.isTripped) {
    error = new Error('empty completion');
  }

  const tripped = guard.isTripped;
  const visible = splitMeta(raw).answer;
  const answer = error ? SAFE_FALLBACK : tripped ? SAFE_FALLBACK : guard.emittedText.trim();
  const metaRaw = splitMeta(raw).metaRaw;
  const schema = metaSchema(metaRaw);
  const resolved = FitzyService.resolveMeta(
    { userMessage: k.message, growthAllowed, circleId: persona.circle?.id },
    { answer, metaRaw: tripped ? null : metaRaw, tripped }
  );
  const maxWords = k.maxWords ?? (k.list ? LIST_MAX_WORDS : DEFAULT_MAX_WORDS);
  // Content checks look at the model's own visible text (what it said, even if the guard replaced it).
  const checked = error ? [] : runChecks(k.checks, visible, resolved.actions);

  const result: ChatResult = {
    case: k.id,
    cat: k.cat,
    rep,
    tags: k.tags ?? [],
    model,
    ok: !error,
    error: error ? errorText(error) : null,
    errorClass: error ? errClass ?? 'model' : null,
    retries: [],
    ttftMs: ttft,
    firstEmitMs: firstEmit,
    totalMs,
    raw,
    answer,
    guardTripped: tripped,
    guardTripText: tripped ? visible : null,
    metaPresent: raw.includes(META_MARKER),
    metaParsed: schema.parsed,
    metaSchemaValid: schema.valid,
    metaIssues: schema.issues,
    suggestions: resolved.suggestions,
    actions: resolved.actions,
    words: words(visible),
    maxWords,
    checks: checked,
    telemetry: tele,
  };
  return { ...result, retryClass: errClass === 'transient' || errClass === 'timeout' || errClass === 'auth' ? errClass : null };
}

export async function runChatCase(k: ChatCase, f: Fixtures, rep: number): Promise<ChatResult> {
  const r = await withRetries(() => runOnce(k, f, rep));
  const { retryClass: _drop, ...rest } = r;
  return rest;
}
