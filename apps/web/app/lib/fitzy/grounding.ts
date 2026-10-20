/**
 * Pure grounding text builders (docs/FITZY_V2_SPEC.md §5). FitzyService reads the user's data
 * and calls these; the live-model eval (scripts/fitzy-eval) feeds them synthetic personas, so
 * the wording the model sees is identical in both. No I/O here.
 */
import type { BodyCompDelta } from '../types/body-composition';

export const GROUNDING_HEADER = 'GROUNDING CONTEXT about this user (use to be supportive; never quote verbatim, never judge):';

/** (a) Food log: daily averages over the logged days, or the no-logging line. */
export function foodBlock(avg: { days: number; kcal: number; protein: number; carbs: number; fat: number } | null): string {
  if (!avg) return 'Little or no recent food logging. Do not pressure them about logging.';
  return (
    `Logged food on ~${avg.days} of the last 7 days. Daily averages ≈ ${avg.kcal} kcal, ` +
    `${avg.protein}g protein, ${avg.carbs}g carbs, ${avg.fat}g fat. ` +
    'Descriptive only — do NOT judge or set targets from these.'
  );
}

/** (b) Dietary preferences + allergens; null when there is nothing to say. */
export function prefsBlock(diet: string, allergens: string[]): string | null {
  const bits: string[] = [];
  if (diet !== 'none') bits.push(`follows a ${diet.replace(/_/g, ' ')} diet`);
  if (allergens.length > 0) bits.push(`is allergic to ${allergens.join(', ')}`);
  if (bits.length === 0) return null;
  return `The user ${bits.join(' and ')}. Only suggest compatible foods; never suggest a listed allergen.`;
}

/** (c) Recent workouts (count, minutes, up to 5 types), or the no-workouts line. */
export function workoutBlock(w: { count: number; minutes: number; types: string[] } | null): string {
  if (!w || w.count === 0) return 'No workouts logged in the last 7 days. Keep any movement ideas gentle and optional.';
  const types = w.types.slice(0, 5).join(', ');
  return `Logged ${w.count} workout${w.count === 1 ? '' : 's'} in the last 7 days (~${w.minutes} total minutes${types ? `; e.g. ${types}` : ''}). Celebrate movement; never push harder or shame rest.`;
}

export type WeightTrend = 'trending down' | 'trending up' | 'about steady';

/** (d) Weight TREND only (direction, never a target or rate). */
export function weightTrendBlock(dir: WeightTrend): string {
  return `The user's logged weight is ${dir} over recent check-ins. You may acknowledge the trend encouragingly, but NEVER set a target weight or promise a rate of change.`;
}

/** (e) Latest Plate Score. */
export function plateScoreBlock(score: number): string {
  return `Most recent Plate Score (0–100 balance/variety signal): ${score}. Frame encouragingly, never as a grade to beat.`;
}

/** (f) Circle + active challenge (member only); null when neither is known. */
export function circleBlock(circleName: string | undefined, challenge: { name: string; description?: string | null } | null): string | null {
  if (challenge) {
    return `In the circle${circleName ? ` "${circleName}"` : ''} with active challenge "${challenge.name}"${challenge.description ? `: ${challenge.description}` : ''}. You may tie encouragement to it positively and non-competitively.`;
  }
  if (circleName) return `In the circle "${circleName}" (no active challenge). Keep any circle mention light and encouraging.`;
  return null;
}

export interface BodyCompGrounding {
  measuredAt: string;
  source: string;
  weightKg: number | null;
  bodyFatPct: number | null;
  fatMassKg: number | null;
  skeletalMuscleMassKg: number | null;
  /** Trend-engine state, omitted when unavailable or insufficient_data. */
  trendState?: string | null;
  deltas?: BodyCompDelta[];
  bodyFatGoal?: number | null;
}

