/**
 * Fitzy coaching tips as push notifications — the PURE policy (docs/FITZY_PUSH_NOTIFICATIONS.md).
 * No I/O: timing windows, eligibility, frequency caps, dedupe, lock-screen privacy, templates and
 * the nudge prompt/parser live here so they are unit-tested and shared with the live eval.
 * FitzyPushService does the reads, the claim, the generation and the send.
 *
 * Kinds (all category `coach`, toggle "Coaching tips from Fitzy"):
 *   morning slot (one per local day)
 *     fitzy_daily_focus    08:00–10:59  today's focus card, as a push (AI; same text as the in-app card)
 *     fitzy_weekly_recap   Sunday morning, Pro with a plan (the focus card IS the recap that day)
 *     fitzy_weekly_plan    Monday morning instead of the focus: Pro without a plan / free teaser (template)
 *     fitzy_intro          day 2–4 after sign-up, ONCE EVER: activated (≥ 1 meal) users who never opened
 *                          Fitzy (ACTIVATION_JOURNEY_SPEC §6); takes the morning slot that day (template)
 *   contextual slot (at most one per local day)
 *     fitzy_hydration_nudge 11:00–11:59 water logger with no water logged today (template)
 *     fitzy_protein_nudge   15:00–16:59 protein well below the user's own usual by mid-afternoon (AI + template fallback)
 * No coach-voiced streak push: momentum_at_risk + meal_reminder_dinner already cover the evening.
 */
import { MAX_NOTIFICATIONS_PER_DAY } from '../services/notification-orchestrator';
import { addDays } from '../streaks/streak-calculator';
import type { FitzyDailyFocus, FitzyTier } from '../types/fitzy';

import { chatModel, systemMessages, type ModelCall } from './models';
import { fitBody } from './text';

// ---------------------------------------------------------------------------- kinds + config

export const FITZY_PUSH_TYPES = [
  'fitzy_daily_focus',
  'fitzy_weekly_recap',
  'fitzy_weekly_plan',
  'fitzy_hydration_nudge',
  'fitzy_protein_nudge',
  'fitzy_intro',
] as const;
export type FitzyPushType = (typeof FITZY_PUSH_TYPES)[number];

export type FitzyPushSlot = 'morning' | 'contextual';

export const SLOT_OF: Record<FitzyPushType, FitzyPushSlot> = {
  fitzy_daily_focus: 'morning',
  fitzy_weekly_recap: 'morning',
  fitzy_weekly_plan: 'morning',
  fitzy_hydration_nudge: 'contextual',
  fitzy_protein_nudge: 'contextual',
  fitzy_intro: 'morning',
};

const intEnv = (env: NodeJS.ProcessEnv, name: string, def: number, min: number, max: number) => {
  const n = env[name] == null || env[name] === '' ? NaN : Number(env[name]);
  return Number.isInteger(n) && n >= min && n <= max ? n : def;
};

export interface FitzyPushConfig {
  enabled: boolean;
  disabledKinds: Set<string>;
  focusHour: number;
  focusWindowHours: number;
  hydrationHour: number;
  hydrationWindowHours: number;
  proteinHour: number;
  proteinWindowHours: number;
}

/**
 * Env knobs. FITZY_PUSH_ENABLED is the kill switch and defaults OFF: nothing is sent until it is
 * exactly "true". FITZY_PUSH_DISABLED_KINDS (comma list of types) turns single kinds off.
 */
export function pushConfig(env: NodeJS.ProcessEnv = process.env): FitzyPushConfig {
  return {
    enabled: (env.FITZY_PUSH_ENABLED ?? '').trim().toLowerCase() === 'true',
    disabledKinds: new Set((env.FITZY_PUSH_DISABLED_KINDS ?? '').split(',').map((s) => s.trim()).filter(Boolean)),
    focusHour: intEnv(env, 'FITZY_FOCUS_LOCAL_HOUR', 8, 5, 12),
    focusWindowHours: 3,
    hydrationHour: intEnv(env, 'FITZY_HYDRATION_LOCAL_HOUR', 11, 9, 14),
    hydrationWindowHours: 1,
    proteinHour: intEnv(env, 'FITZY_PROTEIN_LOCAL_HOUR', 15, 13, 17),
    proteinWindowHours: 2,
  };
}

// ---------------------------------------------------------------------------- caps

