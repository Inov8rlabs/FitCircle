/**
 * Server-driven home feed — shared types (docs/HOME_FEED_SPEC.md).
 *
 * Everything in lib/home-feed is pure (no I/O) except context.ts, which only
 * runs the injected loaders. DB access lives in services/home-feed-service.ts.
 */

/** Response schema versions this server can produce (X-Feed-Schema). */
export const SUPPORTED_FEED_SCHEMAS = [1] as const;
export type FeedSchema = (typeof SUPPORTED_FEED_SCHEMAS)[number];

export type AppPlatform = 'ios' | 'android' | 'web';

/** A card type string. Known v1 types live in catalog.ts; rules may name future types. */
export type CardType = string;

export type CardSection = 'top' | 'main';

/** One card in the response (spec §2). */
export interface FeedCard {
  id: string;
  type: CardType;
  version: number;
  variant?: string;
  props?: Record<string, unknown>;
  dismissible?: boolean;
  section?: CardSection;
}

export interface FeedExperiment {
  key: string;
  arm: string;
}

/** GET /api/mobile/home-feed 200 body (schema 1). */
export interface HomeFeedResponse {
  schema: FeedSchema;
  decision_id: string;
  generated_at: string;
  ttl_seconds: number;
  layout_key: string;
  experiment: FeedExperiment | null;
  cards: FeedCard[];
}

/** What the client said it can render: type → highest version it supports. */
export type ClientCardSupport = Map<CardType, number>;

/** An eligible card before ranking. */
export interface Candidate {
  id: string;
  type: CardType;
  version: number;
  props?: Record<string, unknown>;
  variant?: string;
}

/** A ranked card: candidate + score + per-decision annotations. */
export interface ScoredCard extends Candidate {
  score: number;
  /** Total boost applied by rules (tie-break: more boost wins a tied score). */
  boost: number;
}

/**
 * Everything the rankers and audience filters may look at. Tri-state fields:
 * `null` means "unknown" (the loader failed or timed out) — eligibility hints
 * never drop a card on an unknown, and audience filters never match one.
 */
export interface FeedContext {
  userId: string;
  now: Date;
  platform: AppPlatform | null;
  appVersion: string | null;
  appBuild: number | null;
  timezone: string;
  /** Local calendar day (YYYY-MM-DD) in `timezone`. */
  localDate: string;
  /** 0–23 local hour in `timezone`. */
  localHour: number;
  /** 0 = Sunday … 6 = Saturday, local. */
  localWeekday: number;
  daysSinceSignup: number | null;
  isPro: boolean | null;
  subscriptionsEnabled: boolean | null;
  hasCircle: boolean | null;
  circleCount: number | null;
  /** null = unknown; { present:false } = known: no campaign for this viewer. */
  campaign: { present: boolean; slug: string | null; phase: string | null } | null;
  referralProgramEnabled: boolean | null;
  checkedInToday: boolean | null;
  /** No check-in today and local hour ≥ 18 (false when unknown). */
  streakAtRisk: boolean;
  waterLoggedToday: boolean | null;
  /** Hint only: the client still enforces ads eligibility (flag + consent + non-premium). */
  adsEligible: boolean | null;
}
