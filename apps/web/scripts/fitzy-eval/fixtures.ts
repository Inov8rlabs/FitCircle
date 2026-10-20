/**
 * Fixture loading + persona → grounding, built with the PRODUCTION builders
 * (app/lib/fitzy/grounding.ts) in the same block order FitzyService.buildContext uses.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import {
  assembleGrounding,
  bodyCompBlock,
  circleBlock,
  extrasLines,
  foodBlock,
  plateScoreBlock,
  prefsBlock,
  weightTrendBlock,
  workoutBlock,
  type BodyCompGrounding,
  type WeightTrend,
} from '../../app/lib/fitzy/grounding';
import { FitzyPlanService } from '../../app/lib/services/fitzy-plan-service';
import type { CommitmentKind, FitzyPlan, FitzyTier } from '../../app/lib/types/fitzy';

export interface Persona {
  tier: FitzyTier;
  firstName?: string;
  streakDays?: number;
  food?: { days: number; kcal: number; protein: number; carbs: number; fat: number } | null;
  diet?: string;
  allergens?: string[];
  workouts?: { count: number; minutes: number; types: string[] } | null;
  weightTrend?: WeightTrend;
  plateScore?: number;
  circle?: { id: string; name?: string; challenge?: { name: string; description?: string } | null };
  bodyComp?: BodyCompGrounding;
  plan?: { goal: string; commitments: Array<{ kind: CommitmentKind; title: string; count: number; done: number }> };
  memory?: string[];
}

export interface ChatCase {
  id: string;
  cat: string;
  persona: string;
  message: string;
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
  tags?: string[];
  checks?: string[];
  list?: boolean;
  maxWords?: number;
  /** Default true: a correct reply must never trip the output guard. */
  expect_safe_reply?: boolean;
  notes?: string;
}

export interface Fixtures {
  personas: Record<string, Persona>;
  chat: ChatCase[];
  plan: Array<{ id: string; persona: string; goal: string | null }>;
  focus: { date: string; recapDate: string; personas: string[] };
  memory: Array<{ id: string; persona: string; userMessage: string; answer: string; expect: 'some' | 'none' | 'any' }>;
}

export const FIXTURES_PATH = path.join(__dirname, 'fixtures', 'cases.json');

export function loadFixtures(file = FIXTURES_PATH): Fixtures {
  const f = JSON.parse(readFileSync(file, 'utf8')) as Fixtures;
  for (const c of f.chat) if (!f.personas[c.persona]) throw new Error(`chat case ${c.id}: unknown persona ${c.persona}`);
  for (const c of f.plan) if (!f.personas[c.persona]) throw new Error(`plan case ${c.id}: unknown persona ${c.persona}`);
  return f;
}

/** The persona's current-week plan as production stores it (for progressLine + recap). */
export function personaPlan(p: Persona, weekOf: string): FitzyPlan | null {
  if (!p.plan) return null;
  const dates = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(`${weekOf}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + i);
    return d.toISOString().slice(0, 10);
  });
  return {
    id: 'eval-plan',
    weekOf,
    goal: p.plan.goal,
    note: '',
    createdAt: `${weekOf}T00:00:00Z`,
    commitments: p.plan.commitments.map((c, i) => ({
      id: `eval-c${i}`,
      kind: c.kind,
      title: c.title,
      detail: '',
      target: { count: c.count, per: 'week' as const },
      doneDates: dates.slice(0, c.done),
    })),
  };
}

/** Same blocks, same order, same wording as FitzyService.buildContext + grounding(). */
export function groundingFor(p: Persona, opts: { growthAllowed?: boolean; circleId?: string; weekOf?: string } = {}): string {
  const parts: string[] = [];
  parts.push(foodBlock(p.food ?? null));
  const prefs = prefsBlock(p.diet ?? 'none', p.allergens ?? []);
  if (prefs) parts.push(prefs);
  parts.push(workoutBlock(p.workouts ?? null));
  if (p.weightTrend) parts.push(weightTrendBlock(p.weightTrend));
  if (typeof p.plateScore === 'number') parts.push(plateScoreBlock(p.plateScore));
  if (opts.circleId && p.circle) {
    const line = circleBlock(p.circle.name, p.circle.challenge ?? null);
    if (line) parts.push(line);
  }
  if (p.bodyComp) parts.push(bodyCompBlock(p.bodyComp));

  const plan = personaPlan(p, opts.weekOf ?? '2026-10-19');
  const line = FitzyPlanService.progressLine(plan);
  const extras = extrasLines({
    firstName: p.firstName,
    streakDays: p.streakDays,
    plan: line && plan ? { goal: plan.goal, progressLine: line } : null,
    memory: p.tier === 'pro' ? p.memory ?? [] : null,
    growthAllowed: opts.growthAllowed,
    circleId: opts.circleId,
  });
  return assembleGrounding(parts.length ? parts.join('\n') : null, extras);
}