/** Leave room for the evening streak reminder: Fitzy may only use the first MAX-1 nudge slots. */
export const FITZY_RESERVED_SLOTS = 1;
/** Minimum quiet gap after ANY delivered push before a Fitzy push. */
export const MIN_SPACING_MINUTES = 90;
/** Contextual kinds: at most this many per rolling 7 days, each. */
export const CONTEXTUAL_PER_WEEK = 2;
/** Free weekly-plan teaser: at most one per 14 days. */
export const FREE_PLAN_TEASER_DAYS = 14;
/** Active = a streak claim, food log or workout within this many local days (dormant users get the journey ladder instead). */
export const ACTIVE_WITHIN_DAYS = 3;

/** A delivered (non-suppressed) notification_log row. */
export interface SentRow {
  type: string;
  sentAt: string; // ISO
}

// ---------------------------------------------------------------------------- local time

export function localParts(timeZone: string, now: Date): { date: string; hour: number; weekday: number } {
  const date = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  const hour = parseInt(new Intl.DateTimeFormat('en-US', { timeZone, hour: '2-digit', hour12: false }).format(now), 10) % 24;
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay(); // 0 = Sunday
  return { date, hour, weekday };
}

/** Which slot (if any) this local hour falls in. */
export function slotForHour(hour: number, cfg: FitzyPushConfig): { slot: FitzyPushSlot; kind: 'morning' | 'fitzy_hydration_nudge' | 'fitzy_protein_nudge' } | null {
  const inWin = (start: number, len: number) => hour >= start && hour < start + len;
  if (inWin(cfg.focusHour, cfg.focusWindowHours)) return { slot: 'morning', kind: 'morning' };
  if (inWin(cfg.hydrationHour, cfg.hydrationWindowHours)) return { slot: 'contextual', kind: 'fitzy_hydration_nudge' };
  if (inWin(cfg.proteinHour, cfg.proteinWindowHours)) return { slot: 'contextual', kind: 'fitzy_protein_nudge' };
  return null;
}

export const deliveryKey = (slot: FitzyPushSlot, localDate: string) => `${slot}:${localDate}`;

// ---------------------------------------------------------------------------- eligibility

export interface CommonContext {
  now: Date;
  /** User's local midnight as a UTC instant (startOfLocalDay). */
  startOfDay: Date;
  /** Non-suppressed notification_log rows for the last 14 days. */
  sent: SentRow[];
  /** Types that count toward the daily cap (everything not cap-exempt). */
  countsTowardCap: (type: string) => boolean;
  coachEnabled: boolean;
  inQuietHours: boolean;
  active: boolean;
}

export type Skip =
  | 'disabled'
  | 'kind_disabled'
  | 'coach_off'
  | 'quiet_hours'
  | 'inactive'
  | 'cap_budget'
  | 'spacing'
  | 'weekly_cap'
  | 'not_ai_eligible'
  | 'already_seen'
  | 'not_relevant';

/** Checks shared by every kind, cheapest first. Null = may proceed. */
export function commonSkip(kind: FitzyPushType, ctx: CommonContext, cfg: FitzyPushConfig): Skip | null {
  if (!cfg.enabled) return 'disabled';
  if (cfg.disabledKinds.has(kind)) return 'kind_disabled';
  if (!ctx.coachEnabled) return 'coach_off';
  if (ctx.inQuietHours) return 'quiet_hours';
  if (!ctx.active) return 'inactive';
  const today = ctx.sent.filter((r) => Date.parse(r.sentAt) >= ctx.startOfDay.getTime());
  const capped = today.filter((r) => ctx.countsTowardCap(r.type)).length;
  if (capped >= MAX_NOTIFICATIONS_PER_DAY - FITZY_RESERVED_SLOTS) return 'cap_budget';
  const last = Math.max(0, ...ctx.sent.map((r) => Date.parse(r.sentAt)));
  if (last && ctx.now.getTime() - last < MIN_SPACING_MINUTES * 60_000) return 'spacing';
  if (SLOT_OF[kind] === 'contextual') {
    const weekAgo = ctx.now.getTime() - 7 * 86_400_000;
    if (ctx.sent.filter((r) => r.type === kind && Date.parse(r.sentAt) >= weekAgo).length >= CONTEXTUAL_PER_WEEK) return 'weekly_cap';
  }
  return null;
}

