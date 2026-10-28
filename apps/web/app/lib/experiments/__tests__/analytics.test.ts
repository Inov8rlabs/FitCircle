/** Experiment user properties → Amplitude Identify (payloads, key selection, failure safety, service wiring). */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FakeSupabase } from '../../../../__tests__/helpers/fake-supabase';
import {
  AMPLITUDE_IDENTIFY_URL,
  AMPLITUDE_PROJECT_KEYS,
  amplitudeServerKey,
  buildIdentifyBody,
  sendIdentify,
} from '../../analytics/amplitude-server';
import { amplitudeReadout, assignmentIdentify, exposureIdentify } from '../analytics';

const USER = '11111111-1111-4111-8111-111111111111';

describe('payload builders', () => {
  it('enrolled (bucket) → exp_<key> = arm key + readable name', () => {
    expect(assignmentIdentify(USER, 'onboarding_v2', { key: 'variantA', name: 'Tour + hard paywall' }, 'bucket')).toEqual({
      user_id: USER,
      user_properties: { $set: { exp_onboarding_v2: 'variantA', exp_onboarding_v2_name: 'Tour + hard paywall' } },
    });
  });

  it('override → same property plus exp_<key>_override: true', () => {
    expect(assignmentIdentify(USER, 'onboarding_v2', { key: 'control', name: 'Current onboarding' }, 'override')).toEqual({
      user_id: USER,
      user_properties: { $set: { exp_onboarding_v2: 'control', exp_onboarding_v2_name: 'Current onboarding', exp_onboarding_v2_override: true } },
    });
  });

  it.each(['fallback', 'winner', 'layer', 'layer_conflict'] as const)('%s → nothing is set', (reason) => {
    expect(assignmentIdentify(USER, 'onboarding_v2', { key: 'control', name: 'C' }, reason)).toBeNull();
  });

  it('exposure → $setOnce exp_<key>_exposed_at', () => {
    expect(exposureIdentify(USER, 'onboarding_v2', new Date('2026-11-10T12:00:00Z'))).toEqual({
      user_id: USER,
      user_properties: { $setOnce: { exp_onboarding_v2_exposed_at: '2026-11-10T12:00:00.000Z' } },
    });
  });

  it('form body = api_key + identification JSON array', () => {
    const body = buildIdentifyBody('k', [exposureIdentify(USER, 'x', new Date(0))]);
    expect(body.get('api_key')).toBe('k');
    expect(JSON.parse(body.get('identification')!)).toEqual([{ user_id: USER, user_properties: { $setOnce: { exp_x_exposed_at: '1970-01-01T00:00:00.000Z' } } }]);
  });

  it('results readout block', () => {
    const r = amplitudeReadout('onboarding_v2', true);
    expect(r).toMatchObject({ project: { id: 746168 }, userProperty: 'exp_onboarding_v2', overrideProperty: 'exp_onboarding_v2_override' });
    expect(r.events).toEqual(['Experiment Exposed', 'Onboarding Completed', 'Purchase Completed']);
    expect(r.chartDefinition.groupBy).toEqual([{ type: 'user', property: 'exp_onboarding_v2' }]);
    expect(amplitudeReadout('x', false).project.id).toBe(875589);
  });
});

describe('AMPLITUDE_SERVER_API_KEY', () => {
  it('unset / off → disabled; auto → project by deployment; explicit → as-is', () => {
    expect(amplitudeServerKey({} as any)).toBeNull();
    expect(amplitudeServerKey({ AMPLITUDE_SERVER_API_KEY: 'off' } as any)).toBeNull();
    expect(amplitudeServerKey({ AMPLITUDE_SERVER_API_KEY: 'auto', VERCEL_ENV: 'production' } as any)).toBe(AMPLITUDE_PROJECT_KEYS.production);
    expect(amplitudeServerKey({ AMPLITUDE_SERVER_API_KEY: 'auto', VERCEL_ENV: 'preview' } as any)).toBe(AMPLITUDE_PROJECT_KEYS.dev);
    expect(amplitudeServerKey({ AMPLITUDE_SERVER_API_KEY: ' abc ' } as any)).toBe('abc');
  });
});

