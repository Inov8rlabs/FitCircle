/**
 * Remote config registry (docs/TRIAL_FIRST_SPEC.md §6). Keys, types, bounds and code
 * defaults live here: adding a key needs a deploy, changing a value (Admin Tools →
 * remote_config_defaults / remote_config_rules) does not.
 *
 * Types: `int` (bounded integer), `enum` (one of `options`), `string_list` (array of
 * strings matching `itemPattern`, at most `maxItems`). Server-side only: no client
 * endpoint serves these values, EXCEPT the keys in CLIENT_VISIBLE_KEYS, which
 * GET /api/mobile/paywall/config serves (docs/PAYWALL_DEFAULT_PLAN.md). That route
 * reads exactly those keys by name; it never takes a key from the request.
 *
 * Premium abuse ceilings are deliberately NOT here (lib/config/tier-limits.ts).
 */

import { REVIEW_EMAILS, TEST_LAB_DOMAINS } from '@/lib/ads/test-users';
import { SHIELD_RULES } from '@/lib/streaks/streak-config';

export type RemoteConfigType = 'int' | 'enum' | 'string_list';

export type RemoteConfigValue = number | string | string[];

interface KeyDefBase {
  unit: string;
  description: string;
}

export interface IntKeyDef extends KeyDefBase {
  type: 'int';
  /** Served when no rule matches and no admin default is set (or both are invalid). */
  default: number;
  min: number;
  max: number;
}

export interface EnumKeyDef extends KeyDefBase {
  type: 'enum';
  default: string;
  options: readonly string[];
}

export interface StringListKeyDef extends KeyDefBase {
  type: 'string_list';
  default: readonly string[];
  maxItems: number;
  /** Every item must match this (RegExp source, anchored). */
  itemPattern: string;
}

export type RemoteConfigKeyDef = IntKeyDef | EnumKeyDef | StringListKeyDef;

/** An exact email, or `@domain` (empty local part) for every address at that domain. */
const EMAIL_OR_DOMAIN_PATTERN = '^[^\\s@]*@[A-Za-z0-9-]+(\\.[A-Za-z0-9-]+)+$';

const UUID_PATTERN = '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';

