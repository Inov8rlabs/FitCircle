/**
 * Copy rendering for the Pro lifecycle card + push: placeholders, relative
 * day phrases in the user's time zone, and the real-usage line. Pure.
 */
import { addDays, localDayOf } from '../streaks/streak-calculator';

import { COPY_LIMITS } from './config';
import type { ProLifecycleState, ProSource, ProUsage, StateCopy } from './types';

/** Placeholders the editor offers (and the only ones that resolve). */
export const PLACEHOLDERS = [
  { key: 'first_name', description: "The user's first name (falls back to 'there')." },
  { key: 'period', description: "'free Pro week' for a 7-day grant, 'free Pro' otherwise, 'Pro trial' for store trials." },
  { key: 'ends', description: "When Pro ends, in the user's time zone: 'today', 'tomorrow' or 'on Sunday'." },
  { key: 'ended', description: "When Pro ended: 'today', 'yesterday' or 'on Sunday'." },
  { key: 'usage', description: "Real usage while Pro was on, e.g. '5 meals analyzed by AI and 3 chats with Fitzy' (usage body only)." },
] as const;
export type PlaceholderKey = (typeof PLACEHOLDERS)[number]['key'];

const WEEKDAY = new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: 'UTC' });

/** Weekday name of a YYYY-MM-DD date. */
function weekdayOf(day: string): string {
  return WEEKDAY.format(new Date(`${day}T12:00:00Z`));
}