describe('sendIdentify', () => {
  const id = [exposureIdentify(USER, 'x', new Date(0))];

  it('no key → no request', async () => {
    const fetchImpl = vi.fn();
    expect(await sendIdentify(id, { env: {} as any, fetchImpl: fetchImpl as any })).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('posts form-encoded to the Identify API', async () => {
    const fetchImpl = vi.fn(async () => new Response('success', { status: 200 }));
    expect(await sendIdentify(id, { env: { AMPLITUDE_SERVER_API_KEY: 'k' } as any, fetchImpl: fetchImpl as any })).toBe(true);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(AMPLITUDE_IDENTIFY_URL);
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/x-www-form-urlencoded');
    expect(new URLSearchParams(String(init.body)).get('api_key')).toBe('k');
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('HTTP errors, network errors and timeouts resolve false — never throw', async () => {
    const env = { AMPLITUDE_SERVER_API_KEY: 'k' } as any;
    expect(await sendIdentify(id, { env, fetchImpl: (async () => new Response('bad', { status: 400 })) as any })).toBe(false);
    expect(await sendIdentify(id, { env, fetchImpl: (async () => { throw new Error('ECONNRESET'); }) as any })).toBe(false);
    const hang = ((_u: string, init: RequestInit) =>
      new Promise((_r, reject) => init.signal!.addEventListener('abort', () => reject(new DOMException('timeout', 'TimeoutError'))))) as any;
    expect(await sendIdentify(id, { env, fetchImpl: hang, timeoutMs: 20 })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Service wiring: which assignments / exposures identify.
// ---------------------------------------------------------------------------
const identified: any[] = [];
vi.mock('@/lib/analytics/amplitude-server', async (orig) => ({
  ...(await orig<any>()),
  identifyInBackground: (ids: any[]) => identified.push(...ids),
}));
vi.mock('@/lib/supabase-admin', () => ({ createAdminSupabase: vi.fn() }));

describe('ExperimentService → identify', async () => {
  const { createAdminSupabase } = await import('@/lib/supabase-admin');
  const { ExperimentService } = await import('../service');
  const NOW = new Date('2026-11-10T12:00:00Z');
  let db: FakeSupabase;
  const profile = { id: USER, created_at: NOW.toISOString(), onboarding_completed: false };
  const info = { platform: 'ios' as const, appVersion: '1.2.0', ipCountry: null };

  beforeEach(() => {
    identified.length = 0;
    db = new FakeSupabase({
      experiments: {
        uniqueKey: ['key'],
        rows: [
          {
            key: 'onboarding_v2',
            name: 'Onboarding v2',
            status: 'running',
            salt: 's',
            arms: [
              { key: 'control', name: 'Current onboarding', weight: 0, payload: { flow: 'v1' } },
              { key: 'variantA', name: 'Tour + hard paywall', weight: 100, payload: { flow: 'v2', paywall: 'hard' } },
            ],
            traffic_pct: 100,
            audience: { platforms: ['ios'] },
            fallback_arm: 'control',
          },
        ],
      },
      experiment_assignments: { uniqueKey: ['experiment_key', 'user_id'] },
      experiment_overrides: { uniqueKey: ['experiment_key', 'user_id'] },
      complimentary_grants: {},
    });
    vi.mocked(createAdminSupabase).mockReturnValue(db as any);
  });
  afterEach(() => vi.clearAllMocks());

  it('enrolled → exp_onboarding_v2 = variantA (+ name); exposure → exposed_at once', async () => {
    await ExperimentService.assign(profile, ['onboarding_v2'], info, NOW);
    expect(identified).toEqual([{ user_id: USER, user_properties: { $set: { exp_onboarding_v2: 'variantA', exp_onboarding_v2_name: 'Tour + hard paywall' } } }]);
    identified.length = 0;
    await ExperimentService.recordExposure(USER, 'onboarding_v2', 'variantA', 'v2_welcome', NOW);
    await ExperimentService.recordExposure(USER, 'onboarding_v2', 'variantA', 'v2_welcome', NOW);
    expect(identified).toEqual([{ user_id: USER, user_properties: { $setOnce: { exp_onboarding_v2_exposed_at: NOW.toISOString() } } }]);
  });

  it('fallback (ineligible / paused) → nothing', async () => {
    await ExperimentService.assign(profile, ['onboarding_v2'], { ...info, platform: 'android' }, NOW);
    db.getRows('experiments')[0].status = 'paused';
    await ExperimentService.assign(profile, ['onboarding_v2'], info, NOW);
    expect(identified).toEqual([]);
  });

  it('override → property + _override flag', async () => {
    db.seed('experiment_overrides', [{ experiment_key: 'onboarding_v2', user_id: USER, arm: 'control' }]);
    await ExperimentService.assign(profile, ['onboarding_v2'], info, NOW);
    expect(identified[0].user_properties.$set).toEqual({ exp_onboarding_v2: 'control', exp_onboarding_v2_name: 'Current onboarding', exp_onboarding_v2_override: true });
  });
});
