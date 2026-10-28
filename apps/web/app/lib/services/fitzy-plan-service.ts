/**
 * Fitzy weekly plans (docs/FITZY_V2_SPEC.md §3.5).
 *  - Pro: Sonnet writes 3–5 commitments for the week (Monday-based), check-offs per day.
 *  - Free: a Haiku teaser (goal + first commitment + "N more"), cached for the week as an
 *    `is_preview` row; the rest stays behind the paywall.
 * Commitments obey every Fitzy prohibition: each text passes the output guard, and anything
 * that reads like a calorie/weight target or restriction is dropped; a static safe plan fills in.
 */
import { randomUUID } from 'node:crypto';

import { mondayOf } from '../fitzy/dates';
import { fitBody } from '../fitzy/text';
import { chatModel, deepModel, generateWithFallback, systemMessages, type ModelCall } from '../fitzy/models';
import { addDays } from '../streaks/streak-calculator';
import { createAdminSupabase } from '../supabase-admin';
import { stripEmoji } from '../text/strip-emoji';
import type { CommitmentKind, FitzyCommitment, FitzyPlan, FitzyPlanPreview } from '../types/fitzy';

import { FitzyLockedError, FitzyNotFoundError } from './fitzy-conversation-service';

const KINDS: readonly CommitmentKind[] = ['move', 'eat', 'hydrate', 'sleep', 'circle', 'mind'];
/** Beyond the guard: plan items must never carry numeric food/weight targets or restriction. */
const PLAN_UNSAFE = /\b(calori\w*|kcal|macros?|deficit|weigh(?:s|ed|ing|-?ins?)?|weight(?!s\b|ed\b|lifting|\s+training)\w*|(?:lbs?|pounds?|kgs?|kilos?)(?!\s+(?:dumbbells?|kettlebells?|bells?|weights?|plates?|barbell|bar)\b)|body[\s-]?fat|bmi|no\s+(?:sugar|carbs?|snacks?|dessert)|cut\s+out|avoid|restrict\w*|fast(?:ing)?|skip\w*\s+(?:\w+\s+){0,2}?(?:meals?|breakfast|lunch|dinner|snacks?|eating|food)|only\s+eat|less\s+food|eat\s+less)\b/i;
/** "Nothing to cut out" / "no need to avoid anything" is the opposite of restriction. */
const PLAN_NEGATED = /\b(?:nothing|no\s+need|not|never|without)\s+(?:\w+\s+){0,2}?(?:to\s+)?(?:cut(?:ting)?\s+out|avoid(?:ing)?|restrict(?:ing)?|skip(?:ping)?)\b(?:\s+anything)?/gi;
const planUnsafe = (text: string) => PLAN_UNSAFE.test(text.replace(PLAN_NEGATED, ' '));

interface PlanRow {
  id: string;
  user_id: string;
  week_of: string;
  goal: string;
  commitments: FitzyCommitment[] | null;
  note: string;
  model: string | null;
  is_preview: boolean;
  created_at: string;
  updated_at: string;
}

export const PLAN_PROMPT = [
  'You are Fitzy, a warm, body-neutral and food-neutral fitness + nutrition coach, writing a weekly plan.',
  'Write 3 to 5 small, kind, doable commitments for this week based on the user goal and context.',
  'Each commitment: kind (move|eat|hydrate|sleep|circle|mind), title ≤ 48 chars, detail ≤ 140 chars,',
  'target count 1–7 per week. Examples: "3 walks of 15 min", "Protein at breakfast 4 days",',
  '"Check in with your circle daily", "Lights out by 11 on 3 nights".',
  'NEVER set calorie, macro, weight or body-composition targets; never restrict, skip or replace meals;',
  'never label foods good/bad; never promise outcomes or rates. Add foods and habits, never take away.',
  'Also write goal (≤ 80 chars, positive, behaviour-based) and note (≤ 200 chars, encouraging).',
  'Plain text only: never use emoji or decorative symbols in any field.',
  'Reply with ONLY JSON: {"goal":"…","note":"…","commitments":[{"kind":"move","title":"…","detail":"…","count":3}]}',
].join('\n');

export const FALLBACK_COMMITMENTS: Array<Omit<FitzyCommitment, 'id' | 'doneDates'>> = [
  { kind: 'move', title: '3 walks of 15 minutes', detail: 'Any pace, any time of day. Fresh air counts double for your mood.', target: { count: 3, per: 'week' } },
  { kind: 'eat', title: 'Protein at breakfast 4 days', detail: 'Eggs, yogurt, beans or tofu: whatever you enjoy.', target: { count: 4, per: 'week' } },
  { kind: 'sleep', title: 'Lights out by 11 on 3 nights', detail: 'A calm wind-down helps tomorrow feel easier.', target: { count: 3, per: 'week' } },
];

const cp = (s: string) => [...s].length;

