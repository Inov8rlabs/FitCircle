
import { PRIVACY_DEFAULTS } from '../privacy/defaults';
// Food entry privacy — the pure rules (docs/FOOD_ENTRY_PRIVACY_SPEC.md).
//
// No I/O and no server-only imports: FoodLogService (which uses these) is also
// bundled into a web client component.
//
// The rules in one place:
//  - A meal is PRIVATE unless the user chose to share it. "Chose" means the
//    request carried `share_with_circles` (sent only by clients that show the
//    per-entry control), OR the user's saved default
//    `preferences.privacy.share_meals_with_circles` is on (default OFF).
//  - Shipped clients (iOS/Android <= 1.1.1, old web) always send `is_private`
//    from a hard-coded default, so their `is_private:false` / `visibility:'circle'`
//    is NOT a choice: it is ignored. Their `is_private:true` /
//    `visibility:'private'` IS honoured — asking for more privacy is always safe.
//  - Water and supplements are never shared.

export type EntryVisibility = 'private' | 'circle' | 'shared';

export interface PrivacyColumns {
  is_private: boolean;
  visibility: EntryVisibility;
}

/** The privacy fields a create / update request may carry. */
export interface PrivacyRequestFields {
  entry_type?: string | null;
  /** Explicit per-entry choice (new clients only). Wins over everything else. */
  share_with_circles?: boolean;
  /** Legacy fields: only a request for MORE privacy is honoured from these. */
  is_private?: boolean;
  visibility?: EntryVisibility;
}

/** Where the stored privacy came from (analytics / logs / meta). */
export type PrivacySource = 'explicit' | 'legacy_private' | 'default' | 'never_shared_type';

export const PRIVATE: PrivacyColumns = Object.freeze({ is_private: true, visibility: 'private' }) as PrivacyColumns;
export const SHARED: PrivacyColumns = Object.freeze({ is_private: false, visibility: 'circle' }) as PrivacyColumns;

/** Push a re-shared or back-dated meal only if it was eaten this recently. */
export const MEAL_PUSH_WINDOW_MS = 2 * 60 * 60 * 1000;

/** Entry types that can ever be shared with circles (food; legacy meal/snack). */
const SHAREABLE_TYPES = new Set(['food', 'meal', 'snack']);

export function isShareableType(entryType: string | null | undefined): boolean {
  return SHAREABLE_TYPES.has(entryType ?? '');
}

/** True when a stored row must be treated as private (either column says so, or unknown). */
export function isEntryPrivate(row: { is_private?: boolean | null; visibility?: string | null }): boolean {
  if (row.is_private !== false) return true; // null/undefined → the column default (true)
  return row.visibility !== 'circle' && row.visibility !== 'shared';
}

/**
 * `preferences.privacy.share_meals_with_circles`; unset → PRIVACY_DEFAULTS.shareMealsWithCircles
 * (false today, lib/privacy/defaults.ts). Odd shapes fail closed (private).
 */
export function shareMealsByDefault(preferences: unknown): boolean {
  if (!preferences || typeof preferences !== 'object') return PRIVACY_DEFAULTS.shareMealsWithCircles;
  const privacy = (preferences as Record<string, unknown>).privacy;
  if (privacy == null) return PRIVACY_DEFAULTS.shareMealsWithCircles;
  if (typeof privacy !== 'object') return false;
  const v = (privacy as Record<string, unknown>).share_meals_with_circles;
  if (typeof v === 'boolean') return v;
  return v == null ? PRIVACY_DEFAULTS.shareMealsWithCircles : false;
}

function legacyAsksPrivate(req: PrivacyRequestFields): boolean {
  return req.is_private === true || req.visibility === 'private';
}

function sharedColumns(req: PrivacyRequestFields): PrivacyColumns {
  // 'shared' is kept when a client explicitly asks for it (same circle reach today).
  return req.visibility === 'shared' ? { is_private: false, visibility: 'shared' } : { ...SHARED };
}

/** Privacy columns for a NEW entry. */
export function resolveCreatePrivacy(
  req: PrivacyRequestFields,
  shareByDefault: boolean
): PrivacyColumns & { source: PrivacySource } {
  if (!isShareableType(req.entry_type)) return { ...PRIVATE, source: 'never_shared_type' };
  if (typeof req.share_with_circles === 'boolean') {
    return { ...(req.share_with_circles ? sharedColumns(req) : PRIVATE), source: 'explicit' };
  }
  if (legacyAsksPrivate(req)) return { ...PRIVATE, source: 'legacy_private' };
  return { ...(shareByDefault ? SHARED : PRIVATE), source: 'default' };
}

/**
 * Privacy columns for an EDIT, or null when the request doesn't change privacy.
 * `current` is the stored row (its entry_type decides shareability).
 */
export function resolveUpdatePrivacy(
  req: PrivacyRequestFields,
  current: { entry_type: string; is_private?: boolean | null; visibility?: string | null }
): (PrivacyColumns & { source: PrivacySource }) | null {
  let next: (PrivacyColumns & { source: PrivacySource }) | null = null;
  const touchesPrivacy =
    typeof req.share_with_circles === 'boolean' || req.is_private !== undefined || req.visibility !== undefined;
  if (!isShareableType(current.entry_type)) {
    // Water / supplements are never shared: any privacy field in the request
    // resolves to private (and is a no-op when the row already is).
    if (!touchesPrivacy) return null;
    next = { ...PRIVATE, source: 'never_shared_type' };
  } else if (typeof req.share_with_circles === 'boolean') {
    next = { ...(req.share_with_circles ? sharedColumns(req) : PRIVATE), source: 'explicit' };
  } else if (legacyAsksPrivate(req)) {
    next = { ...PRIVATE, source: 'legacy_private' };
  }
  if (!next) return null;
  if (current.is_private === next.is_private && current.visibility === next.visibility) return null;
  return next;
}

/** Should a meal post fan out a push? Only for meals eaten within the window (not back-dated / old). */
export function isRecentMeal(loggedAt: string | null | undefined, now: Date = new Date()): boolean {
  const t = Date.parse(loggedAt ?? '');
  if (!Number.isFinite(t)) return false;
  return now.getTime() - t <= MEAL_PUSH_WINDOW_MS;
}

/** What a retracted (tombstoned) meal post keeps: nothing about the meal itself. */
export function scrubbedMealPayload(payload: Record<string, unknown> | null | undefined): Record<string, unknown> {
  const p = payload ?? {};
  const out: Record<string, unknown> = {};
  if ('render_hint' in p) out.render_hint = p.render_hint;
  if ('actors' in p) out.actors = p.actors;
  if ('entry_id' in p) out.entry_id = p.entry_id;
  return out;
}
