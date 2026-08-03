// Body Composition — shared contract (FROZEN). docs/BODY_COMP_BUILD_CONTRACT.md §2.
// Owned by the backend; web pages and route handlers import DTO types + Zod schemas from here.
// Wire format is camelCase JSON. Canonical units: kg, kcal, percent-as-number (26.6). Clients
// convert kg↔lb (and HealthKit's 0–1 body-fat fraction ×100) at the UI/platform boundary only.
// Body-comp data is PRIVATE-ONLY: it must never appear in circles, feeds, leaderboards, or share cards.

import { z } from 'zod';

// ============================================================================
// Sources & feature keys
// ============================================================================

export const BODY_COMP_SOURCES = [
  'manual',
  'photo_scan',
  'healthkit',
  'health_connect',
  'dexa',
  'smart_scale',
] as const;
export type BodyCompSource = (typeof BODY_COMP_SOURCES)[number];

export type SubscriptionTier = 'free' | 'premium';

export const BODY_COMP_FEATURE_KEYS = [
  'body_comp_logging',
  'body_comp_photo_scan',
  'body_comp_trends',
  'body_comp_coach',
  'body_comp_segmental',
] as const;
export type BodyCompFeatureKey = (typeof BODY_COMP_FEATURE_KEYS)[number];

/** Pro gates seeded (dark) by migration 075, flipped live by 077. */
export const PRO_FEATURE_KEYS = [
  'food_ai_unlimited',
  'fitzy_unlimited',
  'history_extended',
  'circles_unlimited',
  'ads_removed',
  'data_export',
  'share_themes_custom',
  'streak_shields_bonus',
] as const;
export type ProFeatureKey = (typeof PRO_FEATURE_KEYS)[number];

export const ALL_FEATURE_KEYS = [...BODY_COMP_FEATURE_KEYS, ...PRO_FEATURE_KEYS] as const;

// ============================================================================
// Entitlements (GET /api/mobile/entitlements and GET /api/entitlements)
// ============================================================================

export interface FeatureEntitlement {
  allowed: boolean;
  requiredTier: SubscriptionTier;
}

/** Daily quota numbers for display ("2 of 5 free scans"); null = unlimited. */
export interface EntitlementLimits {
  foodAiParsesPerDay: number | null;
  fitzyMessagesPerDay: number | null;
  maxActiveCreatedCircles: number | null;
  historyDays: number | null;
}

/** Subscription display state (cache of RevenueCat truth on profiles). */
export interface EntitlementSubscription {
  status: string | null;
  platform: string | null;
  productId: string | null;
  expiresAt: string | null;
  willRenew: boolean;
}

export interface EntitlementsResponse {
  tier: SubscriptionTier;
  features: Record<string, FeatureEntitlement>;
  /** Added with subscriptions (additive — older clients ignore them). */
  limits?: EntitlementLimits;
  subscription?: EntitlementSubscription;
  /**
   * Master switch for the whole subscription surface (feature_flags row
   * 'subscriptions'). Clients hide every paywall/upgrade CTA when false.
   * Fail-CLOSED: absent or errored → false.
   */
  subscriptionsEnabled?: boolean;
}

// ============================================================================
// Metric field validation (mirrors migration 071 CHECK ranges; wider fields get
// sane API-level bounds within their numeric(p,s) column precision)
// ============================================================================