/**
 * What the morning slot sends today.
 *  - Monday: Pro without a plan → plan prompt; free → teaser at most every 14 days (no preview yet this week).
 *  - Otherwise the daily focus, only for users who have used Fitzy chat (server-side evidence of AI consent),
 *    and only if they haven't already opened today's focus in the app.
 */
export function morningKind(input: {
  weekday: number;
  tier: FitzyTier;
  hasPlanThisWeek: boolean;
  hasPreviewThisWeek: boolean;
  lastTeaserAt: string | null;
  aiEligible: boolean;
  focusAlreadyGenerated: boolean;
  now: Date;
}): { kind: FitzyPushType } | { skip: Skip } {
  if (input.weekday === 1 && !input.hasPlanThisWeek) {
    if (input.tier === 'pro') return { kind: 'fitzy_weekly_plan' };
    const teaserOk = !input.lastTeaserAt || input.now.getTime() - Date.parse(input.lastTeaserAt) >= FREE_PLAN_TEASER_DAYS * 86_400_000;
    if (teaserOk && !input.hasPreviewThisWeek) return { kind: 'fitzy_weekly_plan' };
  }
  if (!input.aiEligible) return { skip: 'not_ai_eligible' };
  if (input.focusAlreadyGenerated) return { skip: 'already_seen' };
  return { kind: 'fitzy_daily_focus' };
}

/** Water logger (water on ≥ 2 of the previous 7 days) with nothing logged today. */
export function hydrationRelevant(waterDays: string[], today: string): boolean {
  if (waterDays.includes(today)) return false;
  const since = addDays(today, -7);
  return new Set(waterDays.filter((d) => d >= since && d < today)).size >= 2;
}

export interface ProteinDay {
  date: string;
  entries: number;
  proteinG: number;
}

/**
 * "Protein behind by mid-afternoon", relative to the user's OWN usual — no targets:
 * ≥ 1 entry today (they are logging; the meal reminders cover not logging), ≥ 3 prior days with
 * ≥ 2 entries in the last 7, a usual of ≥ 30 g, and today below 40 % of it.
 */
export function proteinBehind(days: ProteinDay[], today: string): boolean {
  const t = days.find((d) => d.date === today);
  if (!t || t.entries < 1) return false;
  const since = addDays(today, -7);
  const prior = days.filter((d) => d.date >= since && d.date < today && d.entries >= 2);
  if (prior.length < 3) return false;
  const usual = prior.reduce((a, d) => a + d.proteinG, 0) / prior.length;
  return usual >= 30 && t.proteinG < usual * 0.4;
}

// ---------------------------------------------------------------------------- fitzy_intro

/** Account-age window (local days after the sign-up day) in which the intro may go: day 2 … day 4. */
export const INTRO_FIRST_DAY = 1;
export const INTRO_LAST_DAY = 3;

export interface IntroInput {
  /** Sign-up day in the user's timezone (YYYY-MM-DD); null = unknown. */
  signupLocalDate: string | null;
  today: string;
  /** profiles.fitzy_opened_at; undefined = column/row unknown → never send. */
  fitzyOpenedAt: string | null | undefined;
  /** ≥ 1 food entry ever (activated). */
  activated: boolean;
  /** A fitzy_intro was ever delivered (once ever). */
  introEverSent: boolean;
}

export type IntroSkip = 'intro_unknown' | 'intro_not_day' | 'fitzy_opened' | 'not_activated' | 'intro_sent';

/** Null = send the intro in this morning slot. */
export function introSkip(i: IntroInput): IntroSkip | null {
  if (i.fitzyOpenedAt === undefined || !i.signupLocalDate) return 'intro_unknown';
  if (i.fitzyOpenedAt !== null) return 'fitzy_opened';
  if (i.introEverSent) return 'intro_sent';
  if (!i.activated) return 'not_activated';
  const day = Math.round((Date.parse(`${i.today}T00:00:00Z`) - Date.parse(`${i.signupLocalDate}T00:00:00Z`)) / 86_400_000);
  if (day < INTRO_FIRST_DAY || day > INTRO_LAST_DAY) return 'intro_not_day';
  return null;
}

/** `fitzy_intro:<userId>` — the dedupe key (once ever is enforced by introEverSent; this guards concurrent runs). */
export const introDedupeKey = (userId: string) => `fitzy_intro:${userId}`;

