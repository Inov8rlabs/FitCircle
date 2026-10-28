/**
 * Assignment rules (docs/ONBOARDING_V2_EXPERIMENT_SPEC.md §6.3). Pure.
 *
 * Order:
 *   1. override                 → override arm        (persisted, reason=override)
 *   2. existing assignment      → that arm, always    (sticky, even if weights changed)
 *   3. not eligible (audience)  → fallback_arm        (NOT persisted: may become eligible later)
 *   4. layered + outside slice  → fallback_arm        (persisted, reason=layer)
 *   5. concluded                → winner_arm          (persisted, reason=winner)
 *   6. draft / paused           → fallback_arm        (persisted, reason=fallback)
 *   7. outside traffic_pct      → fallback_arm        (persisted, reason=fallback)
 *   8. layered + already randomised into a running/paused sibling
 *                               → fallback_arm        (persisted, reason=layer_conflict)
 *   9. arm bucket               → weighted arm        (persisted, reason=bucket)
 *
 * Layers (mutual exclusion): each layer has its own salt; a user's layer
 * bucket experimentBucket(userId, layer.salt) falls in at most one of the
 * disjoint slices, so they can be randomised into at most one experiment of
 * the layer. traffic_pct applies within the slice (independent hash), so the
 * enrolled share of all eligible users is (end − start)/10 000 × traffic_pct.
 * Step 8 is the backstop for slices edited after users were enrolled.
 *
 * Persisting 4–6 keeps a user on one arm for the whole onboarding even if the
 * admin starts the experiment or raises traffic while they are mid-flow (the
 * client calls assign again on resume / reinstall). Only reason=bucket rows are
 * analysed, and only they report `enrolled: true`.
 *
 * Traffic and arm use independent hashes (`salt:traffic` vs `salt`), so raising
 * traffic_pct adds users without moving anyone between arms, and weight changes
 * only affect users who have no assignment yet.
 */
import { compareVersions, parseVersion } from '../home-feed/rules';

import { EXPERIMENT_BUCKETS, experimentBucket } from './bucket';
import type { AssignmentReason, ClientPlatform, Experiment, ExperimentArm, ExperimentAudience } from './model';

/** "New user" window for `audience.newUsersOnly`. */
export const NEW_USER_WINDOW_MS = 24 * 3_600_000;

export interface AssignmentContext {
  userId: string;
  platform: ClientPlatform | null;
  appVersion: string | null;
  country: string | null;
  profileCreatedAt: string | null;
  onboardingCompleted: boolean | null;
  /** Active complimentary Pro grant (team, friends, reviewer) — never enrolled. */
  hasComplimentaryGrant: boolean;
  now: Date;
}

export interface ExistingAssignment {
  arm: string;
  reason: AssignmentReason;
}

export interface AssignmentDecision {
  arm: string;
  payload: Record<string, unknown>;
  reason: AssignmentReason;
  /** True only for randomised (reason=bucket) users: the ones the analysis counts. */
  enrolled: boolean;
  /** Write (upsert) the assignment row. */
  persist: boolean;
  /** Why the user is not eligible (decision step 3), else null. */
  ineligible: string | null;
}

/** Why `ctx` fails the audience, or null when eligible. Unknown values never pass a gate. */
export function ineligibilityReason(audience: ExperimentAudience, ctx: AssignmentContext): string | null {
  if (audience.excludeUserIds?.some((id) => id.toLowerCase() === ctx.userId.toLowerCase())) return 'excluded_user';
  if (ctx.hasComplimentaryGrant) return 'complimentary_grant';
  if (audience.platforms && (!ctx.platform || !audience.platforms.includes(ctx.platform))) return 'platform';
  if (audience.minAppVersion || audience.maxAppVersion) {
    const v = parseVersion(ctx.appVersion);
    if (!v) return 'app_version';
    if (audience.minAppVersion && compareVersions(v, parseVersion(audience.minAppVersion)!) < 0) return 'app_version';
    if (audience.maxAppVersion && compareVersions(v, parseVersion(audience.maxAppVersion)!) > 0) return 'app_version';
  }
  if (audience.countries && (!ctx.country || !audience.countries.includes(ctx.country.toUpperCase()))) return 'country';
  if (audience.newUsersOnly) {
    if (ctx.onboardingCompleted !== false) return 'onboarding_completed';
    const created = ctx.profileCreatedAt ? Date.parse(ctx.profileCreatedAt) : NaN;
    if (Number.isNaN(created) || ctx.now.getTime() - created >= NEW_USER_WINDOW_MS) return 'not_new_user';
  }
  return null;
}