export const BODY_COMP_RULES =
  'RULES FOR THIS DATA: treat the multi-week trend as the signal, never a single scan; ' +
  'changes flagged "within measurement noise" are not real changes — say so if asked; ' +
  'never celebrate the speed of any change; never advise on left/right or segmental ' +
  'differences; never use disease names, clinical thresholds, or the word "abnormal"; ' +
  'never set body-composition targets or rates; and never mention this data in any ' +
  'circle, challenge, or social context — it is private.';

/** (g) Body composition — aggregate-only, with the guardrail sentence travelling with the data. */
export function bodyCompBlock(b: BodyCompGrounding): string {
  const vals: string[] = [];
  if (b.weightKg != null) vals.push(`weight ${b.weightKg} kg`);
  if (b.bodyFatPct != null) vals.push(`body fat ${b.bodyFatPct}%`);
  if (b.fatMassKg != null) vals.push(`fat mass ${b.fatMassKg} kg`);
  if (b.skeletalMuscleMassKg != null) vals.push(`skeletal muscle ${b.skeletalMuscleMassKg} kg`);
  const bits: string[] = [`Latest body-composition entry (${b.measuredAt.slice(0, 10)}, ${b.source.replace(/_/g, ' ')}): ${vals.join(', ') || 'no metric values'}.`];
  if (b.trendState && b.trendState !== 'insufficient_data') bits.push(`Multi-week trend state: ${b.trendState.replace(/_/g, ' ')}.`);
  if (b.deltas && b.deltas.length > 0) bits.push(`Change since the previous entry: ${b.deltas.map(describeBodyCompDelta).join('; ')}.`);
  if (b.bodyFatGoal != null) bits.push(`Their stated body-fat goal is ${b.bodyFatGoal}%.`);
  bits.push(BODY_COMP_RULES);
  return bits.join(' ');
}

/** Human phrasing for one trend-engine delta, keeping the noise flag attached. */
export function describeBodyCompDelta(d: BodyCompDelta): string {
  const labels: Record<string, string> = {
    weightKg: 'weight',
    bodyFatPct: 'body fat',
    fatMassKg: 'fat mass',
    skeletalMuscleMassKg: 'skeletal muscle',
  };
  const unit = d.metric === 'bodyFatPct' ? ' percentage points' : ' kg';
  const sign = d.delta > 0 ? '+' : '';
  return `${labels[d.metric] ?? d.metric} ${sign}${d.delta}${unit}${d.withinNoise ? ' (within measurement noise)' : ''}`;
}

export interface GroundingExtras {
  firstName?: string | null;
  streakDays?: number | null;
  plan?: { goal: string; progressLine: string } | null;
  /** Pro only (the caller decides). */
  memory?: string[] | null;
  growthAllowed?: boolean;
  circleId?: string;
}

/** Profile / streak / plan / memory / growth-flag / circle-id lines, in production order. */
export function extrasLines(x: GroundingExtras): string[] {
  const out: string[] = [];
  if (x.firstName) out.push(`The user's first name is ${x.firstName}.`);
  const days = x.streakDays ?? 0;
  if (days > 0) out.push(`Current check-in streak: ${days} day${days === 1 ? '' : 's'}.`);
  if (x.plan?.progressLine) out.push(`This week's plan (goal: ${x.plan.goal}) progress: ${x.plan.progressLine}.`);
  if (x.memory && x.memory.length) out.push(`What the user has told you before (use naturally, never list it back): ${x.memory.join('; ')}.`);
  out.push(`growthNudgeAllowed: ${x.growthAllowed ? 'true' : 'false'}`);
  if (x.circleId) out.push(`Circle id for open_circle actions: ${x.circleId}`);
  return out;
}

/** Final grounding system message: header + context blocks + extras. */
export function assembleGrounding(context: string | null, extras: string[]): string {
  const body = [context, ...extras].filter(Boolean).join('\n');
  return `${GROUNDING_HEADER}\n${body}`;
}
