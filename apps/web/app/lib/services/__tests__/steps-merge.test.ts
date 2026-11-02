import { describe, it, expect } from 'vitest';
import { resolveStepsMerge, isTypedManualSteps, type ExistingStepsRow } from '../steps-merge';

const SYNC_T1 = '2026-10-30T10:00:00.000Z';
const SYNC_T2 = '2026-10-30T18:00:00.000Z';

const row = (o: Partial<ExistingStepsRow>): ExistingStepsRow => ({
  steps: null,
  steps_source: 'manual',
  is_override: false,
  steps_synced_at: null,
  ...o,
});

const hcSync = (steps: number, at = SYNC_T2, is_override = false) => ({
  steps,
  steps_source: 'google_fit' as const,
  steps_synced_at: at,
  is_override,
});

describe('resolveStepsMerge', () => {
  it('inserts when there is no row', () => {
    const r = resolveStepsMerge(null, hcSync(5000));
    expect(r).toMatchObject({ steps: 5000, steps_source: 'google_fit', reason: 'insert' });
  });

  // Prod bug 2026-11: a weight-only check-in (or the Health Connect weight
  // backfill) creates a row with steps NULL and steps_source defaulted to
  // 'manual'; that row used to block every later steps sync for the day.
  it('a weight-only row (steps NULL, source defaulted to manual) does not block auto-sync', () => {
    const r = resolveStepsMerge(row({ steps: null, steps_source: 'manual' }), hcSync(8123));
    expect(r).toMatchObject({ steps: 8123, steps_source: 'google_fit', is_override: false });
  });

  it('a typed manual entry still wins over auto-sync', () => {
    const r = resolveStepsMerge(row({ steps: 4000 }), hcSync(9000));
    expect(r).toMatchObject({ steps: 4000, steps_source: 'manual', reason: 'kept_manual_entry' });
  });

  it('a typed manual override still wins over auto-sync, even with is_override', () => {
    const r = resolveStepsMerge(row({ steps: 4000, is_override: true }), hcSync(9000, SYNC_T2, true));
    expect(r).toMatchObject({ steps: 4000, is_override: true, reason: 'kept_manual_override' });
  });

  // Prod: "Sync last 7 days" sends is_override=true; the old rule relabelled the
  // row 'manual' and froze it (often at 0, before Samsung Health had written).
  it('a platform sync previously frozen as manual (has steps_synced_at) accepts a newer sync', () => {
    const frozen = row({ steps: 0, steps_source: 'manual', is_override: true, steps_synced_at: SYNC_T1 });
    expect(isTypedManualSteps(frozen)).toBe(false);
    const r = resolveStepsMerge(frozen, hcSync(7345, SYNC_T2));
    expect(r).toMatchObject({ steps: 7345, steps_source: 'google_fit', is_override: false, reason: 'applied_sync' });
  });

  it('an override-flagged platform sync does not freeze the day for later syncs', () => {
    const first = resolveStepsMerge(null, hcSync(100, SYNC_T1, true));
    expect(first).toMatchObject({ steps_source: 'google_fit', is_override: true });
    const later = resolveStepsMerge(
      row({ steps: 100, steps_source: 'google_fit', is_override: true, steps_synced_at: SYNC_T1 }),
      hcSync(6200, SYNC_T2)
    );
    expect(later).toMatchObject({ steps: 6200, reason: 'applied_sync' });
  });

  it('drops a stale auto-sync', () => {
    const r = resolveStepsMerge(
      row({ steps: 6000, steps_source: 'google_fit', steps_synced_at: SYNC_T2 }),
      hcSync(3000, SYNC_T1)
    );
    expect(r).toMatchObject({ steps: 6000, reason: 'kept_newer_sync' });
  });

  it('typed steps over synced steps become a manual override', () => {
    const r = resolveStepsMerge(
      row({ steps: 6000, steps_source: 'google_fit', steps_synced_at: SYNC_T1 }),
      { steps: 7000, steps_source: 'manual' }
    );
    expect(r).toMatchObject({ steps: 7000, steps_source: 'manual', is_override: true, steps_synced_at: undefined });
  });

  it('typed steps on a weight-only row are a plain manual entry, not an override', () => {
    const r = resolveStepsMerge(row({ steps: null }), { steps: 3000, steps_source: 'manual' });
    expect(r).toMatchObject({ steps: 3000, steps_source: 'manual', is_override: false });
  });

  it('a request without steps leaves step fields as provided (caller ignores them)', () => {
    const r = resolveStepsMerge(row({ steps: 5000, steps_source: 'google_fit', steps_synced_at: SYNC_T1 }), {});
    expect(r.steps).toBeUndefined();
  });
  // Prod 2026-11: 58 iOS days stored 0 (read access revoked / iPad on the same
  // account / writer not caught up). A lower or zero re-read must not erase a
  // day that already synced a real total.
  it('a later sync never lowers an earlier synced count', () => {
    const synced = row({ steps: 8000, steps_source: 'healthkit', steps_synced_at: SYNC_T1 });
    expect(resolveStepsMerge(synced, { ...hcSync(0), steps_source: 'healthkit' as const })).toMatchObject({
      steps: 8000,
      reason: 'kept_higher_sync',
    });
    expect(resolveStepsMerge(synced, hcSync(5000))).toMatchObject({ steps: 8000, reason: 'kept_higher_sync' });
  });

  it('a later, higher sync still replaces the earlier one', () => {
    const synced = row({ steps: 3000, steps_source: 'google_fit', steps_synced_at: SYNC_T1 });
    expect(resolveStepsMerge(synced, hcSync(9100))).toMatchObject({ steps: 9100, reason: 'applied_sync' });
  });

  it('typed steps can still lower a synced count (explicit override)', () => {
    const synced = row({ steps: 8000, steps_source: 'healthkit', steps_synced_at: SYNC_T1 });
    expect(resolveStepsMerge(synced, { steps: 2000, steps_source: 'manual' })).toMatchObject({
      steps: 2000,
      is_override: true,
      reason: 'manual_over_sync',
    });
  });
});