/** Weighted arm for a bucket in [0, 10 000): arms fill buckets in order. */
export function armForBucket(arms: readonly ExperimentArm[], bucket: number): ExperimentArm | null {
  let upper = 0;
  for (const arm of arms) {
    upper += arm.weight * (EXPERIMENT_BUCKETS / 100);
    if (bucket < upper) return arm;
  }
  return null;
}

export function inTraffic(experiment: Pick<Experiment, 'salt' | 'trafficPct'>, userId: string): boolean {
  return experimentBucket(userId, `${experiment.salt}:traffic`) < experiment.trafficPct * (EXPERIMENT_BUCKETS / 100);
}

export interface LayerState {
  /** The layer's salt; null when the experiment's layer row is missing (fail safe: outside). */
  salt: string | null;
  /** The user is already reason=bucket in another running/paused experiment of this layer. */
  conflict: boolean;
}

/** User's bucket within a layer, and whether it falls in the experiment's slice. */
export function inLayerSlice(experiment: Pick<Experiment, 'layer'>, layerSalt: string | null, userId: string): boolean {
  if (!experiment.layer) return true;
  if (!layerSalt) return false;
  const b = experimentBucket(userId, layerSalt);
  return b >= experiment.layer.start && b < experiment.layer.end;
}

export function decideAssignment(
  experiment: Experiment,
  ctx: AssignmentContext,
  state: { override: { arm: string } | null; existing: ExistingAssignment | null; layer?: LayerState | null }
): AssignmentDecision {
  const armByKey = (key: string | null | undefined) => experiment.arms.find((a) => a.key === key) ?? null;
  const fallback = armByKey(experiment.fallbackArm) ?? experiment.arms[0];
  const make = (arm: ExperimentArm, reason: AssignmentReason, persist: boolean, ineligible: string | null = null): AssignmentDecision => ({
    arm: arm.key,
    payload: arm.payload ?? {},
    reason,
    enrolled: reason === 'bucket',
    persist,
    ineligible,
  });

  // 1. Override (QA / reviewer). An override naming a removed arm degrades to fallback.
  if (state.override) {
    const arm = armByKey(state.override.arm) ?? fallback;
    const unchanged = state.existing?.reason === 'override' && state.existing.arm === arm.key;
    return make(arm, 'override', !unchanged);
  }

  // 2. Sticky: whatever was decided first is returned forever.
  if (state.existing) {
    const arm = armByKey(state.existing.arm);
    if (arm) return make(arm, state.existing.reason, false);
  }

  // 3. Audience.
  const why = ineligibilityReason(experiment.audience, ctx);
  if (why) return make(fallback, 'fallback', false, why);

  // 4. Layer slice (mutual exclusion). A missing layer row is never "inside".
  if (experiment.layer && !inLayerSlice(experiment, state.layer?.salt ?? null, ctx.userId)) {
    return make(fallback, 'layer', !!state.layer?.salt);
  }

  // 5–6. Lifecycle.
  if (experiment.status === 'concluded') return make(armByKey(experiment.winnerArm) ?? fallback, 'winner', true);
  if (experiment.status !== 'running') return make(fallback, 'fallback', true);

  // 7. Traffic (within the slice for layered experiments).
  if (!inTraffic(experiment, ctx.userId)) return make(fallback, 'fallback', true);

  // 8. Exclusivity backstop.
  if (experiment.layer && state.layer?.conflict) return make(fallback, 'layer_conflict', true);

  // 9. Arm.
  const arm = armForBucket(experiment.arms, experimentBucket(ctx.userId, experiment.salt));
  return arm ? make(arm, 'bucket', true) : make(fallback, 'fallback', true);
}
