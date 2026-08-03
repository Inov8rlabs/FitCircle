import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

import { FakeDb, setDb } from '@/lib/services/__tests__/fake-supabase-admin';

vi.mock('@/lib/supabase-admin', async () => {
  const { getDb } = await import('@/lib/services/__tests__/fake-supabase-admin');
  return { createAdminSupabase: () => getDb().client() };
});

import { POST } from '../route';

const SECRET = 'test-webhook-secret';
const USER = '11111111-2222-3333-4444-555555555555';

function makeRequest(body: unknown, auth?: string): NextRequest {
  return new NextRequest('https://fitcircle.test/api/webhooks/revenuecat', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(auth !== undefined ? { authorization: auth } : {}),
    },
    body: JSON.stringify(body),
  });
}

function rcBody(overrides: Record<string, unknown> = {}) {
  return {
    api_version: '1.0',
    event: {
      id: 'evt_route_1',
      type: 'INITIAL_PURCHASE',
      app_user_id: USER,
      event_timestamp_ms: Date.now(),
      expiration_at_ms: Date.now() + 1000000,
      store: 'APP_STORE',
      environment: 'PRODUCTION',
      period_type: 'NORMAL',
      price: 59.99,
      ...overrides,
    },
  };
}

beforeEach(() => {
  const db = new FakeDb();
  db.profiles.set(USER, {
    id: USER,
    subscription_tier: 'free',
    subscription_synced_at: null,
    subscription_will_renew: false,
  });
  setDb(db);
  vi.stubEnv('REVENUECAT_WEBHOOK_AUTH_TOKEN', SECRET);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('POST /api/webhooks/revenuecat — auth (fail closed)', () => {
  it('500s when no webhook secret is configured (never fail-open)', async () => {
    vi.stubEnv('REVENUECAT_WEBHOOK_AUTH_TOKEN', '');
    const res = await POST(makeRequest(rcBody(), SECRET));
    expect(res.status).toBe(500);
  });

  it('401s a missing authorization header', async () => {
    const res = await POST(makeRequest(rcBody()));
    expect(res.status).toBe(401);
  });

  it('401s a wrong token', async () => {
    const res = await POST(makeRequest(rcBody(), 'wrong-token'));
    expect(res.status).toBe(401);
  });

  it('400s a body without an event', async () => {
    const res = await POST(makeRequest({ hello: 'world' }, SECRET));
    expect(res.status).toBe(400);
  });
});

describe('POST /api/webhooks/revenuecat — processing', () => {
  it('applies a valid event and returns 200', async () => {
    const res = await POST(makeRequest(rcBody(), SECRET));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.outcome).toBe('applied');
  });

  it('returns 200 already_processed on duplicate delivery', async () => {
    await POST(makeRequest(rcBody(), SECRET));
    const res = await POST(makeRequest(rcBody(), SECRET));
    expect(res.status).toBe(200);
    expect((await res.json()).outcome).toBe('already_processed');
  });

  it('returns 200 unknown_user for a forged app_user_id (no retry storm)', async () => {
    const res = await POST(
      makeRequest(rcBody({ id: 'evt_route_2', app_user_id: 'not-a-user' }), SECRET)
    );
    expect(res.status).toBe(200);
    expect((await res.json()).outcome).toBe('unknown_user');
  });
});
