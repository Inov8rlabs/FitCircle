import { beforeEach, describe, expect, it, vi } from 'vitest';

const requireMobileAuth = vi.fn();
const requireFeature = vi.fn();
const isFeatureAllowed = vi.fn();
const importBatch = vi.fn();
const createLog = vi.fn();
const updateLog = vi.fn();

vi.mock('@/lib/middleware/mobile-auth', () => ({
  requireMobileAuth: (...a: unknown[]) => requireMobileAuth(...a),
}));
vi.mock('@/lib/services/entitlement-service', () => ({
  EntitlementService: {
    requireFeature: (...a: unknown[]) => requireFeature(...a),
    isFeatureAllowed: (...a: unknown[]) => isFeatureAllowed(...a),
  },
}));
vi.mock('@/lib/services/body-composition-service', () => ({
  BodyCompositionService: {
    importBatch: (...a: unknown[]) => importBatch(...a),
    createLog: (...a: unknown[]) => createLog(...a),
    updateLog: (...a: unknown[]) => updateLog(...a),
  },
  stripSegmentalData: (log: unknown) => log,
}));

import { PUT as updateRoute } from '../[id]/route';
import { POST as importRoute } from '../import/route';
import { POST as createRoute } from '../route';

const request = (path: string, body: unknown, method = 'POST') =>
  new Request(`http://localhost/api/mobile/body-comp${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as any;

/** Service stand-in: imports every item it is given unless told otherwise. */
const importsAll = () =>
  importBatch.mockImplementation(async (_userId: string, req: { items: { externalId: string }[] }) => ({
    received: req.items.length,
    imported: req.items.length,
    skipped: 0,
    outcomes: req.items.map((i) => ({ externalId: i.externalId, imported: true })),
  }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  requireMobileAuth.mockResolvedValue({ id: 'user-1' });
  requireFeature.mockResolvedValue(undefined);
  isFeatureAllowed.mockResolvedValue(true);
  importsAll();
  createLog.mockResolvedValue({ id: 'log-1', source: 'manual' });
  updateLog.mockResolvedValue({ id: 'log-1', source: 'manual' });
});

describe('POST /api/mobile/body-comp/import', () => {
  it('OLD SHAPE: a clean batch returns the same envelope and counts', async () => {
    const res = await importRoute(
      request('/import', {
        platform: 'healthkit',
        items: [
          { externalId: 'w1', measuredAt: '2026-09-01T07:00:00Z', weightKg: 93.5 },
          { externalId: 'bf1', measuredAt: '2026-09-01T07:00:00Z', bodyFatPct: 26.6 },
        ],
      })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.error).toBeNull();
    expect(body.data).toMatchObject({ received: 2, imported: 2, skipped: 0 });
    expect(typeof body.data.skipped).toBe('number');
    expect(body.data.skippedItems).toEqual([]);
    expect(body.data.droppedMetrics).toEqual([]);
  });

  it('imports the valid samples and reports the invalid ones by index', async () => {
    const res = await importRoute(
      request('/import', {
        platform: 'health_connect',
        items: [
          { externalId: 'ok-1', measuredAt: '2026-09-01T07:00:00Z', weightKg: 93.5 },
          { measuredAt: '2026-09-01T07:00:00Z', weightKg: 93.5 }, // no externalId
          { externalId: 'bad-date', measuredAt: 'yesterday', weightKg: 93.5 },
          'not an object',
          null,
          { externalId: 'ok-2', measuredAt: '2026-09-02T07:00:00Z', bodyFatPct: 22 },
        ],
      })
    );
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(importBatch.mock.calls[0][1].items.map((i: any) => i.externalId)).toEqual(['ok-1', 'ok-2']);
    expect(data).toMatchObject({ received: 6, imported: 2, skipped: 4 });
    expect(data.skippedItems).toEqual([
      { index: 1, reason: 'invalid_item' },
      { index: 2, reason: 'invalid_item' },
      { index: 3, reason: 'invalid_item' },
      { index: 4, reason: 'invalid_item' },
    ]);
  });

  it('drops an out-of-range metric but keeps the rest of the sample', async () => {
    const res = await importRoute(
      request('/import', {
        platform: 'healthkit',
        items: [{ externalId: 's1', measuredAt: '2026-09-01T07:00:00Z', weightKg: 93.5, bodyFatPct: 1.5, bmrKcal: null }],
      })
    );
    expect(res.status).toBe(200);
    expect(importBatch.mock.calls[0][1].items[0]).toEqual({
      externalId: 's1',
      measuredAt: '2026-09-01T07:00:00Z',
      weightKg: 93.5,
    });
    const { data } = await res.json();
    expect(data.droppedMetrics).toEqual([{ index: 0, externalId: 's1', fields: ['bodyFatPct'] }]);
    expect(data.skippedItems).toEqual([]);
  });

  it('maps service-level skips back to the index the client sent', async () => {
    importBatch.mockResolvedValue({
      received: 2,
      imported: 1,
      skipped: 1,
      outcomes: [
        { externalId: 'gone', imported: false, reason: 'deleted_by_user' },
        { externalId: 'w2', imported: true },
      ],
    });
    const res = await importRoute(
      request('/import', {
        platform: 'healthkit',
        items: [
          { externalId: '', measuredAt: '2026-09-01T07:00:00Z', weightKg: 93.5 }, // invalid → index 0
          { externalId: 'gone', measuredAt: '2026-09-01T07:00:00Z', weightKg: 93.5 }, // index 1
          { externalId: 'w2', measuredAt: '2026-09-08T07:00:00Z', weightKg: 93 }, // index 2
        ],
      })
    );
    const { data } = await res.json();
    expect(data).toMatchObject({ received: 3, imported: 1, skipped: 2 });
    expect(data.skippedItems).toEqual([
      { index: 0, reason: 'invalid_item' },
      { index: 1, externalId: 'gone', reason: 'deleted_by_user' },
    ]);
    expect(data.skippedItems).toHaveLength(data.skipped);
  });

  it('a batch of only bad samples is a 200 with nothing imported, not an error', async () => {
    const res = await importRoute(
      request('/import', { platform: 'healthkit', items: [{ externalId: 'x' }, { weightKg: 1 }] })
    );
    expect(res.status).toBe(200);
    expect((await res.json()).data).toMatchObject({ received: 2, imported: 0, skipped: 2 });
  });

  it('the envelope is still strict, and the error now carries a specific message', async () => {
    const res = await importRoute(request('/import', { platform: 'fitbit', items: [] }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.details).toHaveProperty('platform');
    expect(body.error.message).toContain('platform');
    expect(body.error.timestamp).toBeDefined();
  });

  it('gates and auth are unchanged', async () => {
    requireFeature.mockRejectedValueOnce(new Error('PREMIUM_REQUIRED'));
    expect((await importRoute(request('/import', { platform: 'healthkit', items: [] }))).status).toBe(403);
    requireMobileAuth.mockRejectedValueOnce(new Error('Unauthorized'));
    expect((await importRoute(request('/import', { platform: 'healthkit', items: [] }))).status).toBe(401);
  });
});

describe('POST / PUT /api/mobile/body-comp — null tolerance', () => {
  it('create: explicit nulls on optional metrics are treated as absent', async () => {
    const res = await createRoute(
      request('', {
        measuredAt: '2026-09-01T07:00:00Z',
        source: 'manual',
        weightKg: 93.5,
        bodyFatPct: null,
        fatMassKg: null,
        notes: null,
        segmental: null,
        photoUrls: null,
        sourceExternalId: null,
      })
    );
    expect(res.status).toBe(201);
    expect(createLog.mock.calls[0][1]).toEqual({
      measuredAt: '2026-09-01T07:00:00Z',
      source: 'manual',
      weightKg: 93.5,
    });
  });

  it('create: the at-least-one-metric rule still applies', async () => {
    const res = await createRoute(
      request('', { measuredAt: '2026-09-01T07:00:00Z', source: 'manual', weightKg: null, notes: 'x' })
    );
    expect(res.status).toBe(400);
    expect(createLog).not.toHaveBeenCalled();
  });

  it('update: null still means CLEAR for the nullable metrics', async () => {
    const res = await updateRoute(
      request('/x', { bodyFatPct: null, weightKg: 92, measuredAt: null }, 'PUT'),
      { params: Promise.resolve({ id: '11111111-1111-4111-8111-111111111111' }) }
    );
    expect(res.status).toBe(200);
    expect(updateLog.mock.calls[0][2]).toEqual({ bodyFatPct: null, weightKg: 92 });
  });
});
