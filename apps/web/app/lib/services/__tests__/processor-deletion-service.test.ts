import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FakeSupabase } from '../../../../__tests__/helpers/fake-supabase';
import {
  AMPLITUDE_DELETION_URL,
  ProcessorDeletionService,
  type ProcessorDeletionDeps,
  hashIdentifier,
  scrubIdentifiers,
} from '../processor-deletion-service';

/**
 * Processor deletions (F11) with every vendor mocked: fetch for Amplitude and
 * RevenueCat, injected clients for Stripe and Resend. Asserts URLs, methods and
 * auth header presence (never secret values), retries, skips and isolation,
 * then runs a whole account deletion with every vendor failing.
 */

const USER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const EMAIL = 'me@example.com';

const ENV: NodeJS.ProcessEnv = {
  NODE_ENV: 'test',
  NEXT_PUBLIC_AMPLITUDE_API_KEY: 'amp-key',
  AMPLITUDE_SECRET_KEY: 'amp-secret',
  REVENUECAT_SECRET_API_KEY: 'sk_rc',
  REVENUECAT_PROJECT_ID: 'proj123',
  STRIPE_SECRET_KEY: 'sk_live_x',
  RESEND_API_KEY: 're_x',
  RESEND_AUDIENCE_IDS: 'aud-1,aud-2',
};

type Call = { url: string; method: string; headers: Record<string, string>; body?: any };

function fetchReturning(...statuses: Array<number | Error>) {
  const calls: Call[] = [];
  let i = 0;
  const fn = vi.fn(async (url: any, init: any) => {
    calls.push({
      url: String(url),
      method: init?.method,
      headers: { ...(init?.headers ?? {}) },
      body: init?.body ? JSON.parse(init.body) : undefined,
    });
    const next = statuses[Math.min(i++, statuses.length - 1)];
    if (next instanceof Error) throw next;
    return new Response(null, { status: next });
  });
  return { fn: fn as unknown as typeof fetch, calls };
}

function stripeMock(...outcomes: Array<'ok' | { statusCode?: number; code?: string }>) {
  let i = 0;
  const del = vi.fn(async (_id: string) => {
    const next = outcomes[Math.min(i++, outcomes.length - 1)];
    if (next === 'ok') return { id: _id, deleted: true };
    throw Object.assign(new Error('stripe error'), next);
  });
  return { client: { customers: { del } }, del };
}

function resendMock(error: { statusCode?: number; name?: string } | null = null) {
  const remove = vi.fn(async (_opts: { email: string; audienceId: string }) => ({ data: error ? null : {}, error }));
  return { client: { contacts: { remove } }, remove };
}

const noSleep = vi.fn(async () => {});

function deps(over: Partial<ProcessorDeletionDeps> = {}): ProcessorDeletionDeps {
  return {
    env: ENV,
    fetch: fetchReturning(200).fn,
    stripe: () => stripeMock('ok').client,
    resend: () => resendMock().client,
    sleep: noSleep,
    ...over,
  };
}

let logs: string[];
beforeEach(() => {
  logs = [];
  noSleep.mockClear();
  vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    logs.push(args.map(String).join(' '));
  });
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe('Amplitude', () => {
  it('POSTs the user ids to the User Privacy API with basic auth', async () => {
    const f = fetchReturning(200);
    const out = await ProcessorDeletionService.deleteAmplitude({ userId: USER }, deps({ fetch: f.fn }));

    expect(out).toBe('deleted');
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0].url).toBe(AMPLITUDE_DELETION_URL);
    expect(f.calls[0].url).toBe('https://amplitude.com/api/2/deletions/users');
    expect(f.calls[0].method).toBe('POST');
    expect(f.calls[0].headers.Authorization).toMatch(/^Basic /);
    expect(f.calls[0].body).toEqual({
      user_ids: [USER, USER.toUpperCase()],
      requester: 'privacy@fitcircle.ai',
      ignore_invalid_id: true,
    });
  });

  it('skips when the secret key is missing', async () => {
    const f = fetchReturning(200);
    const out = await ProcessorDeletionService.deleteAmplitude(
      { userId: USER },
      deps({ fetch: f.fn, env: { ...ENV, AMPLITUDE_SECRET_KEY: '' } })
    );
    expect(out).toBe('skipped:not_configured');
    expect(f.calls).toHaveLength(0);
  });

  it('retries on 500 and then succeeds', async () => {
    const f = fetchReturning(500, 200);
    const out = await ProcessorDeletionService.deleteAmplitude({ userId: USER }, deps({ fetch: f.fn }));
    expect(out).toBe('deleted');
    expect(f.calls).toHaveLength(2);
    expect(noSleep).toHaveBeenCalledTimes(1);
  });

  it('retries on 429 and network errors, then gives up after 3 attempts', async () => {
    const f = fetchReturning(429, new TypeError('fetch failed'), 503, 200);
    const out = await ProcessorDeletionService.deleteAmplitude({ userId: USER }, deps({ fetch: f.fn }));
    expect(out).toBe('failed:http_503');
    expect(f.calls).toHaveLength(3);
  });

  it('does not retry a 400', async () => {
    const f = fetchReturning(400);
    const out = await ProcessorDeletionService.deleteAmplitude({ userId: USER }, deps({ fetch: f.fn }));
    expect(out).toBe('failed:http_400');
    expect(f.calls).toHaveLength(1);
  });
});