// http(s) only: zod's .url() delegates to new URL(), which also accepts
// javascript:/data: schemes — those must never be stored and echoed back to a
// client that might render a photoUrl as an href/src.
const httpUrlSchema = z
  .string()
  .url()
  .refine((u) => /^https?:\/\//i.test(u), { message: 'Only http(s) URLs are allowed' });

const weightKgSchema = z.number().min(20).max(400);
const bodyFatPctSchema = z.number().min(2).max(65);
const massKgSchema = z.number().positive().max(400);
const boneMassKgSchema = z.number().positive().max(99);
const visceralFatLevelSchema = z.number().positive().max(100);
const bmrKcalSchema = z.number().int().min(500).max(10000);

export const segmentalSegmentSchema = z.object({
  leanKg: z.number().positive().max(200),
  pctOfIdeal: z.number().positive().max(500).optional(),
});
export type SegmentalSegment = z.infer<typeof segmentalSegmentSchema>;

// Stored as given (display-only vendor construct) — no derivation, no advice.
export const segmentalDataSchema = z.object({
  trunk: segmentalSegmentSchema.optional(),
  leftArm: segmentalSegmentSchema.optional(),
  rightArm: segmentalSegmentSchema.optional(),
  leftLeg: segmentalSegmentSchema.optional(),
  rightLeg: segmentalSegmentSchema.optional(),
});
export type SegmentalData = z.infer<typeof segmentalDataSchema>;

/** The four "core" metrics — at least one must be present on every log (DB CHECK mirrors this). */
export const BODY_COMP_CORE_METRICS = [
  'weightKg',
  'bodyFatPct',
  'skeletalMuscleMassKg',
  'fatMassKg',
] as const;

function hasAtLeastOneCoreMetric(v: {
  weightKg?: number | null;
  bodyFatPct?: number | null;
  skeletalMuscleMassKg?: number | null;
  fatMassKg?: number | null;
}): boolean {
  return (
    v.weightKg != null || v.bodyFatPct != null || v.skeletalMuscleMassKg != null || v.fatMassKg != null
  );
}

// ============================================================================
// CRUD DTOs
// ============================================================================

export const bodyCompCreateSchema = z
  .object({
    measuredAt: z.string().datetime({ offset: true }),
    source: z.enum(BODY_COMP_SOURCES),
    weightKg: weightKgSchema.optional(),
    bodyFatPct: bodyFatPctSchema.optional(),
    fatMassKg: massKgSchema.optional(),
    skeletalMuscleMassKg: massKgSchema.optional(),
    leanBodyMassKg: massKgSchema.optional(),
    bodyWaterKg: massKgSchema.optional(),
    boneMassKg: boneMassKgSchema.optional(),
    visceralFatLevel: visceralFatLevelSchema.optional(),
    bmrKcal: bmrKcalSchema.optional(),
    segmental: segmentalDataSchema.optional(),
    notes: z.string().max(2000).optional(),
    photoUrls: z.array(httpUrlSchema).max(3).optional(),
    sourceExternalId: z.string().min(1).max(255).optional(),
  })
  .refine(hasAtLeastOneCoreMetric, {
    message: 'At least one of weightKg, bodyFatPct, skeletalMuscleMassKg, fatMassKg is required',
  });
export type BodyCompCreate = z.infer<typeof bodyCompCreateSchema>;

// Partial update. `null` clears an optional metric (the ≥1-core-metric rule is
// re-checked server-side against the merged row).
export const bodyCompUpdateSchema = z
  .object({
    measuredAt: z.string().datetime({ offset: true }).optional(),
    weightKg: weightKgSchema.nullable().optional(),
    bodyFatPct: bodyFatPctSchema.nullable().optional(),
    fatMassKg: massKgSchema.nullable().optional(),
    skeletalMuscleMassKg: massKgSchema.nullable().optional(),
    leanBodyMassKg: massKgSchema.nullable().optional(),
    bodyWaterKg: massKgSchema.nullable().optional(),
    boneMassKg: boneMassKgSchema.nullable().optional(),
    visceralFatLevel: visceralFatLevelSchema.nullable().optional(),
    bmrKcal: bmrKcalSchema.nullable().optional(),
    segmental: segmentalDataSchema.nullable().optional(),
    notes: z.string().max(2000).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'At least one field is required' });
export type BodyCompUpdate = z.infer<typeof bodyCompUpdateSchema>;

export const bodyCompListQuerySchema = z.object({
  start: z.string().datetime({ offset: true }).optional(),
  end: z.string().datetime({ offset: true }).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  before: z.string().datetime({ offset: true }).optional(),
});
export type BodyCompListQuery = z.infer<typeof bodyCompListQuerySchema>;

/** Which fields the SERVER computed (fat mass from weight×BF%, lean mass from weight−fat). */
export interface BodyCompDerivedFlags {
  fatMassKg?: boolean;
  leanBodyMassKg?: boolean;
}

export interface BodyCompLog {
  id: string;
  measuredAt: string;
  weightKg?: number;
  bodyFatPct?: number;
  fatMassKg?: number;
  skeletalMuscleMassKg?: number;
  leanBodyMassKg?: number;
  bodyWaterKg?: number;
  boneMassKg?: number;
  visceralFatLevel?: number;
  bmrKcal?: number;
  segmental?: SegmentalData;
  source: BodyCompSource;
  notes?: string;
  photoUrls?: string[];
  createdAt: string;
  updatedAt: string;
  derived: BodyCompDerivedFlags;
}

export interface BodyCompListResponse {
  logs: BodyCompLog[];
  hasMore: boolean;
  nextBefore: string | null;
}

// ============================================================================
// Platform import (POST /api/mobile/body-comp/import)
// ============================================================================

export const bodyCompImportItemSchema = z.object({
  externalId: z.string().min(1).max(255),
  measuredAt: z.string().datetime({ offset: true }),
  weightKg: weightKgSchema.optional(),
  bodyFatPct: bodyFatPctSchema.optional(),
  leanBodyMassKg: massKgSchema.optional(),
  bmrKcal: bmrKcalSchema.optional(),
});
export type BodyCompImportItem = z.infer<typeof bodyCompImportItemSchema>;

export const bodyCompImportRequestSchema = z.object({
  platform: z.enum(['healthkit', 'health_connect']),
  items: z.array(bodyCompImportItemSchema).max(500),
});
export type BodyCompImportRequest = z.infer<typeof bodyCompImportRequestSchema>;

export interface BodyCompImportResult {
  received: number;
  imported: number; // landed in a log row (new row or merged into a same-window row)
  skipped: number;  // externalId already imported, or item carried no metrics
}

// ============================================================================
// Trends (GET /api/mobile/body-comp/trends)
// ============================================================================

export const bodyCompTrendsQuerySchema = z.object({
  lookbackDays: z.coerce.number().int().min(28).max(730).default(180),
});
export type BodyCompTrendsQuery = z.infer<typeof bodyCompTrendsQuerySchema>;

export type BodyCompTrendState =
  | 'recomposition'
  | 'losing'
  | 'gaining'
  | 'steady'
  | 'insufficient_data';

export interface BodyCompTrendPoint {
  date: string; // YYYY-MM-DD
  weightKgSmoothed?: number;
  fatMassKg?: number;
  skeletalMuscleMassKg?: number;
  bodyFatPct?: number;
}

export interface BodyCompDelta {
  metric: string; // camelCase metric name, e.g. 'bodyFatPct'
  delta: number;
  withinNoise: boolean;
}

export interface BodyCompProjection {
  goalBodyFatPct: number;
  earliestDate: string; // YYYY-MM-DD — at the 1% BW/week clamp
  latestDate: string;   // YYYY-MM-DD — at the 0.5% BW/week clamp
}

export interface BodyCompInsight {
  id: string;
  headline: string;
  detail: string;
}

export interface BodyCompTrends {
  state: BodyCompTrendState;
  series: BodyCompTrendPoint[];
  latestVsPrevious: BodyCompDelta[];
  projection: BodyCompProjection | null;
  insights: BodyCompInsight[]; // server-written, body-neutral — clients render verbatim
  disclaimer: string;
}

// ============================================================================
// Photo-parse draft (POST /api/mobile/body-comp/photo-parse) — draft only; the
// user confirms and the client then calls POST /body-comp with source 'photo_scan'.
// ============================================================================

export interface BodyCompDraftMetric {
  value: number;
  confidence: number; // 0..1
}

export interface BodyCompDraftMetrics {
  weightKg?: BodyCompDraftMetric;
  bodyFatPct?: BodyCompDraftMetric;
  fatMassKg?: BodyCompDraftMetric;
  skeletalMuscleMassKg?: BodyCompDraftMetric;
  bodyWaterKg?: BodyCompDraftMetric;
  boneMassKg?: BodyCompDraftMetric;
  visceralFatLevel?: BodyCompDraftMetric;
  bmrKcal?: BodyCompDraftMetric;
}

// overallConfidence < 0.6 → clients fall back to the manual form pre-filled with
// whatever parsed (same rule as nutrition photo-parse).
export interface BodyCompDraft {
  measuredAt: string | null; // extracted from the sheet; user confirms/edits
  metrics: BodyCompDraftMetrics;
  segmental: SegmentalData | null;
  overallConfidence: number; // 0..1
  warnings: string[];
  model: string;
  cached: boolean;
}

// ============================================================================
// Photo-parse internals (AI layer) — added by the AI-layer build; NOT part of
// the frozen wire contract. This is the Zod schema the vision model's raw
// output is validated against (generateText + Output.object) before the
// service cross-validates it and shapes the frozen BodyCompDraft above.
// ============================================================================

// Per-request / per-day caps for the vision parse (contract §2: daily soft cap 10,
// 1–3 images). Shared by the service and the route so they cannot drift.
export const BODY_COMP_PHOTO_PARSE_DAILY_SOFT_CAP = 10;
export const BODY_COMP_PHOTO_PARSE_MAX_IMAGES = 3;

// Robustness clamps at the model-output boundary (same rationale as the nutrition
// parse schemas): a single hallucinated field must be corrected, not fail the whole
// parse, and a glitchy confidence must never read as HIGH confidence.
const toFiniteNumber = (v: unknown): number => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};
// 0..1, clamped (per-metric and overall confidence).
const parseConfidence = z.preprocess(
  (v) => Math.min(1, Math.max(0, toFiniteNumber(v))),
  z.number().min(0).max(1)
);
// Any finite number; non-finite coerces to 0 and the service drops non-positive values.
const parseValue = z.preprocess(toFiniteNumber, z.number());