export const REMOTE_CONFIG_REGISTRY = {
  free_food_ai_analyses_total: {
    type: 'int',
    default: 5,
    min: 0,
    max: 1000,
    unit: 'analyses (lifetime)',
    description: 'Lifetime AI food analyses (photo, voice, describe, Fix, estimate-item) for non-paying users. Pro / trial users only have the daily abuse ceiling.',
  },
  free_fitzy_messages_per_day: {
    type: 'int',
    default: 0,
    min: 0,
    max: 200,
    unit: 'messages/day',
    description: 'Fitzy chat messages per UTC day for non-paying users. 0 = chat requires Pro or a free trial (the first message opens the paywall).',
  },
  trial_days: {
    type: 'int',
    default: 7,
    min: 1,
    max: 31,
    unit: 'days',
    description:
      'Length of the FitCircle Pro free trial: the Stripe web checkout trial (platform web) and every server-written trial promise (paywall headlines, food AI / Fitzy upgrade messages, promo cards, Pro lifecycle copy). MUST equal the App Store / Play intro offer for that platform. Change it with Admin Tools → Free trial (trial sync, docs/TRIAL_SYNC.md), which updates both stores first and then this default.',
  },
  integrity_enforce_android: {
    type: 'enum',
    default: 'block',
    options: ['block', 'log', 'off'],
    unit: 'mode',
    description:
      'Android app-integrity checks for clients that declare integrity_v1. block = a failing device gets 403 INTEGRITY_FAILED; log = verify and record but allow; off = skip verification.',
  },
  integrity_device_error_fail_open: {
    type: 'enum',
    default: 'true',
    options: ['true', 'false'],
    unit: 'boolean',
    description:
      'true = an integrity_v1 client with no token because of its phone (outdated Play Store / Play services, Play unreachable, timeouts) is allowed and recorded as device_error:<code>. false = those requests are blocked again (missing_token).',
  },
  integrity_internal_error_policy: {
    type: 'enum',
    default: 'block',
    options: ['block', 'fail_open'],
    unit: 'mode',
    description:
      'What an integrity_v1 Android request gets when the integrity check breaks on OUR side (a bug: request body read before the check, unexpected exception). block = 503 INTEGRITY_UNAVAILABLE, retryable ("try again"; never the device-block screen; refresh keeps the session). fail_open = allow and record (the pre-2026-11-13 behaviour). Emergency switch only: Google / network / database outages always fail open regardless.',
  },
  integrity_bypass_user_ids: {
    type: 'string_list',
    default: [],
    maxItems: 200,
    itemPattern: UUID_PATTERN,
    unit: 'user ids',
    description: 'Internal test accounts allowed to sign in and stay signed in (login + refresh only) from builds that fail the Android integrity check.',
  },
  integrity_reviewer_emails: {
    type: 'string_list',
    default: [...REVIEW_EMAILS, ...TEST_LAB_DOMAINS.map((d) => `@${d}`)],
    maxItems: 200,
    itemPattern: EMAIL_OR_DOMAIN_PATTERN,
    unit: 'emails / @domains',
    description:
      'App Store / Play reviewer and pre-launch robot accounts never blocked by the app-integrity check. Exact emails apply to login (after the password check), Google sign-in (verified id token) and refresh (verified refresh token); @domain entries apply to Google sign-in only (the only place the mailbox is proven). Never on register. Platform-agnostic (Android Play Integrity now, iOS App Attest later).',
  },
  // Retention fixes (2026-11-09). Kill switches: set the default to 'off' in Admin Tools.
  day1_morning_push: {
    type: 'enum',
    default: 'on',
    options: ['on', 'off'],
    unit: 'switch',
    description:
      'Day-1 morning push: one personalised push the local morning after sign-up (circle / breakfast / start-a-circle), skipped when the user already opened the app that morning. Daily cap, quiet hours and the Journey toggle still apply. off = never sent (a rule can turn it off for one platform or channel).',
  },
  day1_morning_push_hour: {
    type: 'int',
    default: 8,
    min: 6,
    max: 11,
    unit: 'local hour',
    description: 'Local hour the Day-1 morning push starts going out (sent from :00 to :59 of this hour, user-local time).',
  },
  quiet_hours_deferral: {
    type: 'enum',
    default: 'on',
    options: ['on', 'off'],
    unit: 'switch',
    description:
      'on = setup / meal-reminder / Day-1 pushes that hit quiet hours are held and released at the end of quiet hours (user-local, at most one held push per user per morning, cap re-checked). off = they are dropped as before.',
  },
  // Paywall default plan (docs/PAYWALL_DEFAULT_PLAN.md). Served to the apps by
  // GET /api/mobile/paywall/config (iOS 1.1.4 b98+, Android 1.1.4 vc61+; older apps keep monthly).
  paywall_default_plan: {
    type: 'enum',
    default: 'annual',
    options: ['annual', 'monthly'],
    unit: 'plan',
    description:
      'Plan pre-selected when a paywall opens (onboarding, standard, contextual, Locked). A deep-link plan= or an experiment arm that forces a plan (e.g. annualOnly) still wins. Read by the apps at launch / sign-in and re-checked when the paywall opens.',
  },
  paywall_badge_plan: {
    type: 'enum',
    default: 'annual',
    options: ['annual', 'monthly', 'none'],
    unit: 'plan',
    description:
      'Plan row that shows the "Best value" badge on the paywall. none = no badge. Hidden when that plan is not in the store offering.',
  },
  // Streak shield economy (docs/STREAKS-SPEC.md). Served to every app and the web
  // as `shield_rules` on the streak responses, so no client hard-codes these numbers.
  streak_shield_earn_interval_days: {
    type: 'int',
    default: SHIELD_RULES.EARN_INTERVAL_DAYS,
    min: 3,
    max: 60,
    unit: 'streak days',
    description:
      'Free users earn exactly 1 streak shield each time their streak reaches a multiple of this many days (7 = day 7, 14, 21, ...). Pro users have unlimited shields. Never retroactive: only streak growth after the change earns at the new interval.',
  },
  streak_shield_starter_count: {
    type: 'int',
    default: SHIELD_RULES.STARTER_SHIELDS,
    min: 0,
    max: 3,
    unit: 'shields',
    description:
      'Shields a new user starts with, granted once when they complete onboarding (an inventory first created any other way starts with the same number). Never above the max balance. Existing users are not topped up when this changes.',
  },
  streak_shield_max_balance: {
    type: 'int',
    default: SHIELD_RULES.MAX_SHIELD_BALANCE,
    min: 1,
    max: 10,
    unit: 'shields',
    description:
      'Most shields a free user can bank across all shield types (earned, starter, bought with XP). Shields earned while the bank is full are dropped. Lowering it never takes shields away; users above it just stop earning until they are below it.',
  },
  // Trial timeline on every paywall placement (docs/ENGAGEMENT_115_SPEC.md §14.1). Served as
  // `trialTimeline: boolean` by GET /api/mobile/paywall/config (1.1.5 apps; older apps ignore it).
  paywall_trial_timeline: {
    type: 'enum',
    default: 'on',
    options: ['on', 'off'],
    unit: 'switch',
    description:
      'on = every paywall placement shows the trial timeline (today / reminder / first charge) under the plan cards when the selected plan has a confirmed free trial (never shown otherwise). off = hidden on every placement except where the onboarding_paywall arm payload trial_timeline says true (the arm payload wins on onboarding).',
  },
  // Release 1.1.5 engagement (docs/ENGAGEMENT_115_SPEC.md §8). The daily-scan and weekly-Fitzy
  // allowances stay 0 by default; deploy adds `{platforms:['ios'|'android'], appVersionGte:'1.1.5'}`
  // rules (→ 2 and → 3). Requests without a version (crons, web, old builds) resolve 0 = 1.1.4 behaviour.
  free_food_ai_daily_after_total: {
    type: 'int',
    default: 0,
    min: 0,
    max: 50,
    unit: 'scans per local day',
    description:
      'Free AI scans per local day (X-Client-Timezone) once the lifetime starter allowance (free_food_ai_analyses_total) is used up. 0 = none (the starter allowance is all a free user gets, 1.1.4 behaviour). Only give it to apps >= 1.1.5 via version rules: older apps pre-gate on the lifetime count.',
  },
  free_fitzy_messages_per_week: {
    type: 'int',
    default: 0,
    min: 0,
    max: 100,
    unit: 'messages per local week (Mon 00:00)',
    description:
      'Free Fitzy messages per local week (Monday 00:00 in X-Client-Timezone). > 0 replaces free_fitzy_messages_per_day for that request. 0 = off (the daily key applies). Onboarding-tour messages and messages sent on a trial never count. Only for apps >= 1.1.5 via version rules.',
  },
  meal_share_prompt: {
    type: 'enum',
    default: 'on',
    options: ['on', 'off'],
    unit: 'switch',
    description:
      'Served as entitlements clientConfig.mealSharePrompt. on = the 1.1.5 meal-logged success sheet shows the "Share to circles" card (nothing is posted until the user taps Share). off = the success sheet shows without the card.',
  },
  meal_share_large_circle_threshold: {
    type: 'int',
    default: 20,
    min: 2,
    max: 500,
    unit: 'active members',
    description:
      'Circles with more active members than this (the user included) start with the share toggle OFF on the meal-logged success sheet (share-targets reason large_circle).',
  },
  streak_save_offer: {
    type: 'enum',
    default: 'on',
    options: ['on', 'off'],
    unit: 'switch',
    description:
      'on = the next-day push for a free user whose streak broke with no shield is a streak_save_offer (save it with Pro), and entitlements clientConfig.streakSaveOffer shows the dashboard "Save your streak" card instead of the auto-fired shield paywall. off = a plain dont_miss_twice push and the old dashboard behaviour.',
  },
  streak_save_offer_min_streak: {
    type: 'int',
    default: 3,
    min: 2,
    max: 30,
    unit: 'streak days',
    description: 'Smallest lost streak that gets a streak save offer (push + GET /streaks/save-offer). Shorter streaks get the streak_restart variant.',
  },
  streak_milestone_push: {
    type: 'enum',
    default: 'on',
    options: ['on', 'off'],
    unit: 'switch',
    description:
      'on = a milestone_achieved push when a streak milestone was reached but the app did not show the celebration in-app (no streak_celebration_v1 client feature, or a background sync claim). off = never pushed (the in-app pending celebration still works).',
  },
  dont_miss_twice_push: {
    type: 'enum',
    default: 'on',
    options: ['on', 'off'],
    unit: 'switch',
    description:
      'Per-user switch for the next-day "Don\'t miss twice" / streak save push (cron, so only userIds / percent rules match: there is no platform or version). The hard kill is the env DONT_MISS_TWICE_PUSH_ENABLED.',
  },
  // 1.1.5 (2026-11-17): the nightly "N of M checked in today" summary cards cluttered circle chat.
  // 1.1.5 apps show a live "Today: N of M checked in" strip above the thread instead
  // (GET /circles/:id/messages todayCheckins). Global switch: the cron has no user context.
  circle_daily_summary_post: {
    type: 'enum',
    default: 'off',
    options: ['on', 'off'],
    unit: 'switch',
    description:
      'on = the nightly circle-daily-summary cron writes a daily_summary chat post ("2 of 6 checked in today") into each circle with a check-in (pre-1.1.5 behaviour). off = no chat post; the bundled circle_daily_summary push still goes out. Already-stored posts are untouched (1.1.5 apps hide them, older apps still show them). Resolved without a user (only the admin default applies).',
  },
} as const satisfies Record<string, RemoteConfigKeyDef>;

