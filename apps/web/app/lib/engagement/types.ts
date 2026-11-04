/**
 * Lifecycle messaging (docs/ENGAGEMENT_MESSAGING.md): the shapes shared by the
 * message definitions, the renderers, the adapters and the dispatcher.
 *
 * Everything here is FitCircle-agnostic on purpose — FitCircle tables are only
 * touched inside ./adapters/fitcircle-*. When this module moves into Engage the
 * types map 1:1 onto Engage's content object (blocks) and adapter contracts.
 */

export type Channel = 'email' | 'push';

/** utm_medium of a link: engagement messages vs account mail. */
export type Medium = 'lifecycle' | 'transactional';

/** Stable message keys. Frozen once shipped (analytics + ledger group by them). */
export type MessageKey =
  | 'welcome'
  | 'weekly_report'
  | 'onboarding_first_meal'
  | 'onboarding_first_circle'
  | 'onboarding_invite_friend'
  | 'reengage_comeback'
  | 'celebrate_streak';

/**
 * Why a due message was not sent. Mirrors the tracking plan enum
 * `lifecycle_skip_reason`.
 */
export type SkipReason =
  | 'consent'
  | 'cooldown'
  | 'cap'
  | 'dormant'
  | 'no_data'
  | 'flag_off'
  | 'holdout'
  | 'no_email'
  | 'bounced'
  | 'push_suppressed'
  | 'already_sent'
  | 'ledger_unavailable';

/** Screens a CTA / push can open (the push wire contract's NotificationScreen subset). */
export type AppScreen =
  | 'dashboard'
  | 'food_log'
  | 'exercise_log'
  | 'circles'
  | 'invite_hub'
  | 'streaks'
  | 'campaign'
  | 'fitzy_chat';

// ---------------------------------------------------------------------------
// Content model: typed blocks, rendered by render/email.ts and render/push.ts.
// ---------------------------------------------------------------------------

/** A link a block points at. Built by links.ts (UTM + attribution params). */
export interface Cta {
  /** Stable CTA id inside the message (`utm_term`), e.g. 'primary', 'growth'. */
  id: string;
  label: string;
  url: string;
}

export type Accent = 'violet' | 'orange' | 'green' | 'cyan' | 'pink' | 'gold';

export interface HeroBlock {
  kind: 'hero';
  eyebrow?: string;
  title: string;
  body: string;
}

export interface StatTile {
  id: string;
  label: string;
  value: string;
  /** e.g. "+2 vs last week" — only when last week has comparable data. */
  delta?: string;
  trend?: 'up' | 'down' | 'flat';
  accent: Accent;
}

export interface StatGridBlock {
  kind: 'stat_grid';
  title: string;
  tiles: StatTile[];
}

export interface CelebrationBlock {
  kind: 'celebration';
  eyebrow: string;
  title: string;
  body: string;
}

export interface GoalsBlock {
  kind: 'goals';
  title: string;
  intro?: string;
  items: Array<{ title: string; detail: string }>;
}

export interface CircleBlock {
  kind: 'circle';
  title: string;
  rows: Array<{ name: string; line: string }>;
}

export interface GrowthBlock {
  kind: 'growth';
  /** Growth slot variant id (invite_friend, create_circle, join_campaign …). */
  variant: string;
  eyebrow: string;
  title: string;
  body: string;
  cta: Cta;
}

export interface TextBlock {
  kind: 'text';
  body: string;
}

export interface ListBlock {
  kind: 'list';
  title?: string;
  items: Array<{ title: string; detail: string; accent: Accent }>;
}

export interface CtaBlock {
  kind: 'cta';
  cta: Cta;
  /** Small line under the button. */
  note?: string;
}

export type ContentBlock =
  | HeroBlock
  | StatGridBlock
  | CelebrationBlock
  | GoalsBlock
  | CircleBlock
  | GrowthBlock
  | TextBlock
  | ListBlock
  | CtaBlock;

/** One email: subject + preheader + blocks. */
export interface EmailContent {
  subject: string;
  preheader: string;
  greeting?: string;
  blocks: ContentBlock[];
  /** Why the person gets this (footer). */
  footerReason: string;
}

/** One push, rendered through NotificationOrchestrator. */
export interface PushContent {
  title: string;
  body: string;
  screen: AppScreen;
}

/** What a message definition produces for one user and period. */
export interface MessagePlan {
  messageKey: MessageKey;
  periodKey: string;
  medium: Medium;
  templateVersion: string;
  /** Variant ids, flattened into `variant` (`hero:best_week|subject:2|growth:invite_friend`). */
  variants: Record<string, string>;
  /** Goal used for conversion attribution. */
  goalKey: string;
  email?: EmailContent;
  push?: PushContent;
  /** Non-sensitive extra ledger meta (week_type, growth_slot …). */
  meta?: Record<string, string | number | boolean>;
}

/** `variants` → the single ledger/analytics `variant` string. Stable key order. */
export function variantString(variants: Record<string, string>): string {
  return Object.keys(variants)
    .sort()
    .map((k) => `${k}:${variants[k]}`)
    .join('|');
}