export const bodyCompParsedMetricSchema = z.object({
  value: parseValue.describe('The printed value, already in canonical units (kg / percent-number / kcal / level)'),
  confidence: parseConfidence.describe('0..1 confidence that this value was READ correctly from the image'),
});
export type BodyCompParsedMetric = z.infer<typeof bodyCompParsedMetricSchema>;

const parsedMetricOrNull = bodyCompParsedMetricSchema.nullable();

export const bodyCompParsedSegmentSchema = z.object({
  leanKg: parseValue.describe('Segment lean mass in kg'),
  pctOfIdeal: parseValue.nullable().describe('Printed % of ideal/standard for the segment; null if absent'),
});

/**
 * Raw vision-model output for one InBody printout / InBody app screenshot / DEXA
 * summary. `leanBodyMassKg` is extracted for server-side cross-checks ONLY — the
 * frozen BodyCompDraft.metrics deliberately has no lean field (the CRUD layer
 * derives lean mass on commit).
 */
export const bodyCompParseResultSchema = z.object({
  measuredAt: z
    .string()
    .nullable()
    .describe('Test date/time printed on the sheet as ISO 8601; null when no date is visible'),
  metrics: z.object({
    weightKg: parsedMetricOrNull,
    bodyFatPct: parsedMetricOrNull,
    fatMassKg: parsedMetricOrNull,
    skeletalMuscleMassKg: parsedMetricOrNull,
    leanBodyMassKg: parsedMetricOrNull.describe(
      'Lean Body Mass / Fat-Free Mass — used server-side for cross-checks only'
    ),
    bodyWaterKg: parsedMetricOrNull,
    boneMassKg: parsedMetricOrNull,
    visceralFatLevel: parsedMetricOrNull,
    bmrKcal: parsedMetricOrNull,
  }),
  segmental: z
    .object({
      trunk: bodyCompParsedSegmentSchema.nullable(),
      leftArm: bodyCompParsedSegmentSchema.nullable(),
      rightArm: bodyCompParsedSegmentSchema.nullable(),
      leftLeg: bodyCompParsedSegmentSchema.nullable(),
      rightLeg: bodyCompParsedSegmentSchema.nullable(),
    })
    .nullable()
    .describe('Per-segment lean analysis when printed; null when the sheet has none'),
  overallConfidence: parseConfidence.describe('Confidence in the extraction as a whole'),
  warnings: z.array(z.string()).describe('Anything the user should double-check; empty when clean'),
});
export type BodyCompParseResult = z.infer<typeof bodyCompParseResultSchema>;