// ---------------------------------------------------------------------------- content

/** iOS shows ~1 line of title and ~4 lines of body on the lock screen; Android collapsed ~1 + 1. */
export const TITLE_MAX = 50;
export const BODY_MAX = 150;
/** The tip forwarded to the app (Fitzy chat context) — data payload, never on the lock screen. */
export const TIP_MAX = 400;

const cp = (s: string) => [...s].length;

/**
 * Lock-screen privacy: no health values beyond what existing pushes show (streak days, workout
 * counts). Rejects numbers with food/body units and any weight / calorie / macro / body-comp words.
 */
const LOCK_SCREEN_UNSAFE =
  /(\d[\d.,]*\s*(?:g|grams?|kg|kgs|kilos?|lbs?|pounds?|kcal|cal|calories|%|percent|ml|oz|bpm)\b)|\b(weigh(?:s|ed|ing|-?ins?)?\b|weight(?!s\b|lifting|\s+training)\w*|calori\w*|kcal|macros?|carbs?\b.*\d|body[\s-]?fat|bmi|fat\s+mass|muscle\s+mass|waist|scale|deficit|plate\s+score)\b/i;

export function lockScreenSafe(text: string): boolean {
  return !LOCK_SCREEN_UNSAFE.test(text);
}

export interface PushCopy {
  title: string;
  body: string;
  /** Full tip for the in-app Fitzy context (may be longer than the lock-screen body). */
  tip: string;
  source: 'ai' | 'template';
}

const clampTitle = (t: string) => (cp(t) <= TITLE_MAX ? t : null);

/** The focus card body can use the full ~4 lock-screen lines (its 2nd sentence is usually the actual idea). */
export const FOCUS_BODY_MAX = 178;

/**
 * Today's focus card → push copy. Title and body fall back independently: an over-long headline
 * becomes "Today's focus from Fitzy", and a body that isn't lock-screen safe becomes a generic teaser.
 * The tip (data payload → Fitzy chat) always carries the full card.
 */
export function focusPushCopy(focus: FitzyDailyFocus, guard: (t: string) => boolean, source: PushCopy['source']): PushCopy {
  const tip = `${focus.headline}\n\n${focus.body}`.slice(0, TIP_MAX);
  const recap = focus.kind === 'recap';
  const fallbackTitle = recap ? 'Your week with Fitzy 🗓️' : "Today's focus from Fitzy ☀️";
  const fallbackBody = recap ? 'Your weekly recap is ready. See what went well and what to carry into next week.' : 'One small, doable idea for today is waiting for you.';
  const safe = (t: string) => lockScreenSafe(t) && !guard(t);
  const headline = clampTitle(focus.headline.trim());
  const body = fitBody(focus.body.trim(), FOCUS_BODY_MAX);
  const bodyOk = !!body && safe(body);
  // A headline is only shown with its own body: alone it can read as a non-sequitur.
  const titleOk = !!headline && bodyOk && safe(headline);
  return { title: titleOk ? headline : fallbackTitle, body: bodyOk ? body : fallbackBody, tip, source };
}

/** Deterministic pick so a retry picks the same variant; varies by user and day. */
export function variant<T>(list: readonly T[], seed: string): T {
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return list[Math.abs(h) % list.length];
}

const HYDRATION_TEMPLATES = [
  { title: 'Water break? 💧', body: 'A glass now makes the afternoon easier. Log it in a tap.' },
  { title: 'Sip check 💧', body: 'An easy win before lunch: one glass of water, then log it.' },
  { title: 'Hydration hello 💧', body: 'Keep a glass nearby this afternoon. Future you will thank you.' },
] as const;

export function hydrationCopy(seed: string): PushCopy {
  const t = variant(HYDRATION_TEMPLATES, seed);
  return { ...t, tip: `${t.title.replace(/\s*💧$/, '')}\n\n${t.body}`, source: 'template' };
}

