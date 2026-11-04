/**
 * The Pro lifecycle home card: one promo@1 definition per state, built from
 * the user's computed state + the published config. Pure.
 *
 * Placement: score PRO_LIFECYCLE_SCORE sits right under the header (990) and
 * above every other promo, so it wins G7 (max 2 promo-category cards) and G8
 * (max 1 in the first 4); the guardrails still run last. While a lifecycle
 * card is in the feed the evergreen Pro upsells (pro_value, legacy
 * pro_upsell) step aside — one paywall card at a time.
 */
import { localClock } from '../journey/meal-slots';
import type { CreativeOption, PromoDefinition } from '../promos/engine';
import type { PromoAction, PromoTheme } from '../promos/types';

import { renderCardCopy, type RenderInput } from './copy';
import {
  PRO_LIFECYCLE_PAYWALL_SOURCES,
  PRO_LIFECYCLE_PROMO_KEYS,
  PRO_LIFECYCLE_STATES,
  type LifecycleResult,
  type ProLifecycleConfig,
  type ProLifecycleState,
  type ProUsage,
} from './types';

/** Header 990 > lifecycle 988 > first_meal 985 > campaign 970 > … (system-promos.ts PROMO_SCORES). */
export const PRO_LIFECYCLE_SCORE = 988;

/**
 * CTA treatment (identical on every state, trial / no-trial, iOS / Android): hero layout, foreground light,
 * and NO `accent`. Shipped 1.1.x clients then draw the same primary button — a full-width white pill with
 * dark semibold text (iOS PromoCard.swift: Capsule white / #111111, min 48 pt, ignores accent; Android
 * PromoCard.kt: Material Button CircleShape, container = accent ?? white, label #0F172A by luminance,
 * min 44 dp) — the same as every other promo@1 hero (first_meal). Setting `accent` would recolour the
 * button on Android only, so it is never sent.
 */
const theme = (colors: string[]): PromoTheme => ({ background: { kind: 'gradient', colors }, foreground: 'light' });

/** Fixed per state (not editable): colours + icon key (with the legacy glyph for pre-icon_keys builds). */
export const STATE_STYLE: Record<ProLifecycleState, { theme: PromoTheme; icon: 'hourglass' | 'crown'; emoji: string; countdownLabel: string | null }> = {
  pro_expiring: { theme: theme(['#1E1B4B', '#4338CA', '#7C3AED']), icon: 'hourglass', emoji: '⏳', countdownLabel: 'Pro ends in' },
  pro_expired: { theme: theme(['#3B0764', '#7E22CE', '#BE185D']), icon: 'crown', emoji: '👑', countdownLabel: null },
  trial_expiring: { theme: theme(['#0C4A6E', '#0369A1', '#6D28D9']), icon: 'hourglass', emoji: '⏳', countdownLabel: 'Trial ends in' },
};

/** Per-user inputs for the card (null = the lifecycle read failed → no card). */
export interface LifecycleFeedInput {
  result: LifecycleResult;
  usage: ProUsage | null;
  firstName: string | null;
  timezone: string;
}

/** promo countdown wants local wall-clock time without a zone ("2026-11-09T13:17:00"). */
export function localWallTime(at: Date, timezone: string): string {
  try {
    const { date } = localClock(at, timezone);
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone, hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(at);
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00';
    return `${date}T${String(Number(get('hour')) % 24).padStart(2, '0')}:${get('minute')}:${get('second')}`;
  } catch {
    return at.toISOString().slice(0, 19);
  }
}

const paywall = (state: ProLifecycleState): PromoAction => ({ type: 'paywall', params: { placement: PRO_LIFECYCLE_PAYWALL_SOURCES[state] } });

/** The creative for `state` (or an error), from config + facts. Shared by the feed and the admin preview. */
export function lifecycleCreative(state: ProLifecycleState, config: ProLifecycleConfig, input: LifecycleFeedInput, now: Date): { creative: CreativeOption; usedUsage: boolean } | { error: string } {
  const sc = config.states[state];
  const r = input.result;
  if (!r.endsAt) return { error: 'no end date' };
  const endsAt = new Date(r.endsAt);
  const render: RenderInput = {
    state,
    now,
    timezone: input.timezone,
    endsAt,
    source: r.source,
    periodDays: r.periodDays,
    trialAvailable: r.trialAvailable,
    usage: input.usage,
    firstName: input.firstName,
  };
  const out = renderCardCopy(sc.copy, render);
  if ('error' in out) return out;
  const style = STATE_STYLE[state];
  const showCountdown = style.countdownLabel && sc.layout !== 'compact' && endsAt.getTime() > now.getTime();
  const variant = `${r.trialAvailable ? 'trial' : 'notrial'}_${out.copy.usedUsage ? 'usage' : 'value'}`;
  return {
    usedUsage: out.copy.usedUsage,
    creative: {
      id: `${PRO_LIFECYCLE_PROMO_KEYS[state]}_${sc.layout}_${variant}`,
      weight: 100,
      layout: sc.layout,
      theme: style.theme,
      icon: style.icon,
      emoji: style.emoji,
      eyebrow: out.copy.eyebrow,
      title: out.copy.title,
      // compact draws the title only; the body still travels for accessibility on clients that read it.
      body: out.copy.body,
      ...(showCountdown ? { countdown: { endsAt: localWallTime(endsAt, input.timezone), label: style.countdownLabel! } } : {}),
      primary: { label: out.copy.cta, action: paywall(state) },
      dismissible: true,
    },
  };
}

/**
 * One promo definition per state. `input` null (facts unknown) or a state
 * other than the definition's → the audience doesn't match (with a reason
 * for the trace). Disabled states and the kill switch are reported too.
 */
export function lifecyclePromoDefinitions(input: LifecycleFeedInput | null, config: ProLifecycleConfig, opts: { enabled: boolean; now: Date }): PromoDefinition[] {
  return PRO_LIFECYCLE_STATES.map((state): PromoDefinition => {
    const sc = config.states[state];
    return {
      key: PRO_LIFECYCLE_PROMO_KEYS[state],
      kind: 'promo',
      score: PRO_LIFECYCLE_SCORE,
      caps: { cooldownHoursAfterDismiss: Math.max(1, sc.snoozeDays * 24) },
      requiresState: true,
      audience: () => {
        if (!opts.enabled) return 'prompts_disabled';
        if (!sc.enabled) return 'state_disabled';
        if (!input) return 'lifecycle_unknown';
        if (input.result.state !== state) return input.result.state ? `in_${input.result.state}` : (input.result.reason ?? 'no_state');
        return null;
      },
      creatives: () => {
        if (!input) return [];
        const built = lifecycleCreative(state, config, input, opts.now);
        if ('error' in built) {
          console.warn(`[pro-lifecycle] ${state} card dropped: ${built.error}`);
          return [];
        }
        return [built.creative];
      },
    };
  });
}

/** Promo keys that make the evergreen Pro upsells step aside while present. */
export const LIFECYCLE_PROMO_KEY_SET: ReadonlySet<string> = new Set(Object.values(PRO_LIFECYCLE_PROMO_KEYS));
/** Upsells suppressed while a lifecycle card is in the feed. */
export const SUPERSEDED_PROMO_KEYS: ReadonlySet<string> = new Set(['pro_value']);
export const SUPERSEDED_CARD_TYPES: ReadonlySet<string> = new Set(['pro_upsell']);
