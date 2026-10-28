/** Mutual-exclusion layers (ONBOARDING_V2 §6.2–§6.3): assignment rules + slice validation. Pure. */
import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { decideAssignment, inLayerSlice, type AssignmentContext, type LayerState } from '../assign';
import { experimentBucket } from '../bucket';
import { freeRanges, layerChanged, layerRefSchema, overlappingExperiments, type Experiment } from '../model';

const NOW = new Date('2026-11-10T12:00:00Z');
const LAYER_SALT = 'layer-salt-paywall';
const uuid = (i: number) => {
  const h = createHash('md5').update(`layer-user-${i}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
};

const exp = (key: string, over: Partial<Experiment> = {}): Experiment => ({
  key,
  name: key,
  description: null,
  status: 'running',
  salt: `${key}-salt`,
  arms: [
    { key: 'control', name: 'Control', weight: 50, payload: {} },
    { key: 'variantA', name: 'Variant A', weight: 50, payload: { copy: 'new' } },
  ],
  trafficPct: 100,
  audience: {},
  fallbackArm: 'control',
  winnerArm: null,
  layer: null,
  startedAt: null,
  endedAt: null,
  createdBy: null,
  createdAt: null,
  updatedAt: null,
  ...over,
});
const ctx = (userId: string): AssignmentContext => ({
  userId,
  platform: 'ios',
  appVersion: '1.2.0',
  appBuild: null,
  country: 'US',
  profileCreatedAt: NOW.toISOString(),
  onboardingCompleted: false,
  hasComplimentaryGrant: false,
  now: NOW,
});
const layerState = (conflict = false): LayerState => ({ salt: LAYER_SALT, conflict });
const none = { override: null, existing: null };

describe('assignment within a layer', () => {
  const left = exp('paywall_copy', { layer: { key: 'paywall', start: 0, end: 5000 } });
  const right = exp('paywall_price', { layer: { key: 'paywall', start: 5000, end: 10000 } });

  it('disjoint slices: 10 000 users, nobody randomised into both, everybody into exactly one', () => {
    let both = 0;
    let neither = 0;
    for (let i = 0; i < 10_000; i++) {
      const c = ctx(uuid(i));
      const a = decideAssignment(left, c, { ...none, layer: layerState(false) });
      // The service passes conflict=true to the sibling once the user is enrolled in `left`.
      const b = decideAssignment(right, c, { ...none, layer: layerState(a.reason === 'bucket') });
      if (a.enrolled && b.enrolled) both++;
      if (!a.enrolled && !b.enrolled) neither++;
      // Outside its slice → reason layer, persisted, not enrolled.
      for (const d of [a, b]) if (!d.enrolled) expect(d).toMatchObject({ reason: 'layer', arm: 'control', persist: true });
    }
    expect(both).toBe(0);
    expect(neither).toBe(0);
  });

  it('slices are honoured by the layer bucket (and only by it)', () => {
    for (let i = 0; i < 500; i++) {
      const u = uuid(i);
      const bucket = experimentBucket(u, LAYER_SALT);
      expect(inLayerSlice(left, LAYER_SALT, u)).toBe(bucket < 5000);
      expect(decideAssignment(left, ctx(u), { ...none, layer: layerState() }).enrolled).toBe(bucket < 5000);
    }
  });

  it('traffic_pct applies within the slice: enrolled share ≈ width × traffic', () => {
    const small = exp('small', { layer: { key: 'paywall', start: 1000, end: 3000 }, trafficPct: 50 });
    let enrolled = 0;
    let inSlice = 0;
    const N = 10_000;
    for (let i = 0; i < N; i++) {
      const u = uuid(i);
      const d = decideAssignment(small, ctx(u), { ...none, layer: layerState() });
      const b = experimentBucket(u, LAYER_SALT);
      if (b >= 1000 && b < 3000) {
        inSlice++;
        if (!d.enrolled) expect(d.reason).toBe('fallback'); // in slice, outside traffic
      } else expect(d.reason).toBe('layer');
      if (d.enrolled) enrolled++;
    }
    expect(inSlice / N).toBeGreaterThan(0.18);
    expect(inSlice / N).toBeLessThan(0.22);
    expect(enrolled / inSlice).toBeGreaterThan(0.45);
    expect(enrolled / inSlice).toBeLessThan(0.55);
    expect(enrolled / N).toBeGreaterThan(0.085);
    expect(enrolled / N).toBeLessThan(0.115);
  });

  it('layer_conflict: after a slice edit, a user already randomised into a sibling is not enrolled again', () => {
    const u = [...Array(200).keys()].map(uuid).find((x) => experimentBucket(x, LAYER_SALT) < 5000)!;
    const first = decideAssignment(left, ctx(u), { ...none, layer: layerState(false) });
    expect(first.reason).toBe('bucket');
    // `right` is widened to the whole layer; the user is now inside its slice too.
    const widened = exp('paywall_price', { layer: { key: 'paywall', start: 0, end: 10000 } });
    expect(decideAssignment(widened, ctx(u), { ...none, layer: layerState(true) })).toMatchObject({
      arm: 'control',
      reason: 'layer_conflict',
      enrolled: false,
      persist: true,
    });
    // Without the conflict they would have been enrolled.
    expect(decideAssignment(widened, ctx(u), { ...none, layer: layerState(false) }).reason).toBe('bucket');
  });

  it('overrides bypass the layer (outside the slice and despite a conflict)', () => {
    const outside = [...Array(200).keys()].map(uuid).find((x) => experimentBucket(x, LAYER_SALT) >= 5000)!;
    expect(decideAssignment(left, ctx(outside), { override: { arm: 'variantA' }, existing: null, layer: layerState(true) })).toMatchObject({
      arm: 'variantA',
      reason: 'override',
      persist: true,
    });
  });

  it('sticky assignments stay sticky even when the user is now outside the slice', () => {
    const outside = [...Array(200).keys()].map(uuid).find((x) => experimentBucket(x, LAYER_SALT) >= 5000)!;
    expect(decideAssignment(left, ctx(outside), { override: null, existing: { arm: 'variantA', reason: 'bucket' }, layer: layerState() })).toMatchObject({
      arm: 'variantA',
      reason: 'bucket',
      persist: false,
    });
  });

  it('a missing layer row is never "inside" and is not persisted', () => {
    expect(decideAssignment(left, ctx(uuid(1)), { ...none, layer: { salt: null, conflict: false } })).toMatchObject({ reason: 'layer', persist: false, enrolled: false });
  });

  it('layer step comes after audience and before lifecycle', () => {
    const ineligible = { ...ctx(uuid(1)), platform: null };
    const audienced = exp('x', { audience: { platforms: ['ios'] }, layer: { key: 'paywall', start: 0, end: 1 } });
    expect(decideAssignment(audienced, ineligible, { ...none, layer: layerState() })).toMatchObject({ reason: 'fallback', persist: false });
    const u = [...Array(200).keys()].map(uuid).find((x) => experimentBucket(x, LAYER_SALT) >= 5000)!;
    expect(decideAssignment(exp('d', { status: 'draft', layer: { key: 'paywall', start: 0, end: 5000 } }), ctx(u), { ...none, layer: layerState() }).reason).toBe('layer');
  });

  it('non-layered experiments ignore layer state entirely', () => {
    const plain = exp('plain');
    for (let i = 0; i < 200; i++) {
      const c = ctx(uuid(i));
      expect(decideAssignment(plain, c, { ...none, layer: layerState(true) })).toEqual(decideAssignment(plain, c, none));
    }
  });
});

describe('slice validation', () => {
  const sib = (key: string, status: Experiment['status'], start: number, end: number, layerKey = 'paywall') => ({
    key,
    status,
    layer: { key: layerKey, start, end },
  });

  it('layer ref: 0 ≤ start < end ≤ 10 000', () => {
    expect(layerRefSchema.safeParse({ key: 'paywall', start: 0, end: 10000 }).success).toBe(true);
    expect(layerRefSchema.safeParse({ key: 'paywall', start: 5000, end: 5000 }).success).toBe(false);
    expect(layerRefSchema.safeParse({ key: 'paywall', start: -1, end: 10 }).success).toBe(false);
    expect(layerRefSchema.safeParse({ key: 'paywall', start: 0, end: 10001 }).success).toBe(false);
  });

  it('overlaps with draft / running / paused siblings; concluded ones release their slice; other layers and self ignored', () => {
    const others = [
      sib('a', 'running', 0, 3000),
      sib('b', 'draft', 3000, 5000),
      sib('c', 'paused', 8000, 9000),
      sib('d', 'concluded', 5000, 8000),
      sib('e', 'running', 5000, 8000, 'other_layer'),
      sib('self', 'running', 5000, 6000),
    ];
    expect(overlappingExperiments({ key: 'self', layer: { key: 'paywall', start: 5000, end: 8000 } }, others)).toEqual([]);
    expect(overlappingExperiments({ key: 'self', layer: { key: 'paywall', start: 2999, end: 3001 } }, others).map((o) => o.key)).toEqual(['a', 'b']);
    expect(overlappingExperiments({ key: 'self', layer: { key: 'paywall', start: 8999, end: 10000 } }, others).map((o) => o.key)).toEqual(['c']);
  });

  it('free ranges', () => {
    expect(freeRanges([])).toEqual([{ start: 0, end: 10000 }]);
    expect(freeRanges([{ start: 3000, end: 5000 }, { start: 0, end: 1000 }, { start: 8000, end: 10000 }])).toEqual([
      { start: 1000, end: 3000 },
      { start: 5000, end: 8000 },
    ]);
  });

  it('layerChanged', () => {
    expect(layerChanged(null, null)).toBe(false);
    expect(layerChanged({ key: 'a', start: 0, end: 1 }, { key: 'a', start: 0, end: 1 })).toBe(false);
    expect(layerChanged({ key: 'a', start: 0, end: 1 }, { key: 'a', start: 0, end: 2 })).toBe(true);
    expect(layerChanged(null, { key: 'a', start: 0, end: 1 })).toBe(true);
  });
});