/**
 * The only keys a client endpoint may serve: the paywall keys (default plan, badge, trial timeline) via GET /api/mobile/paywall/config,
 * the 1.1.5 switches via GET /api/mobile/entitlements `clientConfig` (user-scoped).
 */
export const CLIENT_VISIBLE_KEYS = ['paywall_default_plan', 'paywall_badge_plan', 'paywall_trial_timeline', 'meal_share_prompt', 'streak_save_offer'] as const satisfies readonly RemoteConfigKey[];

export type RemoteConfigKey = keyof typeof REMOTE_CONFIG_REGISTRY;

type KeysOfType<T extends RemoteConfigType> = {
  [K in RemoteConfigKey]: (typeof REMOTE_CONFIG_REGISTRY)[K]['type'] extends T ? K : never;
}[RemoteConfigKey];

export type IntConfigKey = KeysOfType<'int'>;
export type EnumConfigKey = KeysOfType<'enum'>;
export type ListConfigKey = KeysOfType<'string_list'>;

export const REMOTE_CONFIG_KEYS = Object.keys(REMOTE_CONFIG_REGISTRY) as RemoteConfigKey[];

export function isRemoteConfigKey(key: string): key is RemoteConfigKey {
  return Object.prototype.hasOwnProperty.call(REMOTE_CONFIG_REGISTRY, key);
}

