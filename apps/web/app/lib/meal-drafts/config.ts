/**
 * Draft meals (docs/ENGAGEMENT_115_SPEC.md §14.6) — switches and the reader filter.
 *
 * MEAL_DRAFTS_ENABLED (default OFF): set to `true` only AFTER migration 139 is applied. While
 * it is off, nothing reads or writes `entry_status` / `meal_analysis_results` (old schema safe).
 * Once drafts exist, never switch it back off: every aggregate relies on `confirmedOnly` to
 * hide drafts. To stop creating new drafts use MEAL_DRAFT_PROMOTION_ENABLED=false instead.
 *
 * Old clients (≤ 1.1.4) never see drafts: only requests declaring X-Client-Features:
 * meal_drafts get them in lists / by id (`includeDraftsFor`).
 */
import { hasClientFeature } from '../integrity/contract';

export const MEAL_DRAFTS_FEATURE = 'meal_drafts';
export const ENTRY_STATUS_CONFIRMED = 'confirmed';
export const ENTRY_STATUS_DRAFT = 'draft';

/** An unsaved AI result becomes a draft this long after it was ready. */
export const DRAFT_PROMOTION_AFTER_MS = 30 * 60_000;
/** Drafts (and unresolved analysis rows) older than this are deleted by the cleanup. */
export const DRAFT_MAX_AGE_MS = 14 * 86_400_000;
/** Pending analyses older than this are never promoted (cron outage backlog) → expired. */
export const PENDING_MAX_AGE_MS = 24 * 3_600_000;
/** A newer analysis by the same user within this window supersedes an older pending one (re-scan / Fix). */
export const SUPERSEDE_WINDOW_MS = 15 * 60_000;

const on = (v: string | undefined) => ['1', 'true', 'on', 'yes'].includes((v ?? '').trim().toLowerCase());
const notOff = (v: string | undefined) => !['0', 'false', 'off', 'no'].includes((v ?? '').trim().toLowerCase());

export function mealDraftsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return on(env.MEAL_DRAFTS_ENABLED);
}

/** Creating NEW drafts (the 30-min promotion). Default on whenever drafts are enabled. */
export function mealDraftPromotionEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return mealDraftsEnabled(env) && notOff(env.MEAL_DRAFT_PROMOTION_ENABLED);
}

type Filterable = { eq(column: string, value: unknown): unknown };

/**
 * Restrict a food_log_entries query to confirmed entries (drafts never count). A no-op while
 * MEAL_DRAFTS_ENABLED is off (the column may not exist yet). Use on EVERY aggregate / side-effect
 * reader of food_log_entries.
 */
export function confirmedOnly<Q>(query: Q): Q {
  // Unconstrained generic on purpose: PostgREST builder types are too deep to check against an interface.
  return mealDraftsEnabled() ? ((query as unknown as Filterable).eq('entry_status', ENTRY_STATUS_CONFIRMED) as Q) : query;
}

/** Whether this request may see the caller's own drafts (1.1.5+ client, drafts on). */
export function includeDraftsFor(request: { headers: { get(name: string): string | null } } | null | undefined): boolean {
  if (!request || !mealDraftsEnabled()) return false;
  return hasClientFeature(request.headers.get('x-client-features'), MEAL_DRAFTS_FEATURE);
}

/** True for a stored row that is a draft (false for rows read before migration 139). */
export function isDraftEntry(row: { entry_status?: unknown } | null | undefined): boolean {
  return !!row && row.entry_status === ENTRY_STATUS_DRAFT;
}