describe('RevenueCat', () => {
  it('DELETEs the customer in both casings with a bearer key', async () => {
    const f = fetchReturning(200, 404);
    const out = await ProcessorDeletionService.deleteRevenueCat({ userId: USER }, deps({ fetch: f.fn }));

    expect(out).toBe('deleted');
    expect(f.calls.map((c) => [c.method, c.url])).toEqual([
      ['DELETE', `https://api.revenuecat.com/v2/projects/proj123/customers/${USER}`],
      ['DELETE', `https://api.revenuecat.com/v2/projects/proj123/customers/${USER.toUpperCase()}`],
    ]);
    for (const call of f.calls) expect(call.headers.Authorization).toMatch(/^Bearer /);
  });

  it('reports a customer RevenueCat never saw as skipped', async () => {
    const out = await ProcessorDeletionService.deleteRevenueCat({ userId: USER }, deps({ fetch: fetchReturning(404).fn }));
    expect(out).toBe('skipped:not_found');
  });

  it('skips without a key', async () => {
    const f = fetchReturning(200);
    const out = await ProcessorDeletionService.deleteRevenueCat(
      { userId: USER },
      deps({ fetch: f.fn, env: { ...ENV, REVENUECAT_SECRET_API_KEY: undefined } })
    );
    expect(out).toBe('skipped:not_configured');
    expect(f.calls).toHaveLength(0);
  });

  it('retries a 502 then succeeds', async () => {
    const f = fetchReturning(502, 200, 200);
    const out = await ProcessorDeletionService.deleteRevenueCat({ userId: USER }, deps({ fetch: f.fn }));
    expect(out).toBe('deleted');
    expect(noSleep).toHaveBeenCalledTimes(1);
  });
});

describe('Stripe', () => {
  it('deletes the customer', async () => {
    const s = stripeMock('ok');
    const out = await ProcessorDeletionService.deleteStripe(
      { userId: USER, stripeCustomerId: 'cus_123' },
      deps({ stripe: () => s.client })
    );
    expect(out).toBe('deleted');
    expect(s.del).toHaveBeenCalledWith('cus_123');
  });

  it('skips a user without a customer id', async () => {
    const s = stripeMock('ok');
    const out = await ProcessorDeletionService.deleteStripe({ userId: USER }, deps({ stripe: () => s.client }));
    expect(out).toBe('skipped:no_customer');
    expect(s.del).not.toHaveBeenCalled();
  });

  it('skips when Stripe is not configured', async () => {
    const s = stripeMock('ok');
    const out = await ProcessorDeletionService.deleteStripe(
      { userId: USER, stripeCustomerId: 'cus_123' },
      deps({ stripe: () => s.client, env: { ...ENV, STRIPE_SECRET_KEY: '' } })
    );
    expect(out).toBe('skipped:not_configured');
    expect(s.del).not.toHaveBeenCalled();
  });

  it('treats an already deleted customer as done and retries a 500', async () => {
    const gone = stripeMock({ statusCode: 404, code: 'resource_missing' });
    expect(
      await ProcessorDeletionService.deleteStripe({ userId: USER, stripeCustomerId: 'cus_1' }, deps({ stripe: () => gone.client }))
    ).toBe('skipped:not_found');

    const flaky = stripeMock({ statusCode: 500 }, 'ok');
    expect(
      await ProcessorDeletionService.deleteStripe({ userId: USER, stripeCustomerId: 'cus_1' }, deps({ stripe: () => flaky.client }))
    ).toBe('deleted');
    expect(flaky.del).toHaveBeenCalledTimes(2);
  });

  it('gives up after 3 attempts', async () => {
    const down = stripeMock({ statusCode: 503 });
    const out = await ProcessorDeletionService.deleteStripe(
      { userId: USER, stripeCustomerId: 'cus_1' },
      deps({ stripe: () => down.client })
    );
    expect(out).toBe('failed:http_503');
    expect(down.del).toHaveBeenCalledTimes(3);
  });
});