export function keyDef(key: RemoteConfigKey): RemoteConfigKeyDef {
  return REMOTE_CONFIG_REGISTRY[key];
}

/** The code default as a plain value (lists are copied). */
export function codeDefault(key: RemoteConfigKey): RemoteConfigValue {
  const def = keyDef(key);
  return def.type === 'string_list' ? [...def.default] : def.default;
}

/** Validate a value against the key's type + bounds. Returns the value or null when invalid. */
export function validValue(key: RemoteConfigKey, value: unknown): RemoteConfigValue | null {
  const def = keyDef(key);
  if (def.type === 'int') {
    if (typeof value !== 'number' || !Number.isInteger(value)) return null;
    if (value < def.min || value > def.max) return null;
    return value;
  }
  if (def.type === 'enum') {
    return typeof value === 'string' && def.options.includes(value) ? value : null;
  }
  if (!Array.isArray(value) || value.length > def.maxItems) return null;
  const re = new RegExp(def.itemPattern);
  if (!value.every((v) => typeof v === 'string' && re.test(v))) return null;
  return [...(value as string[])];
}

/** Human message for an invalid value (400 responses). */
export function valueError(key: RemoteConfigKey): string {
  const def = keyDef(key);
  if (def.type === 'enum') return `Expected one of: ${def.options.join(', ')}`;
  if (def.type === 'string_list') return `Expected an array of at most ${def.maxItems} strings matching ${def.itemPattern}`;
  return `Expected an integer between ${def.min} and ${def.max}`;
}
