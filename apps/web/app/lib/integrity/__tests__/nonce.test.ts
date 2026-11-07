import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({ rows: new Map<string, any>(), failInsert: false, failRead: false }));

vi.mock('@/lib/supabase-admin', () => ({
  createAdminSupabase: () => ({
    from: () => ({
      insert: async (row: any) => {
        if (db.failInsert) return { error: { code: '08006', message: 'down' } };
        if (db.rows.has(row.nonce)) return { error: { code: '23505', message: 'duplicate' } };
        db.rows.set(row.nonce, row);
        return { error: null };
      },
      select: () => ({
        eq: (_c: string, v: string) => ({
          maybeSingle: async () => (db.failRead ? { data: null, error: { message: 'down' } } : { data: db.rows.get(v) ?? null, error: null }),
        }),
      }),
      delete: () => ({ lt: () => ({ then: (cb: any) => cb({ error: null }) }) }),
    }),
  }),
}));

import { NONCE_TTL_MS, consumeNonce, issueNonce, nonceIssuanceConfigured, verifyNonce } from '../nonce';

const DEV = '00000000-0000-4000-8000-000000000001';
const USE = { path: '/api/mobile/auth/login', bodySha256: 'a'.repeat(64) };

beforeEach(() => {
  db.rows.clear();
  db.failInsert = false;
  db.failRead = false;
  process.env.INTEGRITY_NONCE_SECRET = 'test-secret';
});

describe('integrity nonces', () => {
  it('issues 54-char base64url nonces that verify for their device until they expire', () => {
    const now = 1_800_000_000_000;
    const { nonce, expiresAt } = issueNonce(DEV, now);
    expect(nonce).toMatch(/^[A-Za-z0-9_-]{54}$/);
    expect(Date.parse(expiresAt)).toBe(now + NONCE_TTL_MS);
    expect(verifyNonce(nonce, DEV, now + 1000)).toMatchObject({ ok: true });
    expect(verifyNonce(nonce, 'another-device', now)).toEqual({ ok: false, reason: 'bad_signature' });
    expect(verifyNonce(nonce, DEV, now + NONCE_TTL_MS + 1)).toEqual({ ok: false, reason: 'expired' });
    expect(verifyNonce('n-123-not-ours-xxxxxxxx', DEV, now)).toEqual({ ok: false, reason: 'malformed' });
  });

  it('a nonce signed with another secret is rejected', () => {
    const { nonce } = issueNonce(DEV);
    process.env.INTEGRITY_NONCE_SECRET = 'rotated';
    expect(verifyNonce(nonce, DEV)).toEqual({ ok: false, reason: 'bad_signature' });
  });

  it('single use per request: another request is a replay, a transport retry of the same request is not', async () => {
    const { nonce } = issueNonce(DEV);
    expect(await consumeNonce(nonce, DEV, USE)).toBe('ok');
    expect(await consumeNonce(nonce, DEV, USE)).toBe('ok'); // OkHttp retry: same path + body
    expect(await consumeNonce(nonce, DEV, { ...USE, bodySha256: 'b'.repeat(64) })).toBe('replayed');
    expect(await consumeNonce(nonce, DEV, { ...USE, path: '/api/mobile/auth/register' })).toBe('replayed');
  });

  it('storage failure is "error" (the caller fails open)', async () => {
    const { nonce } = issueNonce(DEV);
    db.failInsert = true;
    expect(await consumeNonce(nonce, DEV, USE)).toBe('error');
  });

  it('expired / foreign nonces never reach storage', async () => {
    const { nonce } = issueNonce(DEV, Date.now() - 10 * 60_000);
    expect(await consumeNonce(nonce, DEV, USE)).toBe('expired');
    expect(db.rows.size).toBe(0);
  });

  it('issuance needs a secret (INTEGRITY_NONCE_SECRET or JWT_SECRET)', () => {
    expect(nonceIssuanceConfigured({ JWT_SECRET: 'x' } as any)).toBe(true);
    expect(nonceIssuanceConfigured({} as any)).toBe(false);
  });
});
