/**
 * FitCircle Engage shapes shared by the backend, the admin tool, the web app
 * and (as the reference for their models) iOS and Android.
 * Contract: docs/ENGAGE_SPEC.md.
 */

export type EngageChannel = 'content_card' | 'in_app' | 'push' | 'email';
export type Placement = 'home_hero' | 'home_feed' | 'circles_top' | 'profile_top' | 'post_checkin';
export type CardLayout = 'hero' | 'card' | 'banner' | 'captioned_image' | 'image_only';
export type InAppLayout = 'modal' | 'slideup' | 'fullscreen';
export type EngageLayout = CardLayout | InAppLayout;
export type MessageStatus = 'draft' | 'scheduled' | 'live' | 'paused' | 'ended' | 'archived';
export type EngagePlatform = 'ios' | 'android' | 'web';

export const PLACEMENT_MAX: Record<Placement, number> = {
  home_hero: 1,
  home_feed: 3,
  circles_top: 2,
  profile_top: 1,
  post_checkin: 1,
};

export const ENGAGE_CAPS = { inAppPer24h: 2, inAppPerSession: 1 } as const;

// ---------------------------------------------------------------- assets
export interface AssetVariant {
  width: number;
  url: string;
  format: 'webp' | 'png' | 'jpeg' | 'gif';
}

export interface EngageAsset {
  id: string;
  sha256: string;
  name: string;
  mime: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif';
  width: number;
  height: number;
  bytes: number;
  url: string;
  variants: AssetVariant[];
  dominantColor: string;
  tags: string[];
  alt: string | null;
  usageCount?: number;
  createdAt: string;
}

/** What apps receive in place of `{ assetId }`. */
export interface AssetRef {
  id: string;
  url: string;
  variants: AssetVariant[];
  width: number;
  height: number;
  dominantColor: string;
  alt: string | null;
}

// ---------------------------------------------------------------- content
export type ActionType = 'deeplink' | 'url' | 'invite' | 'paywall' | 'start_circle' | 'campaign' | 'screen' | 'dismiss';
export interface EngageAction {
  type: ActionType;
  value?: string | null;
}

export interface EngageButton {
  label: string;
  action: EngageAction;
  style: 'primary' | 'secondary';
}

export interface EngageTheme {
  background?: string;
  text?: string;
  accent?: string;
  buttonBackground?: string;
  buttonText?: string;
}

/** Authoring shape (image referenced by asset id). */
export interface MessageContent {
  image?: { assetId: string } | null;
  imageAlt?: string | null;
  title: string;
  body: string;
  badge?: string | null;
  buttons: EngageButton[];
  theme: EngageTheme;
  imageFit: 'cover' | 'contain';
  dismissible: boolean;
  pinned: boolean;
}

/** Delivered shape: personalisation applied, image expanded. */
export interface RenderedContent extends Omit<MessageContent, 'image'> {
  image: AssetRef | null;
}

export interface PushContent {
  title: string;
  body: string;
  image?: { assetId: string } | null;
  action: EngageAction;
}

export interface EmailContent {
  subject: string;
  preheader: string;
  heading: string;
  body: string;
  image?: { assetId: string } | null;
  ctaLabel: string;
  action: EngageAction;
}

export type PlatformOverrides<C> = Partial<Record<EngagePlatform, Partial<C>>>;

export interface MessageVariant<C = MessageContent | PushContent | EmailContent> {
  id: string; // 'A' | 'B' | …
  name: string;
  weight: number; // 0–100; weights + controlWeight = 100
  content: C;
  /** Partial content merged over `content` for the caller's platform (ENGAGE_SPEC §15). */
  platformOverrides?: PlatformOverrides<C>;
}

// ---------------------------------------------------------------- targeting
export type AttributeKey =
  | 'platform' | 'days_since_signup' | 'is_pro' | 'current_streak' | 'last_active_days'
  | 'active_circle_count' | 'has_active_circle' | 'referral_qualified_count' | 'campaign_joined'
  | 'country' | 'timezone' | 'app_version' | 'email_opt_in' | 'push_enabled' | 'random_bucket';

export type FilterOp = 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'not_in' | 'exists' | 'not_exists';

export interface FilterCondition {
  key: AttributeKey;
  op: FilterOp;
  value?: string | number | boolean | Array<string | number> | null;
}

