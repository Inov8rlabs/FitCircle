
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

// ---------------------------------------------------------------- 1.1.5 per-meal circle lists
// docs/ENGAGEMENT_115_SPEC.md §4. `share_circle_ids` (migration 138) is the explicit per-meal
// list from the meal-logged success sheet; NULL = the legacy rule (every circle where the
// owner's tier is 'full'), so every shipped client and old row behaves exactly as before.

/** A valid explicit list, or null (legacy rule). */
export function explicitShareList(entry: { share_circle_ids?: unknown } | null | undefined): string[] | null {
  const v = entry?.share_circle_ids;
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : null;
}

/**
 * Is a SHARED entry visible in this circle? An explicit per-meal list beats the tier row
 * (turning a circle off for one meal must not hide older photos there); else tier 'full'.
 * The caller still checks that the entry is shared at all (isEntryPrivate) and membership.
 */
export function mealVisibleInCircle(entry: { share_circle_ids?: unknown }, circleId: string, ownerTier: string | null | undefined): boolean {
  const list = explicitShareList(entry);
  if (list) return list.includes(circleId);
  return ownerTier === 'full';
}

/** `sharing_default` on GET /food-log/share-targets: the STORED key (true / false / absent). */
export function sharingDefaultState(preferences: unknown): 'on' | 'off' | 'unset' {
  const privacy = preferences && typeof preferences === 'object' ? (preferences as Record<string, unknown>).privacy : null;
  const v = privacy && typeof privacy === 'object' ? (privacy as Record<string, unknown>).share_meals_with_circles : undefined;
  return v === true ? 'on' : v === false ? 'off' : 'unset';
}

/** `preferences.privacy.meals_made_private_at` (bulk "Make all past meals private"), when set. */
export function mealsMadePrivateAt(preferences: unknown): string | null {
  const privacy = preferences && typeof preferences === 'object' ? (preferences as Record<string, unknown>).privacy : null;
  const v = privacy && typeof privacy === 'object' ? (privacy as Record<string, unknown>).meals_made_private_at : undefined;
  return typeof v === 'string' && v.length > 0 ? v : null;
}

export type ShareTargetReason =
  | 'remembered'
  | 'circle_privacy'
  | 'sharing_default_off'
  | 'made_private'
  | 'public_circle'
  | 'large_circle'
  | 'friend_circle';

export interface DefaultOnInput {
  /** meal_share_circle_prefs.share for (user, circle), if a row exists. */
  remembered: boolean | null;
  /** The explicit circle_food_privacy row's tier, if a row exists (no row = 'full'). */
  explicitTier: string | null;
  /** preferences.privacy.share_meals_with_circles STORED as false. */
  sharingDefaultOff: boolean;
  /** preferences.privacy.meals_made_private_at is set. */
  madePrivate: boolean;
  isOfficial: boolean;
  circleVisibility: string | null;
  /** Active members, the user included. */
  memberCount: number;
  /** meal_share_large_circle_threshold (20). */
  largeCircleThreshold: number;
}

/**
 * The success-sheet toggle default for one circle (§4.3, first rule that applies wins).
 * Rules 2–4 respect an explicit privacy choice: anyone who ever chose "private" starts with
 * every toggle off. A default never posts anything by itself: sharing always needs the tap.
 */
export function defaultOnFor(i: DefaultOnInput): { default_on: boolean; reason: ShareTargetReason } {
  if (i.remembered !== null) return { default_on: i.remembered, reason: 'remembered' };
  if (i.explicitTier !== null && i.explicitTier !== 'full') return { default_on: false, reason: 'circle_privacy' };
  if (i.sharingDefaultOff) return { default_on: false, reason: 'sharing_default_off' };
  if (i.madePrivate) return { default_on: false, reason: 'made_private' };
  if (i.isOfficial || i.circleVisibility === 'public') return { default_on: false, reason: 'public_circle' };
  if (i.memberCount > i.largeCircleThreshold) return { default_on: false, reason: 'large_circle' };
  return { default_on: true, reason: 'friend_circle' };
}
