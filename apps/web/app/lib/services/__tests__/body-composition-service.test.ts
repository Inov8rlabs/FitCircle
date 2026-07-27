import { describe, expect, it } from 'vitest';

import type { BodyCompImportItem } from '../../types/body-composition';
import {
  computeDerivedFlags,
  deriveBodyCompMetrics,
  groupImportItems,
} from '../body-composition-service';

describe('deriveBodyCompMetrics', () => {
  it('derives fat mass from weight × BF% and lean mass from weight − fat', () => {
    const result = deriveBodyCompMetrics({ weightKg: 93.5, bodyFatPct: 26.6 });
    expect(result.fatMassKg).toBe(24.87); // 93.5 * 0.266 = 24.871 → round2
    expect(result.leanBodyMassKg).toBe(68.63); // 93.5 - 24.87
  });

  it('never overwrites user-provided fat or lean mass', () => {
    const result = deriveBodyCompMetrics({
      weightKg: 93.5,
      bodyFatPct: 26.6,
      fatMassKg: 25.3,
      leanBodyMassKg: 68.0,
    });
    expect(result.fatMassKg).toBe(25.3);
    expect(result.leanBodyMassKg).toBe(68.0);
  });

  it('derives lean mass from a user-provided fat mass without BF%', () => {
    const result = deriveBodyCompMetrics({ weightKg: 90, fatMassKg: 24 });
    expect(result.fatMassKg).toBe(24);
    expect(result.leanBodyMassKg).toBe(66);
  });

  it('derives nothing when inputs are insufficient', () => {
    expect(deriveBodyCompMetrics({ bodyFatPct: 26.6 })).toEqual({
      fatMassKg: null,
      leanBodyMassKg: null,
    });
    expect(deriveBodyCompMetrics({ weightKg: 90 })).toEqual({
      fatMassKg: null,
      leanBodyMassKg: null,
    });
  });
});

describe('computeDerivedFlags', () => {
  it('flags values that match the server derivation', () => {
    const { fatMassKg, leanBodyMassKg } = deriveBodyCompMetrics({ weightKg: 93.5, bodyFatPct: 26.6 });
    const flags = computeDerivedFlags({ weightKg: 93.5, bodyFatPct: 26.6, fatMassKg, leanBodyMassKg });
    expect(flags).toEqual({ fatMassKg: true, leanBodyMassKg: true });
  });

  it('does not flag user-provided values that differ from the derivation', () => {
    const flags = computeDerivedFlags({
      weightKg: 93.5,
      bodyFatPct: 26.6,
      fatMassKg: 25.3, // InBody-measured, not 24.87
      leanBodyMassKg: 68.6,
    });
    expect(flags.fatMassKg).toBeUndefined();
    expect(flags.leanBodyMassKg).toBeUndefined();
  });

  it('returns no flags when inputs are missing', () => {
    expect(computeDerivedFlags({ fatMassKg: 24.87 })).toEqual({});
    expect(computeDerivedFlags({ weightKg: 93.5, fatMassKg: 24.87 })).toEqual({});
  });
});

describe('groupImportItems', () => {
  const item = (overrides: Partial<BodyCompImportItem> & { externalId: string; measuredAt: string }) =>
    overrides as BodyCompImportItem;

  it('collapses same-instant smart-scale samples into one group', () => {
    const groups = groupImportItems([
      item({ externalId: 'w1', measuredAt: '2026-07-01T07:00:00Z', weightKg: 93.5 }),
      item({ externalId: 'bf1', measuredAt: '2026-07-01T07:00:00Z', bodyFatPct: 26.6 }),
      item({ externalId: 'bmr1', measuredAt: '2026-07-01T07:00:00Z', bmrKcal: 1810 }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({
      measuredAt: '2026-07-01T07:00:00Z',
      weightKg: 93.5,
      bodyFatPct: 26.6,
      bmrKcal: 1810,
    });
    expect(groups[0].externalIds).toEqual(['w1', 'bf1', 'bmr1']);
  });

  it('groups samples within 10 minutes and splits beyond it', () => {
    const groups = groupImportItems([
      item({ externalId: 'a', measuredAt: '2026-07-01T07:00:00Z', weightKg: 93.5 }),
      item({ externalId: 'b', measuredAt: '2026-07-01T07:10:00Z', bodyFatPct: 26.6 }), // exactly 10 min → same group
      item({ externalId: 'c', measuredAt: '2026-07-01T07:10:01Z', weightKg: 93.6 }), // >10 min from anchor → new group
    ]);
    expect(groups).toHaveLength(2);
    expect(groups[0].externalIds).toEqual(['a', 'b']);
    expect(groups[0].bodyFatPct).toBe(26.6);
    expect(groups[1].externalIds).toEqual(['c']);
  });

  it('sorts unordered input and keeps the first non-null value per metric', () => {
    const groups = groupImportItems([
      item({ externalId: 'later', measuredAt: '2026-07-01T07:05:00Z', weightKg: 94.0 }),
      item({ externalId: 'earlier', measuredAt: '2026-07-01T07:00:00Z', weightKg: 93.5 }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].measuredAt).toBe('2026-07-01T07:00:00Z');
    expect(groups[0].weightKg).toBe(93.5); // earliest sample wins
    expect(groups[0].externalIds).toEqual(['earlier', 'later']);
  });

  it('keeps distant days as separate groups', () => {
    const groups = groupImportItems([
      item({ externalId: 'd1', measuredAt: '2026-07-01T07:00:00Z', weightKg: 93.5 }),
      item({ externalId: 'd2', measuredAt: '2026-07-02T07:00:00Z', weightKg: 93.2 }),
    ]);
    expect(groups).toHaveLength(2);
  });

  it('returns no groups for empty input', () => {
    expect(groupImportItems([])).toEqual([]);
  });
});