describe('Resend', () => {
  it('removes the contact from every audience', async () => {
    const r = resendMock();
    const out = await ProcessorDeletionService.deleteResend({ userId: USER, email: EMAIL }, deps({ resend: () => r.client }));
    expect(out).toBe('deleted');
    expect(r.remove.mock.calls.map((c) => c[0])).toEqual([
      { email: EMAIL, audienceId: 'aud-1' },
      { email: EMAIL, audienceId: 'aud-2' },
    ]);
  });

  it('records skipped:no_audiences when no audience is configured', async () => {
    const r = resendMock();
    const out = await ProcessorDeletionService.deleteResend(
      { userId: USER, email: EMAIL },
      deps({ resend: () => r.client, env: { ...ENV, RESEND_AUDIENCE_IDS: undefined } })
    );
    expect(out).toBe('skipped:no_audiences');
    expect(r.remove).not.toHaveBeenCalled();
  });

  it('treats a contact that is not in the audience as done', async () => {
    const r = resendMock({ statusCode: 404, name: 'not_found' });
    const out = await ProcessorDeletionService.deleteResend({ userId: USER, email: EMAIL }, deps({ resend: () => r.client }));
    expect(out).toBe('deleted');
  });
});

describe('deleteFromProcessors', () => {
  it('runs every vendor and reports each outcome; Sentry is never called', async () => {
    const f = fetchReturning(200);
    const out = await ProcessorDeletionService.deleteFromProcessors(
      { userId: USER, email: EMAIL, stripeCustomerId: 'cus_1' },
      deps({ fetch: f.fn })
    );
    expect(out).toEqual({
      amplitude: 'deleted',
      revenuecat: 'deleted',
      stripe: 'deleted',
      resend: 'deleted',
      sentry: 'skipped:retention_90d',
    });
    expect(f.calls.some((c) => c.url.includes('sentry'))).toBe(false);
  });

  it('one vendor failing does not affect the others', async () => {
    const f = vi.fn(async (url: any) =>
      String(url).includes('amplitude') ? new Response(null, { status: 500 }) : new Response(null, { status: 200 })
    ) as unknown as typeof fetch;
    const out = await ProcessorDeletionService.deleteFromProcessors(
      { userId: USER, email: EMAIL, stripeCustomerId: 'cus_1' },
      deps({
        fetch: f,
        stripe: () => {
          throw new Error('cannot load');
        },
      })
    );
    expect(out.amplitude).toBe('failed:http_500');
    expect(out.revenuecat).toBe('deleted');
    expect(out.stripe).toBe('skipped:not_configured');
    expect(out.resend).toBe('deleted');
  });

  it('logs vendor, status and attempt with the user id but never the email', async () => {
    await ProcessorDeletionService.deleteFromProcessors(
      { userId: USER, email: EMAIL, stripeCustomerId: 'cus_1' },
      deps({ fetch: fetchReturning(500, 200).fn })
    );
    const lines = logs.filter((l) => l.startsWith('[processor-deletion]'));
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.some((l) => l.includes('"attempt":1'))).toBe(true);
    expect(lines.some((l) => l.includes('"vendor":"amplitude"') && l.includes('"status":"deleted"'))).toBe(true);
    expect(logs.join('\n')).not.toContain(EMAIL);
    expect(logs.join('\n')).not.toContain('amp-secret');
  });

  it('skips everything when nothing is configured', async () => {
    const out = await ProcessorDeletionService.deleteFromProcessors(
      { userId: USER, email: EMAIL, stripeCustomerId: 'cus_1' },
      { env: {} as NodeJS.ProcessEnv, fetch: fetchReturning(200).fn, sleep: noSleep }
    );
    expect(out).toEqual({
      amplitude: 'skipped:not_configured',
      revenuecat: 'skipped:not_configured',
      stripe: 'skipped:not_configured',
      resend: 'skipped:no_audiences',
      sentry: 'skipped:retention_90d',
    });
  });
});

const rcEvent = (appUserId: string) => ({
  api_version: '1.0',
  event: {
    type: 'INITIAL_PURCHASE',
    app_user_id: appUserId,
    original_app_user_id: appUserId,
    aliases: [appUserId, '$RCAnonymousID:abc'],
    subscriber_attributes: { $email: { value: EMAIL, updated_at_ms: 1 } },
    product_id: 'fitcircle_pro_monthly',
    price: 9.99,
    transaction_id: 'tx-1',
    note: `user ${appUserId}`,
  },
});

