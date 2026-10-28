/**
 * Chat suite: each case runs the production streaming turn — chatSystemMessages (cached
 * SYSTEM_PROMPT + grounding) and FitzyService.runModelStream (streamFrom with the stall watchdog,
 * StreamGuard + word cap, one retry on the other model, deterministic fallback answer), then
 * splitMeta/parseMeta and FitzyService.resolveMeta (chips + guarded actions). What is scored is
 * what the user would see. Retries are reported per reply (`attempts`); a reply that needed the
 * deterministic fallback (`source: canned`) counts as a model failure.
 */
import { META_MARKER, growthNudgeAllowed, parseMeta, splitMeta } from '../../app/lib/fitzy/meta';
import { chatModel } from '../../app/lib/fitzy/models';
import { FitzyService, SAFE_FALLBACK, chatMaxOutputTokens, chatSystemMessages, chatThinking, withUserFirst, type StreamAttempt } from '../../app/lib/services/fitzy-service';
import type { FitzyAction } from '../../app/lib/types/fitzy';

import { runChecks } from './checks';
import { groundingFor, type ChatCase, type Fixtures } from './fixtures';
import { classifyError, errorText, telemetry, withRetries, words, type ErrorClass, type Telemetry } from './util';
import { hostSuspendedDuring } from './util';

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
  /** model | partial (kept sentences after a mid-stream failure) | canned (no model text). */
  source: 'model' | 'partial' | 'canned' | null;
  /** Every model attempt (a retry follows a stall / error / empty reply). */
  attempts: Array<{ model: string; ok: boolean; ms: number; error: string | null }>;
  /** The word cap trimmed the visible answer. */
  capped: boolean;
  /** Words the model wrote before any cap (info). */
  rawWords: number;
  /** The reply had no usable META; the chips came from the META-only recovery call. */
  metaRecovered: boolean;
  /** Emoji (grapheme clusters) in the answer the user sees, and in chips + action labels. */
  answerEmoji: number;
  chipEmoji: number;
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

const SEGMENTER = new Intl.Segmenter('en', { granularity: 'grapheme' });
/** Emoji as the user sees them (one per grapheme cluster, so 🧘‍♀️ counts once). */
export const emojiCount = (s: string) => [...SEGMENTER.segment(s)].filter((g) => /\p{Extended_Pictographic}/u.test(g.segment)).length;

async function runOnce(k: ChatCase, f: Fixtures, rep: number) {
  const persona = f.personas[k.persona];
  const growthAllowed = growthNudgeAllowed(k.message, null);
  const grounding = groundingFor(persona, { growthAllowed, circleId: persona.circle?.id });
  // withUserFirst: production prepends a synthetic user turn when the history starts with a Fitzy push tip.
  const turns = withUserFirst([...(k.history ?? []), { role: 'user' as const, content: k.message }]);
  const model = chatModel();
  const context = k.context ?? null;
  const t0 = Date.now();
  let ttft: number | null = null;
  let firstEmit: number | null = null;
  let error: unknown = null;
  let tele: Telemetry | null = null;
  const attempts: StreamAttempt[] = [];
  let run: Awaited<ReturnType<typeof FitzyService.runModelStream>> | null = null;
  try {
    run = await FitzyService.runModelStream(
      { system: chatSystemMessages(grounding, context), turns, maxOutputTokens: chatMaxOutputTokens(context), thinking: chatThinking(context), context, userMessage: k.message },
      (events) => {
        if (events.length && firstEmit == null) firstEmit = Date.now() - t0;
      },
      undefined,
      (a) => {
        attempts.push(a);
      }
    );
    const okAttempt = attempts.find((a) => a.ok);
    if (okAttempt?.details) {
      const d = await okAttempt.details();
      tele = telemetry(d.finishReason, d.usage, d.providerMetadata);
    }
  } catch (err) {
    error = err;
  }
  const totalMs = Date.now() - t0;
  ttft = firstEmit; // production streams through the guard: first released sentence
  if (!error && run?.source === 'canned') error = new Error(`no model text after ${attempts.length} attempt(s): ${attempts.map((a) => errorText(a.error)).join(' | ')}`);
  const errClass = error ? classifyError(error) : null;

  const raw = run?.rawText ?? '';
  const tripped = !!run?.tripped;
  const visible = splitMeta(raw).answer;
  const answer = run?.answer ?? SAFE_FALLBACK;
  const metaRaw = run?.metaRaw ?? null;
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
    metaPresent: !!metaRaw || (run?.source === 'model' && raw.includes(META_MARKER)),
    metaParsed: schema.parsed,
    metaSchemaValid: schema.valid,
    metaIssues: schema.issues,
    suggestions: resolved.suggestions,
    actions: resolved.actions,
    words: words(tripped ? visible : answer),
    rawWords: words(visible),
    maxWords,
    checks: checked,
    telemetry: tele,
    source: run?.source ?? null,
    attempts: attempts.map((a) => ({ model: a.model, ok: a.ok, ms: a.ms, error: a.error ? errorText(a.error) : null })),
    capped: !!run?.capped,
    metaRecovered: !!run?.metaRecovered,
    answerEmoji: emojiCount(answer),
    chipEmoji: emojiCount([...resolved.suggestions, ...resolved.actions.map((a) => a.label)].join(' ')),
  };
  return { ...result, retryClass: errClass === 'transient' || errClass === 'timeout' || errClass === 'auth' ? errClass : null };
}

export async function runChatCase(k: ChatCase, f: Fixtures, rep: number): Promise<ChatResult & { hostSuspended: number }> {
  for (let hostSuspended = 0; ; hostSuspended++) {
    const t0 = Date.now();
    const r = await withRetries(() => runOnce(k, f, rep));
    // The eval host slept during this reply: not a model result, run it again (at most 3 times).
    if (hostSuspendedDuring(t0, Date.now()) && hostSuspended < 3) continue;
    const { retryClass: _drop, ...rest } = r;
    return { ...rest, hostSuspended };
  }
}