export interface EngageSegment {
  id: string;
  name: string;
  description: string;
  filters: FilterCondition[];
  estimatedCount: number | null;
  estimatedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type AppEventName =
  | 'app_open' | 'screen_view' | 'check_in_completed' | 'streak_milestone' | 'circle_created'
  | 'circle_joined' | 'invite_sent' | 'subscription_started' | 'door_opened' | 'workout_logged' | 'meal_logged';

export interface TriggerFilter {
  key: string; // event prop name
  op: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'in';
  value: string | number | boolean | Array<string | number>;
}

export interface InAppTrigger {
  event: AppEventName;
  filters?: TriggerFilter[];
  delaySeconds: number; // 0–30
}

export interface ConversionGoal {
  event: AppEventName;
  windowHours: number; // 1–168
  basis: 'click' | 'impression';
}

// ---------------------------------------------------------------- messages
export interface MessageInput {
  name: string;
  campaignId: string | null;
  channel: EngageChannel;
  placement: Placement | null; // content_card only
  layout: EngageLayout | null; // content_card / in_app
  variants: MessageVariant[];
  controlWeight: number; // 0–50
  segmentId: string | null;
  audienceFilters: FilterCondition[];
  platforms: EngagePlatform[]; // empty = all
  startsAt: string; // ISO
  endsAt: string | null;
  sendMode: 'immediate' | 'scheduled' | 'local_time' | null; // push/email
  sendAt: string | null;
  localHour: number | null;
  trigger: InAppTrigger | null; // in_app
  maxImpressionsPerUser: number | null;
  minHoursBetween: number | null;
  priority: number;
  respectGlobalCap: boolean;
  conversion: ConversionGoal | null;
}

/** Light last-N-day stats on list rows (GET /api/admin/engage/messages). */
export interface MessageSummary {
  days: number;
  /** Impressions per day, oldest first (sends for push/email) — the sparkline. */
  daily: number[];
  dailyClicks: number[];
  impressions: number;
  clicks: number;
  uniqueImpressions: number;
  uniqueClicks: number;
  ctr: number | null;
  conversions: number;
  conversionRate: number | null;
  /** Push/email deliveries (control excluded). */
  sent: number;
}

export interface EngageMessage extends MessageInput {
  id: string;
  status: MessageStatus;
  published: boolean;
  pausedAt: string | null;
  previewUserIds: string[];
  version: number;
  createdAt: string;
  updatedAt: string;
  /** List endpoint only: last-7-day stats. */
  summary?: MessageSummary;
}

// ---------------------------------------------------------------- delivery
export interface CardView {
  messageId: string;
  variantId: string;
  layout: CardLayout;
  placement: Placement;
  priority: number;
  content: RenderedContent;
  campaignSlug: string | null;
}

export interface InAppView {
  messageId: string;
  variantId: string;
  layout: InAppLayout;
  priority: number;
  trigger: InAppTrigger;
  content: RenderedContent;
  maxImpressions: number | null;
  minHoursBetween: number | null;
  impressionsSoFar: number;
  lastShownAt: string | null;
  respectGlobalCap: boolean;
}

export interface EngageResponse {
  cards: Partial<Record<Placement, CardView[]>>;
  inApp: InAppView[];
  prefetch: AssetRef[];
  heroCampaignSlug: string | null;
  caps: { inAppPer24h: number; inAppPerSession: number };
  fetchedAt: string;
}

export type EngageEventType = 'impression' | 'click' | 'dismiss' | 'push_open' | 'app_event';

export interface EngageEventInput {
  type: EngageEventType;
  messageId?: string | null;
  variantId?: string | null;
  buttonIndex?: number | null;
  name?: AppEventName | null;
  props?: Record<string, string | number | boolean | null>;
  at: string;
}

// ---------------------------------------------------------------- analytics
export interface VariantStats {
  variantId: string; // 'control' for the holdout
  platform?: EngagePlatform | 'all';
  exposedUsers: number;
  impressions: number;
  uniqueImpressions: number;
  uniqueClicks: number;
  ctr: number | null;
  dismissals: number;
  conversions: number;
  conversionRate: number | null;
  liftVsControl: number | null;
  pValue: number | null;
  pushSent?: number;
  pushOpens?: number;
  emailSent?: number;
}

export interface MessageStats {
  messageId: string;
  from: string;
  to: string;
  variants: VariantStats[];
  daily: Array<{ date: string; impressions: number; clicks: number; conversions: number }>;
  channel?: EngageChannel;
  /** The ?platform= filter applied to `variants` and `daily` ('all' when none). */
  platform?: EngagePlatform | 'all';
  /** Every variant × platform (ios, android, web) — the per-platform columns (§15). */
  byPlatform?: VariantStats[];
  /** Treated users only (control excluded): exposed → impression → click → conversion (unique users). */
  funnel?: { exposed: number; impressions: number; clicks: number; conversions: number };
}