describe('subscription_events.raw scrubbing', () => {
  it('hashes identifiers and keeps the financial fields', () => {
    const out = scrubIdentifiers(rcEvent(USER.toUpperCase()), USER, EMAIL) as any;
    const text = JSON.stringify(out);
    expect(text.toLowerCase()).not.toContain(USER);
    expect(text).not.toContain(EMAIL);
    expect(out.event.app_user_id).toBe(hashIdentifier(USER.toUpperCase()));
    expect(out.event.subscriber_attributes).toBe('[redacted]');
    expect(out.event).toMatchObject({ type: 'INITIAL_PURCHASE', product_id: 'fitcircle_pro_monthly', price: 9.99, transaction_id: 'tx-1' });
  });

  it('scrubs only the user\'s rows', async () => {
    const fake = new FakeSupabase({});
    fake.seed('subscription_events', [
      { id: 'e1', user_id: USER, raw: rcEvent(USER) },
      { id: 'e2', user_id: OTHER, raw: rcEvent(OTHER) },
    ]);
    const n = await ProcessorDeletionService.scrubSubscriptionEvents(USER, EMAIL, fake as any);
    expect(n).toBe(1);
    const [mine, theirs] = fake.getRows('subscription_events');
    expect(JSON.stringify(mine.raw)).not.toContain(USER);
    expect(theirs.raw.event.app_user_id).toBe(OTHER);
  });

  it('never throws', async () => {
    const broken = { from: () => { throw new Error('down'); } };
    await expect(ProcessorDeletionService.scrubSubscriptionEvents(USER, EMAIL, broken as any)).resolves.toBe(0);
  });
});

// ----------------------------------------------------------------------------
// Whole account deletion with every vendor failing
// ----------------------------------------------------------------------------

const holder = vi.hoisted(() => ({ db: null as any }));
vi.mock('../../supabase-admin', () => ({ createAdminSupabase: () => holder.db }));
vi.mock('../leaderboard-service-v2', () => ({ recalculateLeaderboard: vi.fn(async () => ({ entries: [], error: null })) }));

function deletionDb() {
  const fake = new FakeSupabase({ profiles: { uniqueKey: ['id'] } });
  const authUsers = new Set([USER]);
  return {
    fake,
    authUsers,
    from: (table: string) => fake.from(table),
    storage: {
      from: () => ({
        list: async () => ({ data: [], error: null }),
        remove: async (paths: string[]) => ({ data: paths, error: null }),
      }),
    },
    auth: {
      admin: {
        deleteUser: async (id: string) => {
          authUsers.delete(id);
          return { data: {}, error: null };
        },
      },
    },
  };
}

describe('AccountDeletionService with processors', () => {
  it('deletes the account when every vendor fails, keeps the suppression row and scrubs raw', async () => {
    const { AccountDeletionService } = await import('../account-deletion-service');
    const target = deletionDb();
    holder.db = target;
    target.fake.seed('profiles', [{ id: USER, email: EMAIL, stripe_customer_id: 'cus_1' }]);
    target.fake.seed('subscription_events', [{ id: 'e1', user_id: USER, raw: rcEvent(USER) }]);
    target.fake.seed('email_suppressions', [{ email_hash: 'hash-of-me', reason: 'bounce' }]);

    const failingFetch = vi.fn(async () => new Response(null, { status: 503 })) as unknown as typeof fetch;
    const stripe = stripeMock({ statusCode: 500 });
    const resend = resendMock({ statusCode: 500 });

    const result = await AccountDeletionService.deleteAccount(USER, {
      userEmail: EMAIL,
      processorDeps: {
        env: ENV,
        fetch: failingFetch,
        stripe: () => stripe.client,
        resend: () => resend.client,
        sleep: noSleep,
      },
    });

    expect(result.success).toBe(true);
    expect(target.fake.getRows('profiles')).toEqual([]);
    expect(target.authUsers.has(USER)).toBe(false);
    expect(result.processors).toEqual({
      amplitude: 'failed:http_503',
      revenuecat: 'failed:http_503',
      stripe: 'failed:http_500',
      resend: 'failed:http_500',
      sentry: 'skipped:retention_90d',
    });
    expect(stripe.del).toHaveBeenCalledWith('cus_1');
    // Legitimate suppression record survives.
    expect(target.fake.getRows('email_suppressions')).toEqual([{ email_hash: 'hash-of-me', reason: 'bounce' }]);
    // raw no longer identifies the user.
    const raw = JSON.stringify(target.fake.getRows('subscription_events')[0].raw);
    expect(raw).not.toContain(USER);
    expect(raw).not.toContain(EMAIL);
  });

  it('deletes the account even when the processor service itself throws', async () => {
    const { AccountDeletionService } = await import('../account-deletion-service');
    const target = deletionDb();
    holder.db = target;
    target.fake.seed('profiles', [{ id: USER, email: EMAIL }]);
    const spy = vi.spyOn(ProcessorDeletionService, 'deleteFromProcessors').mockRejectedValue(new Error('bug'));

    const result = await AccountDeletionService.deleteAccount(USER, { userEmail: EMAIL });
    expect(result.success).toBe(true);
    expect(result.processors).toBeUndefined();
    expect(target.authUsers.has(USER)).toBe(false);
    spy.mockRestore();
  });
});