/** Protein ideas by diet, filtered by allergens; used for the template and as model guidance. */
const PROTEIN_FOODS: Array<{ name: string; tags: string[]; not?: string[] }> = [
  { name: 'Greek yogurt', tags: ['dairy'], not: ['vegan'] },
  { name: 'a boiled egg', tags: ['eggs', 'egg'], not: ['vegan'] },
  { name: 'hummus with veggies', tags: ['sesame', 'chickpeas'] },
  { name: 'edamame', tags: ['soy'] },
  { name: 'a handful of almonds', tags: ['nuts', 'tree nuts', 'almonds'] },
  { name: 'peanut butter on toast', tags: ['peanuts', 'peanut', 'gluten', 'wheat'], not: ['gluten_free'] },
  { name: 'cottage cheese', tags: ['dairy', 'milk'], not: ['vegan'] },
  { name: 'a tuna wrap', tags: ['fish', 'gluten', 'wheat'], not: ['vegan', 'vegetarian', 'gluten_free'] },
  { name: 'lentil soup', tags: ['legumes'] },
  { name: 'roasted chickpeas', tags: ['chickpeas', 'legumes'] },
];

/** Up to n compatible ideas; `seed` rotates the starting point so users don't all see the same three. */
export function proteinIdeas(diet: string, allergens: string[], n = 3, seed = ''): string[] {
  const a = allergens.map((s) => s.toLowerCase());
  const ok = PROTEIN_FOODS.filter((f) => !(f.not ?? []).includes(diet) && !f.tags.some((t) => a.some((x) => t.includes(x) || x.includes(t)))).map((f) => f.name);
  if (!ok.length) return [];
  const start = seed ? ok.indexOf(variant(ok, seed)) : 0;
  return [...ok.slice(start), ...ok.slice(0, start)].slice(0, n);
}

export function proteinTemplate(diet: string, allergens: string[], seed: string): PushCopy {
  const ideas = proteinIdeas(diet, allergens, 3, seed);
  const list = ideas.length >= 2 ? `${ideas.slice(0, -1).join(', ')} or ${ideas[ideas.length - 1]}` : ideas[0] ?? 'a snack you enjoy';
  const title = variant(['A protein boost for later 💪', 'Afternoon snack idea 🥣', 'Fuel for the afternoon 💪'] as const, seed);
  const body = fitBody(`${list[0].toUpperCase()}${list.slice(1)} could round out your afternoon.`, BODY_MAX) ?? 'A protein-rich snack could round out your afternoon.';
  return { title, body, tip: `${title.replace(/\s*\p{Extended_Pictographic}$/u, '')}\n\n${body}`, source: 'template' };
}

/**
 * The intro is a template (the user has not used Fitzy yet, so no AI copy — see the privacy note in
 * FitzyPushService). "Yesterday's meals" only when they really logged meals yesterday. The tip is
 * Fitzy's opening chat message (data payload, never on the lock screen).
 */
export function introCopy(loggedYesterday: boolean): PushCopy {
  return loggedYesterday
    ? {
        title: "A tip on yesterday's meals? 💬",
        body: "I'm Fitzy, your coach. I can look at what you logged yesterday and suggest one easy idea for today.",
        tip: "Hi, I'm Fitzy, your coach! I can look at the meals you logged yesterday and suggest one easy idea for today. Want my take?",
        source: 'template',
      }
    : {
        title: 'Meet Fitzy, your coach 💬',
        body: 'Ask me anything about your meals: what is working, and one easy idea to try next.',
        tip: "Hi, I'm Fitzy, your coach! Ask me anything about your meals, or I can suggest one easy idea for today.",
        source: 'template',
      };
}

export const WEEKLY_PLAN_COPY: Record<FitzyTier, { title: string; body: string }> = {
  pro: { title: 'Plan your week with Fitzy 🗓️', body: "Tell me one thing you want from this week and I'll turn it into a few small, doable commitments." },
  free: { title: 'Your week, planned in a minute 🗓️', body: 'Fitzy can turn one goal into a few small, doable steps. Take a peek at this week’s plan.' },
};

export function weeklyPlanCopy(tier: FitzyTier): PushCopy {
  const c = WEEKLY_PLAN_COPY[tier];
  return { ...c, tip: `${c.title.replace(/\s*🗓️$/, '')}\n\n${c.body}`, source: 'template' };
}

// ---------------------------------------------------------------------------- protein nudge (AI)

