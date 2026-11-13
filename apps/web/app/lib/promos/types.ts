/**
 * Promo cards (docs/PROMO_CARD_SPEC.md, docs/ACTIVATION_JOURNEY_SPEC.md §3) —
 * shared types. Everything in lib/promos is pure; I/O lives in
 * services/promo-service.ts and the home-feed context loaders.
 */
import type { IconKey } from '@/lib/design/icons';

import type { MealReminderPrefs, MealSlot } from '../journey/meal-slots';

export const PROMO_LAYOUTS = ['hero', 'banner', 'compact'] as const;
export type PromoLayout = (typeof PROMO_LAYOUTS)[number];

/** Card type + version the clients declare in `cards=` (promo@1). */
export const PROMO_CARD_TYPE = 'promo';
export const PROMO_CARD_VERSION = 1;

/** `promo:<key>` — the home-feed card id (also what rules and events reference). */
export const promoCardId = (key: string) => `promo:${key}`;
export const promoKeyFromCardId = (id: string): string | null => (id.startsWith('promo:') ? id.slice('promo:'.length) || null : null);

/** A server-side action definition (may carry a fallback chain). */
export interface PromoAction {
  type: string;
  /** Registry version this action needs (default 1). */
  version?: number;
  params?: Record<string, unknown>;
  fallback?: PromoAction[];
}

/** What the client receives: resolved (supported, validated), no fallback. */
export interface WireAction {
  type: string;
  params: Record<string, unknown>;
}

export interface PromoButton<A = PromoAction> {
  label: string;
  action: A;
  /** promo_style@1 clients only (style.ts, docs/PROMO_BUTTON_STYLE_SPEC.md). Never on the server-side creative. */
  style?: WireButtonStyle;
}

/** A resolved button style on the wire (presets expanded, label colour concrete). */
export interface WireButtonStyle {
  kind: 'white' | 'solid' | 'gradient';
  /** Named preset this came from (analytics / debugging only; clients draw from the fields). */
  preset?: string;
  /** white / solid: the fill. */
  fill?: string;
  /** gradient: 2–3 stops + CSS angle in degrees (90 = leading → trailing). */
  gradient?: { colors: string[]; angle: number };
  /** Label (and icon) colour, always concrete #RRGGBB. */
  text: string;
  /** Optional leading icon key (design/icons.json). */
  icon?: IconKey;
}

export type CardSurface = 'gradient' | 'dark';

export type PromoBackground = { kind: 'gradient'; colors: string[] } | { kind: 'solid'; color: string };

export interface PromoTheme {
  background: PromoBackground;
  accent?: string;
  foreground: 'light' | 'dark';
}

export interface PromoImage {
  url: string;
  darkUrl?: string | null;
  aspect: '16:9' | '1:1';
  focal?: { x: number; y: number };
  alt: string;
}

/** One creative variant (server form: actions unresolved). */
export interface PromoCreative {
  id: string;
  /** Share of users (0–100) for A/B; weights are relative. */
  weight: number;
  layout: PromoLayout;
  theme: PromoTheme;
  /** Icon key (design/icons.json) shown when there is no image (gradient + icon). */
  icon?: IconKey;
  /** Legacy glyph for shipped apps (≤ 1.1.x); nulled for 1.2.0+ (applyIconCompat). */
  emoji?: string;
  image?: PromoImage;
  eyebrow?: string;
  title: string;
  body?: string;
  badge?: { text: string; tone: string };
  countdown?: { endsAt: string; label: string };
  primary: PromoButton;
  secondary?: PromoButton;
  dismissible: boolean;
}

/** promo@1 card `props` (PROMO_CARD_SPEC §3) — actions resolved for this client. */
export interface PromoProps {
  promoId: string;
  creativeId: string;
  layout: PromoLayout;
  theme: PromoTheme;
  icon?: IconKey;
  /** Legacy glyph: `null` for 1.2.0+ clients. */
  emoji?: string | null;
  image?: PromoImage;
  eyebrow?: string;
  title: string;
  body?: string;
  badge?: { text: string; tone: string };
  countdown?: { endsAt: string; label: string };
  primary: PromoButton<WireAction>;
  secondary?: PromoButton<WireAction>;
  dismissible: boolean;
  /** promo_style@1 only: `dark` = the Home card surface instead of theme.background (legacy clients: absent). */
  surface?: CardSurface;
  /** promo_style@1 only: eyebrow text colour (absent = the default eyebrow colour). */
  eyebrowColor?: string;
}

export interface PromoCaps {
  perDay?: number;
  /** Distinct local days with an impression in the last 7 days. */
  perWeek?: number;
  total?: number;
  cooldownHoursAfterDismiss?: number;
  hideAfterConversion?: boolean;
}

/** promo_user_state row (camelCased). */
export interface PromoUserState {
  promoKey: string;
  creativeId: string | null;
  impressionsTotal: number;
  impressionsDay: number;
  /** Local date of impressions_day. */
  day: string | null;
  /** Distinct local days with impressions, newest first. */
  seenDays: string[];
  dismissedAt: string | null;
  tappedAt: string | null;
  convertedAt: string | null;
}

/**
 * Per-user activation facts the system promos need (one indexed read each,
 * inside the feed's 250 ms context round). `null` = unknown → never matches.
 */
export interface JourneyContext {
  /** ≥ 1 food entry ever. */
  hasLoggedMeal: boolean | null;
  /** Slots counted as logged today (meal_type or entry time — meal-slots.ts). */
  loggedSlotsToday: MealSlot[] | null;
  /** Most recent food entry (seeds the meet_fitzy prompt). */
  lastMeal: { title: string | null; mealType: string | null } | null;
  /** profiles.created_at. */
  signupAt: string | null;
  /** profiles.fitzy_opened_at; undefined when the column doesn't exist yet (pre-110) → unknown. */
  fitzyOpenedAt: string | null | undefined;
  mealReminderPrefs: MealReminderPrefs;
  /** Local minutes after midnight (slot windows need minutes, not just the hour). */
  localMinutes: number;
  /**
   * TRIAL_FIRST_SPEC §3: Fitzy has real input for personalized recommendations
   * (onboarding complete AND at least one goal). null = unknown (columns absent).
   */
  fitzyRecommendationsReady?: boolean | null;
  /** Server's best guess that the user can still start the free trial (trial-eligibility.ts). */
  trialEligible?: boolean;
  /** Free-trial length for trial copy (remote config `trial_days` for this request); undefined → code default. */
  trialDays?: number;
  /** A REAL free weekly-plan preview exists (plan-warmup.ts). null/undefined = not read → the teaser doesn't match. */
  fitzyPlanReady?: boolean | null;
  /**
   * The latest health_sync_update push delivered in the last 24 h and not opened
   * (docs/PUSH_NOTIFICATIONS.md §8.5) — the `synced_while_away` card repeats its facts.
   * null/undefined = none or not read.
   */
  healthSyncAway?: { title: string; body: string; kind: string } | null;
}

/** What the client said it can render and run (`cards=…promo@1`, `actions=`, `promoLayouts=`). */
export interface PromoClientSupport {
  /** promo@1 declared in cards=. */
  promoCard: boolean;
  /** action type → highest version. Missing `actions=` → only dismiss@1. */
  actions: Map<string, number>;
  layouts: Set<PromoLayout>;
  /**
   * Optional promo features (`features=promo_style@1` query and/or X-Client-Features: promo_style@1),
   * name → highest version. Missing → none: the payload is exactly what shipped clients get.
   */
  features?: Map<string, number>;
}
