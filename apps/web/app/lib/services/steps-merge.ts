/**
 * Daily-tracking step conflict resolution (manual entry vs platform auto-sync).
 *
 * Rules:
 *  1. A step count the user TYPED (or deliberately overrode) beats auto-sync.
 *  2. Auto-sync only replaces an earlier auto-sync when it is newer
 *     (steps_synced_at).
 *  3. A typed count over an auto-synced one is stored as a manual override.
 *
 * What counts as "typed": steps_source = 'manual' AND a non-null step count AND
 * no steps_synced_at. Two kinds of row look manual but are not:
 *  - Rows created by a weight / mood / energy / notes check-in with no steps.
 *    The column DEFAULT stamps steps_source = 'manual' on them with steps NULL.
 *    Treating those as a manual entry blocked every later Health Connect /
 *    HealthKit sync of that day (prod, 2026-11: 13 Android days blocked vs 11
 *    synced; the onboarding weight backfill creates exactly such rows).
 *  - Platform syncs sent with is_override=true ("Sync last 7 days"), which an
 *    older version of this rule relabelled 'manual' and then froze forever,
 *    often at 0 because the source app had not written into Health Connect
 *    yet. They still carry steps_synced_at, which a typed entry never has.
 */

export type StepsSource = 'manual' | 'healthkit' | 'google_fit';

export interface ExistingStepsRow {
  steps: number | null;
  steps_source: string | null;
  is_override: boolean | null;
  steps_synced_at: string | null;
}

export interface IncomingSteps {
  steps?: number;
  steps_source?: StepsSource;
  steps_synced_at?: string;
  is_override?: boolean;
}

export interface ResolvedSteps {
  steps: number | undefined | null;
  steps_source: string;
  steps_synced_at: string | undefined | null;
  is_override: boolean;
  /** Why the incoming value was kept/dropped (for logs). */
  reason:
    | 'insert'
    | 'kept_manual_override'
    | 'kept_manual_entry'
    | 'kept_newer_sync'
    | 'applied_sync'
    | 'manual_over_sync'
    | 'applied';
}

export function isPlatformSource(source: string | null | undefined): boolean {
  return source === 'healthkit' || source === 'google_fit';
}

/** True only for a step count the user actually typed (see file header). */
export function isTypedManualSteps(row: ExistingStepsRow): boolean {
  return (
    row.steps_source === 'manual' &&
    row.steps !== null &&
    row.steps !== undefined &&
    !row.steps_synced_at
  );
}

export function resolveStepsMerge(
  existing: ExistingStepsRow | null,
  incoming: IncomingSteps
): ResolvedSteps {
  const base: ResolvedSteps = {
    steps: incoming.steps,
    steps_source: incoming.steps_source || 'manual',
    steps_synced_at: incoming.steps_synced_at,
    is_override: incoming.is_override !== undefined ? incoming.is_override : false,
    reason: existing ? 'applied' : 'insert',
  };
  if (!existing || incoming.steps === undefined) return base;

  const incomingAuto = isPlatformSource(incoming.steps_source);
  const existingTyped = isTypedManualSteps(existing);
  const keepExisting = (reason: ResolvedSteps['reason']): ResolvedSteps => ({
    steps: existing.steps,
    steps_source: existing.steps_source || 'manual',
    steps_synced_at: existing.steps_synced_at,
    is_override: existing.is_override === true,
    reason,
  });

  // 1a. A typed override always wins over auto-sync.
  if (incomingAuto && existingTyped && existing.is_override === true) {
    return keepExisting('kept_manual_override');
  }
  // 1b. A typed entry wins over auto-sync unless the sync explicitly overrides it.
  if (incomingAuto && existingTyped && !incoming.is_override) {
    return keepExisting('kept_manual_entry');
  }
  // 2. Auto-sync over an earlier auto-sync: only when newer.
  if (incomingAuto && existing.steps_synced_at && incoming.steps_synced_at) {
    const existingAt = new Date(existing.steps_synced_at).getTime();
    const incomingAt = new Date(incoming.steps_synced_at).getTime();
    if (incomingAt <= existingAt) return keepExisting('kept_newer_sync');
    return { ...base, reason: 'applied_sync' };
  }
  // 3. Typed steps over a platform-synced count: an explicit override.
  if (!incomingAuto && existing.steps !== null && (isPlatformSource(existing.steps_source) || existing.steps_synced_at)) {
    return {
      steps: incoming.steps,
      steps_source: 'manual',
      steps_synced_at: undefined,
      is_override: true,
      reason: 'manual_over_sync',
    };
  }
  return base;
}
