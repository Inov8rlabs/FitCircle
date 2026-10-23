/**
 * Structured-JSON suites — weekly plan (Pro, deep model), free preview (chat model), daily focus,
 * Sunday recap and memory extraction. Each runs the PRODUCTION request builder through the
 * production generateWithFallback (observing attempts) and the production parser/sanitiser.
 * Pass = primary model answered (no model fallback), finishReason != 'length', and the output
 * parsed into something usable without the static fallback.
 */
import { generateWithFallback, type AttemptInfo, type ModelCall } from '../../app/lib/fitzy/models';
import { focusPushCopy, lockScreenSafe, nudgeRequest, parseNudge, proteinIdeas, BODY_MAX, FOCUS_BODY_MAX, TITLE_MAX } from '../../app/lib/fitzy/push';
import { FitzyFocusService, focusRequest, recapRequest } from '../../app/lib/services/fitzy-focus-service';
import { FitzyMemoryService, extractRequest, parseExtraction } from '../../app/lib/services/fitzy-memory-service';
import { DEFAULT_PLAN_NOTE, parsePlanDraft, planRequest } from '../../app/lib/services/fitzy-plan-service';
import { FitzyService } from '../../app/lib/services/fitzy-service';
import type { FitzyMemoryItem } from '../../app/lib/types/fitzy';

import { groundingFor, personaPlan, type Fixtures } from './fixtures';
import { classifyError, errorText, telemetry, withRetries, type ErrorClass, type Telemetry } from './util';

export type StructuredKind = 'plan' | 'preview' | 'focus' | 'recap' | 'memory' | 'push_focus' | 'push_protein';

export interface StructuredResult {
  kind: StructuredKind;
  case: string;
  rep: number;
  model: string;
  ok: boolean; // primary answered, not truncated, parsed + usable
  primaryOk: boolean;
  fallbackModelUsed: string | null;
  finishReason: string | null;
  parsed: boolean;
  usable: boolean;
  error: string | null;
  errorClass: ErrorClass | null;
  retries: ErrorClass[];
  totalMs: number | null;
  telemetry: Telemetry | null;
  text: string;
  detail: Record<string, unknown>;
}

const guard = FitzyService.guard;

async function call(req: ModelCall & { primary: string }) {
  const attempts: AttemptInfo[] = [];
  let text = '';
  let error: unknown = null;
  try {
    text = (await generateWithFallback({ ...req, onAttempt: (a) => attempts.push(a) })).text;
  } catch (err) {
    error = err;
  }
  return { attempts, text, error };
}

type Evaluate = (text: string) => { parsed: boolean; usable: boolean; detail: Record<string, unknown> };

async function runOnce(kind: StructuredKind, id: string, rep: number, req: ModelCall & { primary: string }, evaluate: Evaluate) {
  const { attempts, text, error } = await call(req);
  const first = attempts[0];
  const primaryErr = first && !first.ok ? first.error ?? (first.finishReason === 'length' ? new Error('truncated structured output') : new Error('empty completion')) : error;
  const errClass = primaryErr ? classifyError(primaryErr) : null;
  // Evaluate the PRIMARY model's output when it produced one (even if truncated), so the report
  // shows what production would have parsed before falling over to the other model.
  const primaryText = first?.text ?? '';
  const ev = primaryText ? evaluate(primaryText) : { parsed: false, usable: false, detail: {} };
  const finishReason = first?.finishReason ?? null;
  const primaryOk = !!first?.ok;
  const res: StructuredResult = {
    kind,
    case: id,
    rep,
    model: req.primary,
    ok: primaryOk && finishReason !== 'length' && ev.parsed && ev.usable,
    primaryOk,
    fallbackModelUsed: attempts.length > 1 ? attempts[1].model : null,
    finishReason,
    parsed: ev.parsed,
    usable: ev.usable,
    error: primaryErr ? errorText(primaryErr) : error ? errorText(error) : null,
    errorClass: errClass,
    retries: [],
    totalMs: first?.ms ?? null,
    telemetry: first ? telemetry(first.finishReason, first.usage, first.providerMetadata) : null,
    text: primaryText || text,
    detail: ev.detail,
  };
  return { ...res, retryClass: errClass === 'transient' || errClass === 'timeout' || errClass === 'auth' ? errClass : null };
}

async function run(kind: StructuredKind, id: string, rep: number, req: () => ModelCall & { primary: string }, evaluate: Evaluate): Promise<StructuredResult> {
  const r = await withRetries(() => runOnce(kind, id, rep, req(), evaluate));
  const { retryClass: _drop, ...rest } = r;
  return rest;
}

const WEEK_OF = '2026-10-19';

export function planJobs(f: Fixtures, limit: number) {
  const cases = f.plan.slice(0, limit);
  const jobs: Array<(rep: number) => Promise<StructuredResult>> = [];
  for (const c of cases) {
    const persona = f.personas[c.persona];
    const grounding = groundingFor(persona, { growthAllowed: false });
    for (const kind of ['plan', 'preview'] as const) {
      jobs.push((rep) =>
        run(kind, c.id, rep, () => planRequest(kind, WEEK_OF, c.goal, grounding), (text) => {
          const d = parsePlanDraft(text, guard, c.goal);
          const proposed = Array.isArray(d.json?.commitments) ? d.json.commitments : [];
          const keptTitles = new Set(d.commitments.map((x) => x.title));
          const dropped = proposed.filter((x: any) => !keptTitles.has(typeof x?.title === 'string' ? x.title.trim() : '')).map((x: any) => String(x?.title ?? '(untitled)'));
          return {
            parsed: !!d.json,
            usable: d.commitments.length >= 3,
            detail: {
              proposed: proposed.length,
              kept: d.commitments.length,
              dropped,
              goal: d.goal,
              goalDefaulted: d.goal !== (typeof d.json?.goal === 'string' ? d.json.goal.trim().slice(0, 80) : null),
              noteDefaulted: kind === 'plan' ? d.note === DEFAULT_PLAN_NOTE : undefined,
              commitments: d.commitments.map((x) => `${x.kind}: ${x.title} (${x.target.count}/wk)`),
            },
          };
        })
      );
    }
  }
  return jobs;
}