function looseJson(text: string): any {
  const m = text.replace(/```(?:json)?/gi, '').match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    return JSON.parse(m[0].replace(/,\s*([}\]])/g, '$1'));
  } catch {
    return null;
  }
}

export function rowToPlan(r: PlanRow): FitzyPlan {
  return { id: r.id, weekOf: r.week_of, goal: r.goal, note: r.note, commitments: r.commitments ?? [], createdAt: r.created_at };
}

/** Model JSON → safe commitments (guard + plan rules + limits). */
export function sanitizeCommitments(raw: unknown, guard: (t: string) => boolean): FitzyCommitment[] {
  const list = Array.isArray((raw as any)?.commitments) ? (raw as any).commitments : [];
  const out: FitzyCommitment[] = [];
  for (const c of list) {
    const kind = KINDS.includes(c?.kind) ? (c.kind as CommitmentKind) : null;
    // stripEmoji: server-side backstop to the prompt's no-emoji rule (titles show in the app and push).
    const title = typeof c?.title === 'string' ? stripEmoji(c.title.trim()) : '';
    const rawDetail = typeof c?.detail === 'string' ? stripEmoji(c.detail.trim()) : '';
    // Trim an over-long detail at a sentence end (models overshoot 140 often); '' is allowed.
    const detail = rawDetail ? fitBody(rawDetail, 140) : '';
    const count = Math.round(Number(c?.count ?? c?.target?.count));
    if (!kind || !title || cp(title) > 48 || detail === null || !(count >= 1 && count <= 7)) continue;
    const text = `${title}. ${detail}`;
    if (guard(text) || planUnsafe(text)) continue;
    out.push({ id: randomUUID(), kind, title, detail, target: { count, per: 'week' }, doneDates: [] });
    if (out.length >= 5) break;
  }
  return out;
}

const safeText = (s: unknown, max: number, guard: (t: string) => boolean, fallback: string) => {
  const t = typeof s === 'string' ? stripEmoji(s.trim()).slice(0, max) : '';
  return t && !guard(t) && !planUnsafe(t) ? t : fallback;
};

export const DEFAULT_PLAN_GOAL = 'Feel good and stay consistent this week';
export const DEFAULT_PLAN_NOTE = 'Small steps, every day. You have got this.';

/** The model call for a Pro weekly plan (deep model) or a free teaser (chat model). */
export function planRequest(kind: 'plan' | 'preview', weekOf: string, goal: string | null, grounding: string): ModelCall & { primary: string } {
  return {
    primary: kind === 'plan' ? deepModel() : chatModel(),
    system: systemMessages(PLAN_PROMPT, grounding),
    messages: [{ role: 'user', content: `Week of ${weekOf}. My goal: ${goal?.trim() || 'help me pick one'}` }],
    maxOutputTokens: kind === 'plan' ? 900 : 600,
    thinking: false,
  };
}

/** Model text → parsed JSON (or null), safe commitments, goal and note (defaults when unsafe/missing). */
export function parsePlanDraft(text: string, guard: (t: string) => boolean, goal: string | null) {
  const json = looseJson(text);
  return {
    json,
    commitments: sanitizeCommitments(json, guard),
    goal: safeText(json?.goal, 80, guard, goal?.trim() || DEFAULT_PLAN_GOAL),
    note: safeText(json?.note, 200, guard, DEFAULT_PLAN_NOTE),
  };
}

export class FitzyPlanService {
  static async row(userId: string, weekOf: string): Promise<PlanRow | null> {
    const { data, error } = await createAdminSupabase().from('fitzy_plans').select('*').eq('user_id', userId).eq('week_of', weekOf).maybeSingle();
    if (error) throw error;
    return (data as PlanRow | null) ?? null;
  }

  /** The user's real (non-preview) plan for the week containing `today`. */
  static async current(userId: string, today: string): Promise<FitzyPlan | null> {
    const row = await this.row(userId, mondayOf(today));
    return row && !row.is_preview ? rowToPlan(row) : null;
  }

  /** "3 walks of 15 minutes: 2 of 3 done; …" for grounding. */
  static progressLine(plan: FitzyPlan | null): string | null {
    if (!plan || !plan.commitments.length) return null;
    return plan.commitments.map((c) => `${c.title}: ${c.doneDates.length} of ${c.target.count} done`).join('; ');
  }

  private static async upsert(userId: string, weekOf: string, cols: Partial<PlanRow>): Promise<PlanRow> {
    const now = new Date().toISOString();
    const supabase = createAdminSupabase();
    const existing = await this.row(userId, weekOf);
    if (existing) {
      const { data, error } = await supabase.from('fitzy_plans').update({ ...cols, updated_at: now }).eq('id', existing.id).select('*');
      if (error) throw error;
      return ((data ?? []) as PlanRow[])[0];
    }
    const { data, error } = await supabase
      .from('fitzy_plans')
      .insert({ user_id: userId, week_of: weekOf, goal: '', note: '', commitments: [], is_preview: false, created_at: now, updated_at: now, ...cols })
      .select('*')
      .single();
    if (error) throw error;
    return data as PlanRow;
  }

  /** Pro: generate (or regenerate) this week's plan with the deep model. */
  static async create(userId: string, today: string, goal: string | null, grounding: string, guard: (t: string) => boolean): Promise<FitzyPlan> {
    const weekOf = mondayOf(today);
    let commitments: FitzyCommitment[] = [];
    let planGoal = goal?.trim() || DEFAULT_PLAN_GOAL;
    let note = DEFAULT_PLAN_NOTE;
    let model: string | null = null;
    try {
      const res = await generateWithFallback(planRequest('plan', weekOf, goal, grounding));
      model = res.model;
      ({ commitments, goal: planGoal, note } = parsePlanDraft(res.text, guard, goal));
    } catch (err) {
      console.error('[FitzyPlan] generation failed:', (err as any)?.message ?? err);
    }
    if (commitments.length < 3) {
      const have = new Set(commitments.map((c) => c.kind));
      for (const f of FALLBACK_COMMITMENTS) {
        if (commitments.length >= 3) break;
        if (!have.has(f.kind)) commitments.push({ ...f, id: randomUUID(), doneDates: [] });
      }
    }
    const row = await this.upsert(userId, weekOf, { goal: planGoal, note, commitments, model, is_preview: false });
    return rowToPlan(row);
  }

  /** Free: the cached teaser for this week (generated with the chat model on first ask). */
  static async preview(userId: string, today: string, goal: string | null, grounding: string, guard: (t: string) => boolean): Promise<FitzyPlanPreview> {
    const weekOf = mondayOf(today);
    const cached = await this.row(userId, weekOf);
    if (cached && cached.is_preview && (cached.commitments ?? []).length) return toPreview(rowToPlan(cached));
    if (cached && !cached.is_preview) return toPreview(rowToPlan(cached)); // e.g. lapsed Pro: tease their own plan
    let commitments: FitzyCommitment[] = [];
    let planGoal = goal?.trim() || DEFAULT_PLAN_GOAL;
    let model: string | null = null;
    try {
      const res = await generateWithFallback(planRequest('preview', weekOf, goal, grounding));
      model = res.model;
      ({ commitments, goal: planGoal } = parsePlanDraft(res.text, guard, goal));
    } catch (err) {
      console.error('[FitzyPlan] preview failed:', (err as any)?.message ?? err);
    }
    if (commitments.length < 3) commitments = FALLBACK_COMMITMENTS.map((f) => ({ ...f, id: randomUUID(), doneDates: [] }));
    const row = await this.upsert(userId, weekOf, { goal: planGoal, note: '', commitments, model, is_preview: true });
    return toPreview(rowToPlan(row));
  }

  /** Pro: check a commitment off (or undo) for a date inside the plan's week. */
  static async check(userId: string, commitmentId: string, date: string, done: boolean, today: string, isPro: boolean): Promise<FitzyPlan> {
    if (!isPro) throw new FitzyLockedError('weekly_plan');
    const { data, error } = await createAdminSupabase().from('fitzy_plans').select('*').eq('user_id', userId).eq('is_preview', false);
    if (error) throw error;
    const rows = ((data ?? []) as PlanRow[]).sort((a, b) => b.week_of.localeCompare(a.week_of));
    const row = rows.find((r) => (r.commitments ?? []).some((c) => c.id === commitmentId));
    if (!row) throw new FitzyNotFoundError('Commitment');
    if (date < row.week_of || date > addDays(row.week_of, 6)) throw Object.assign(new Error('Date is outside this plan week'), { code: 'VALIDATION_ERROR' });
    if (date > addDays(today, 1)) throw Object.assign(new Error('Cannot check off a future day'), { code: 'VALIDATION_ERROR' });
    const commitments = (row.commitments ?? []).map((c) => {
      if (c.id !== commitmentId) return c;
      const set = new Set(c.doneDates);
      if (done) set.add(date);
      else set.delete(date);
      return { ...c, doneDates: [...set].sort() };
    });
    const { data: up, error: upErr } = await createAdminSupabase()
      .from('fitzy_plans')
      .update({ commitments, updated_at: new Date().toISOString() })
      .eq('id', row.id)
      .select('*');
    if (upErr) throw upErr;
    return rowToPlan(((up ?? []) as PlanRow[])[0]);
  }
}

export function toPreview(plan: FitzyPlan): FitzyPlanPreview {
  const [first, ...rest] = plan.commitments;
  return { goal: plan.goal, firstCommitment: { ...first, doneDates: [] }, moreCount: rest.length };
}