/** 'today' | 'tomorrow' | 'on Sunday' (≤ 6 days) | 'on Nov 9' — when `at` falls, seen from `now` in `timezone`. */
export function endsPhrase(at: Date, now: Date, timezone: string): string {
  const today = localDayOf(now, timezone);
  const day = localDayOf(at, timezone);
  if (day <= today) return 'today';
  if (day === addDays(today, 1)) return 'tomorrow';
  if (day <= addDays(today, 6)) return `on ${weekdayOf(day)}`;
  return `on ${new Date(`${day}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })}`;
}

/** 'today' | 'yesterday' | 'on Sunday' | 'on Nov 2'. */
export function endedPhrase(at: Date, now: Date, timezone: string): string {
  const today = localDayOf(now, timezone);
  const day = localDayOf(at, timezone);
  if (day >= today) return 'today';
  if (day === addDays(today, -1)) return 'yesterday';
  if (day >= addDays(today, -6)) return `on ${weekdayOf(day)}`;
  return `on ${new Date(`${day}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })}`;
}

/** 'free Pro week' for a ~7-day grant (6.5–7.5 days), else 'free Pro'; store trials: 'Pro trial'. */
export function periodPhrase(source: ProSource | null, periodDays: number | null): string {
  if (source === 'store_trial') return 'Pro trial';
  if (periodDays !== null && periodDays >= 6.5 && periodDays <= 7.5) return 'free Pro week';
  return 'free Pro';
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Thresholds for "meaningful" usage (below them the value-prop body is used). */
export const USAGE_MIN = { aiMeals: 2, meals: 3, fitzyChats: 2, plans: 1 } as const;

/**
 * The usage phrase from real numbers, or null when nothing is meaningful.
 * Up to two parts, most Pro-specific first: AI meals (else all meals), then
 * Fitzy plans (else Fitzy chats). e.g. "5 meals analyzed by AI and 3 chats with Fitzy".
 */
export function usagePhrase(u: ProUsage | null): string | null {
  if (!u) return null;
  const parts: string[] = [];
  if (u.aiMeals >= USAGE_MIN.aiMeals) parts.push(`${plural(u.aiMeals, 'meal', 'meals')} analyzed by AI`);
  else if (u.meals >= USAGE_MIN.meals) parts.push(`${plural(u.meals, 'meal', 'meals')} logged`);
  if (u.plans >= USAGE_MIN.plans) parts.push(`${plural(u.plans, 'weekly plan', 'weekly plans')} from Fitzy`);
  else if (u.fitzyChats >= USAGE_MIN.fitzyChats) parts.push(`${plural(u.fitzyChats, 'chat', 'chats')} with Fitzy`);
  if (parts.length === 0) return null;
  return parts.join(' and ');
}

export type CopyVars = Partial<Record<PlaceholderKey, string | null>>;

const PLACEHOLDER_RE = /\{\{\s*([a-z_]+)\s*\}\}/g;

/** Resolve placeholders; null when one is unknown or empty (the text is then unusable). */
export function fill(text: string, vars: CopyVars): string | null {
  let ok = true;
  const out = text.replace(PLACEHOLDER_RE, (_m, name: string) => {
    const v = (vars as Record<string, string | null | undefined>)[name];
    if (!PLACEHOLDERS.some((p) => p.key === name) || v === null || v === undefined || v.trim() === '') {
      ok = false;
      return '';
    }
    return v;
  });
  return ok ? out.replace(/\s+/g, ' ').trim() : null;
}

/** Unknown placeholders in a template (editor validation). */
export function unknownPlaceholders(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(PLACEHOLDER_RE)) if (!PLACEHOLDERS.some((p) => p.key === m[1])) out.push(m[1]);
  return out;
}

export interface RenderInput {
  state: ProLifecycleState;
  now: Date;
  timezone: string;
  endsAt: Date;
  source: ProSource | null;
  periodDays: number | null;
  trialAvailable: boolean;
  usage: ProUsage | null;
  firstName: string | null;
}

export function varsFor(input: RenderInput): CopyVars {
  return {
    first_name: input.firstName?.trim() || 'there',
    period: periodPhrase(input.source, input.periodDays),
    ends: endsPhrase(input.endsAt, input.now, input.timezone),
    ended: endedPhrase(input.endsAt, input.now, input.timezone),
    usage: usagePhrase(input.usage),
  };
}

export interface RenderedCopy {
  eyebrow: string;
  title: string;
  body: string;
  cta: string;
  /** The body used the real-usage variant. */
  usedUsage: boolean;
}

/**
 * Card copy for one user, or an error string. The usage body is used when
 * there is meaningful usage AND it renders within the limit; otherwise the
 * value-prop body.
 */
export function renderCardCopy(copy: StateCopy, input: RenderInput): { copy: RenderedCopy } | { error: string } {
  const vars = varsFor(input);
  const title = fill(copy.title, vars);
  const eyebrow = fill(copy.eyebrow, vars);
  const cta = fill(input.trialAvailable ? copy.cta : copy.ctaNoTrial, vars);
  if (!title) return { error: 'title has an unknown or empty placeholder' };
  if (!eyebrow) return { error: 'eyebrow has an unknown or empty placeholder' };
  if (!cta) return { error: 'button has an unknown or empty placeholder' };
  if (title.length > COPY_LIMITS.title) return { error: `title is ${title.length} characters once filled in (max ${COPY_LIMITS.title}): "${title}"` };
  if (eyebrow.length > COPY_LIMITS.eyebrow) return { error: `eyebrow is longer than ${COPY_LIMITS.eyebrow} characters` };
  if (cta.length > COPY_LIMITS.label) return { error: `button is longer than ${COPY_LIMITS.label} characters` };
  const withUsage = vars.usage ? fill(copy.usageBody, vars) : null;
  const usable = withUsage && withUsage.length <= COPY_LIMITS.body ? withUsage : null;
  const body = usable ?? fill(copy.body, vars);
  if (!body) return { error: 'body has an unknown or empty placeholder ({{usage}} only works in the usage body)' };
  if (body.length > COPY_LIMITS.body) return { error: `body is ${body.length} characters once filled in (max ${COPY_LIMITS.body})` };
  return { copy: { eyebrow, title, body, cta, usedUsage: !!usable } };
}

/** Push copy for one user, or an error string. */
export function renderPushCopy(push: { title: string; body: string; bodyNoTrial: string }, input: RenderInput): { title: string; body: string } | { error: string } {
  const vars = varsFor(input);
  const title = fill(push.title, vars);
  const body = fill(input.trialAvailable ? push.body : push.bodyNoTrial, vars);
  if (!title || !body) return { error: 'push text has an unknown or empty placeholder' };
  if (title.length > COPY_LIMITS.pushTitle) return { error: `push title is longer than ${COPY_LIMITS.pushTitle} characters once filled in` };
  if (body.length > COPY_LIMITS.pushBody) return { error: `push body is longer than ${COPY_LIMITS.pushBody} characters once filled in` };
  return { title, body };
}