export const NUDGE_PROMPT = [
  'You are Fitzy, a warm, body-neutral and food-neutral fitness + nutrition coach, writing ONE push notification.',
  'Situation: it is mid-afternoon and the user has had less protein than they usually do by now.',
  'Suggest ONE easy, specific protein-rich snack or addition for this afternoon or dinner that fits their diet,',
  'allergens and what they like (from the context). Friendly, upbeat, adds rather than removes.',
  'title ≤ 40 characters (may end with one emoji), body ≤ 120 characters, one or two short sentences.',
  'If you use an emoji, prefer a neutral one (💪 🌱 ✨ 🥣); NEVER name or picture anything they are allergic to.',
  'This shows on the LOCK SCREEN: NEVER include any number about food, protein, grams, calories, macros, weight or',
  'the body; never say "behind", "low", "not enough", "only", "missed" or anything that judges; never shame;',
  'never mention calorie targets, restriction, skipping meals, good/bad foods, weight or medical topics.',
  'Reply with ONLY JSON: {"title":"…","body":"…"}',
].join('\n');

export function nudgeRequest(grounding: string, ideas: string[]): ModelCall & { primary: string } {
  return {
    primary: chatModel(),
    system: systemMessages(NUDGE_PROMPT, grounding),
    messages: [{ role: 'user', content: `Write the protein nudge.${ideas.length ? ` Ideas that fit them: ${ideas.join(', ')}.` : ''}` }],
    maxOutputTokens: 200,
    thinking: false,
  };
}

/** Words / emoji that name a food for each allergen token (dietary_preferences.allergens). */
const ALLERGEN_TERMS: Array<{ keys: RegExp; terms: RegExp }> = [
  { keys: /peanut/, terms: /peanut|groundnut|🥜/iu },
  { keys: /tree\s*nut|^nuts?$|almond|cashew|walnut/, terms: /\b(?:almonds?|walnuts?|cashews?|pecans?|pistachios?|hazelnuts?|macadamias?|brazil\s+nuts?|nuts?|nut\s+butter)\b|🥜|🌰/iu },
  { keys: /dairy|milk|lactose/, terms: /\b(?:yogh?urt|cheese|milk|paneer|cottage|kefir|whey|skyr|butter(?!nut))\b|🧀|🥛/iu },
  { keys: /egg/, terms: /\beggs?\b|🥚|🍳/iu },
  { keys: /soy/, terms: /\b(?:soy\w*|tofu|edamame|tempeh|miso)\b|🫛/iu },
  { keys: /^fish$|fish/, terms: /\b(?:fish|tuna|salmon|sardines?|cod|mackerel|anchov\w*)\b|🐟|🍣/iu },
  { keys: /shellfish|crustacean|shrimp/, terms: /\b(?:shrimp|prawns?|crab|lobster|shellfish|mussels?|clams?|oysters?|scallops?)\b|🦐|🦞|🦀/iu },
  { keys: /sesame/, terms: /\b(?:sesame|tahini|hummus)\b/iu },
  { keys: /gluten|wheat/, terms: /\b(?:bread|toast|wraps?|pasta|bagels?|crackers?|wheat|seitan)\b|🍞|🥪|🥯/iu },
];

/** True when the copy names (or shows) a food the user is allergic to. */
export function mentionsAllergen(text: string, allergens: string[]): boolean {
  const tokens = allergens.map((a) => a.toLowerCase().trim()).filter(Boolean);
  return ALLERGEN_TERMS.some((a) => tokens.some((t) => a.keys.test(t)) && a.terms.test(text));
}

const JUDGING = /\b(behind|low|not\s+enough|only|missed|fell\s+short|lacking|deficien\w*|should\s+have)\b/i;

/** Model text → push copy, or null (caller uses the template) when unparseable, too long, unsafe or naming an allergen. */
export function parseNudge(text: string, guard: (t: string) => boolean, allergens: string[] = []): PushCopy | null {
  const m = text.replace(/```(?:json)?/gi, '').match(/\{[\s\S]*\}/);
  if (!m) return null;
  let j: any;
  try {
    j = JSON.parse(m[0].replace(/,\s*([}\]])/g, '$1'));
  } catch {
    return null;
  }
  const title = typeof j?.title === 'string' ? j.title.trim() : '';
  const body = typeof j?.body === 'string' ? j.body.trim() : '';
  if (!title || !body || cp(title) > TITLE_MAX || cp(body) > BODY_MAX) return null;
  const all = `${title}\n${body}`;
  if (!lockScreenSafe(all) || JUDGING.test(all) || guard(all) || mentionsAllergen(all, allergens)) return null;
  return { title, body, tip: `${title}\n\n${body}`, source: 'ai' };
}