export function focusJobs(f: Fixtures) {
  const jobs: Array<(rep: number) => Promise<StructuredResult>> = [];
  for (const id of f.focus.personas) {
    const persona = f.personas[id];
    const plan = personaPlan(persona, WEEK_OF);
    const grounding = groundingFor(persona, { growthAllowed: false });
    jobs.push((rep) =>
      run('focus', id, rep, () => focusRequest(f.focus.date, !!plan, grounding), (text) => {
        const focus = FitzyFocusService.focusFromText(text, f.focus.date, persona.tier);
        const looksJson = /\{[\s\S]*\}/.test(text);
        return { parsed: looksJson, usable: !!focus, detail: focus ? { headline: focus.headline, body: focus.body, cta: focus.cta.label, kind: focus.kind } : { reason: looksJson ? 'failed length/guard validation' : 'no JSON' } };
      })
    );
    if (persona.tier === 'pro' && plan) {
      jobs.push((rep) =>
        run('recap', id, rep, () => recapRequest(plan, grounding), (text) => {
          const focus = FitzyFocusService.recapFromText(text, f.focus.recapDate, persona.tier);
          const looksJson = /\{[\s\S]*\}/.test(text);
          return { parsed: looksJson, usable: !!focus, detail: focus ? { headline: focus.headline, body: focus.body } : { reason: looksJson ? 'failed length/guard validation' : 'no JSON' } };
        })
      );
    }
  }
  return jobs;
}

export function memoryJobs(f: Fixtures) {
  return f.memory.map((m) => {
    const persona = f.personas[m.persona];
    const known: FitzyMemoryItem[] = (persona.memory ?? []).map((text, i) => ({ id: `m${i}`, text, kind: 'preference' as const, createdAt: '2026-10-01T00:00:00Z' }));
    return (rep: number) =>
      run('memory', m.id, rep, () => extractRequest(known, m.userMessage, m.answer), (text) => {
        const parsed = parseExtraction(text);
        const items = Array.isArray((parsed as any)?.items) ? (parsed as any).items : null;
        const stored = FitzyMemoryService.sanitize(parsed, known, guard);
        const expectationMet = m.expect === 'any' ? true : m.expect === 'some' ? stored.length > 0 : stored.length === 0;
        return {
          parsed: !!items,
          usable: !!items,
          detail: { proposed: items?.map((i: any) => i?.text) ?? null, stored: stored.map((s) => `${s.kind}: ${s.text}`), expect: m.expect, expectationMet, excludedByCode: (items?.length ?? 0) - stored.length },
        };
      });
  });
}

/**
 * Push suite (docs/FITZY_PUSH_NOTIFICATIONS.md): the production daily-focus request → focusFromText →
 * focusPushCopy (lock-screen copy), and the production protein-nudge request → parseNudge. Usable =
 * the AI text survived every production check (no template fallback) and the lock-screen copy is
 * within limits and free of health values.
 */
export function pushJobs(f: Fixtures) {
  const jobs: Array<(rep: number) => Promise<StructuredResult>> = [];
  const within = (t: string, b: string, max = BODY_MAX) => [...t].length <= TITLE_MAX && [...b].length <= max && lockScreenSafe(`${t}\n${b}`);
  for (const id of f.focus.personas) {
    const persona = f.personas[id];
    const plan = personaPlan(persona, WEEK_OF);
    const grounding = groundingFor(persona, { growthAllowed: false });
    jobs.push((rep) =>
      run('push_focus', id, rep, () => focusRequest(f.focus.date, !!plan, grounding), (text) => {
        const focus = FitzyFocusService.focusFromText(text, f.focus.date, persona.tier);
        if (!focus) return { parsed: /\{[\s\S]*\}/.test(text), usable: false, detail: { reason: 'focus failed validation' } };
        const copy = focusPushCopy(focus, guard, 'ai');
        const usedCard = copy.body !== 'One small, doable idea for today is waiting for you.';
        return { parsed: true, usable: within(copy.title, copy.body, FOCUS_BODY_MAX) && usedCard, detail: { title: copy.title, body: copy.body, usedCard, card: `${focus.headline} — ${focus.body}` } };
      })
    );
    jobs.push((rep) =>
      run('push_protein', id, rep, () => nudgeRequest(grounding, proteinIdeas(persona.diet ?? 'none', persona.allergens ?? [], 3, `${id}:${rep}`)), (text) => {
        const copy = parseNudge(text, guard, persona.allergens ?? []);
        return { parsed: /\{[\s\S]*\}/.test(text), usable: !!copy && within(copy.title, copy.body), detail: copy ? { title: copy.title, body: copy.body } : { reason: 'rejected by parseNudge (length / lock-screen / judging / guard / allergen)', raw: text.slice(0, 300) } };
      })
    );
  }
  return jobs;
}
