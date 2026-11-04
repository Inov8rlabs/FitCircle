/**
 * Shipped-client compat for the new 422 INVALID_EMAIL (docs/INVITE_EMAIL_VALIDATION.md).
 *
 * iOS ≤ 1.1.x and Android ≤ 1.1.x don't know INVALID_EMAIL. This replays the
 * real route's response through faithful ports of how those apps decode an
 * error, so a future change to the envelope can't silently break them:
 *
 *  iOS  FitCircle/Core/Network/APIClient+Referrals.swift sendInvites:
 *         `guard response.isSuccess else { throw MobileAPIError(statusCode:data:) }`
 *       FitCircle/Core/Network/APIClient+Safety.swift MobileAPIError.init(statusCode:data:):
 *         code = error.code (or a legacy string `error`), message = error.message ?? message,
 *         else "Something went wrong (error N)…". InviteFriendsFeature shows its own
 *         generic copy and keeps the contacts so Send can be tapped again.
 *       FitCircle/Core/Models/APIResponse.swift APIError.details: [String: APIErrorDetailValue]
 *         (string | [string] | .other — never throws on objects/arrays of objects).
 *  Android core/network/ReferralsApi.kt `suspend fun sendInvites(): ApiResponse<…>`: a non-2xx
 *         status makes Retrofit throw HttpException → ReferralRepository returns
 *         Result.failure → InviteFriendsSheet shows "Couldn't send. Try again".
 *         core/model/ApiResponse.kt ApiError(code: String, message: String,
 *         details: Map<String, JsonElement>?, timestamp: Instant?) must decode if ever read.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/middleware/mobile-auth', () => ({ requireMobileAuth: async () => ({ id: '11111111-1111-4111-8111-111111111111' }) }));
vi.mock('@/lib/middleware/rate-limit', () => ({ createRateLimiter: () => ({}), getIdentifier: () => 'u', applyRateLimit: async () => null }));
vi.mock('@/lib/supabase-admin', () => ({ createAdminSupabase: () => { throw new Error('validation must reject before any DB access'); } }));
vi.mock('@/lib/services/referral-service', async () => {
  const { ReferralInviteService } = await import('@/lib/services/referral-invite-service');
  return { ReferralService: { inviteContacts: (userId: string, input: any) => ReferralInviteService.inviteContacts(userId, input, async () => 'MAYA') } };
});

import { invalidEmailsFrom } from '@/lib/referrals/invite-form';

import { POST } from '../invites/route';

type Json = any;

/** Port of iOS MobileAPIError.init(statusCode:data:) (APIClient+Safety.swift). */
function iosMobileAPIError(statusCode: number, body: string) {
  let json: Json = null;
  try {
    json = JSON.parse(body);
  } catch {
    json = null;
  }
  const errorValue = json?.error;
  let code: string | null = typeof errorValue?.code === 'string' ? errorValue.code : null;
  if (code === null && typeof errorValue === 'string') code = errorValue;
  const raw = typeof errorValue?.message === 'string' ? errorValue.message : typeof json?.message === 'string' ? json.message : null;
  const serverMessage = raw?.trim() ?? null;
  return { statusCode, code, message: serverMessage ? serverMessage : `Something went wrong (error ${statusCode}). Please try again.` };
}

/** Port of iOS APIErrorDetailValue.init(from:) — string | [string] | other, never throws. */
function iosDetailValue(v: unknown): 'string' | 'stringArray' | 'other' {
  if (typeof v === 'string') return 'string';
  if (Array.isArray(v) && v.every((x) => typeof x === 'string')) return 'stringArray';
  return 'other';
}

/** Port of Android ApiError decoding (kotlinx, non-null code/message). Throws like MissingFieldException. */
function androidApiError(err: Json) {
  if (typeof err?.code !== 'string' || typeof err?.message !== 'string') throw new Error('MissingFieldException');
  if (err.details !== undefined && err.details !== null && (typeof err.details !== 'object' || Array.isArray(err.details))) throw new Error('details must be a map');
  if (err.timestamp !== undefined && err.timestamp !== null && Number.isNaN(Date.parse(err.timestamp))) throw new Error('bad Instant');
  return err;
}

const call = (contacts: unknown[]) =>
  POST(new Request('http://localhost/api/mobile/referrals/invites', { method: 'POST', body: JSON.stringify({ contacts }), headers: { 'content-type': 'application/json' } }) as any);

describe('422 INVALID_EMAIL vs shipped apps', () => {
  it('is a non-2xx with a readable code + message for old iOS, and decodes for old Android', async () => {
    const res = await call([{ email: 'r.celeste1957@yahoo.comr', name: 'Rosa' }, { email: 'sam@gmial.com' }]);
    const raw = await res.text();

    // Not 2xx: iOS `response.isSuccess` is false, Retrofit throws HttpException → both show their generic failure.
    expect(res.status).toBe(422);
    expect(res.status < 200 || res.status >= 300).toBe(true);

    const ios = iosMobileAPIError(res.status, raw);
    expect(ios).toEqual({ statusCode: 422, code: 'INVALID_EMAIL', message: "That email doesn't look right." });

    const body = JSON.parse(raw);
    expect(body.success).toBe(false); // so nobody tries to decode `data` as ReferralInvitesResponse
    for (const v of Object.values(body.error.details)) expect(['string', 'stringArray', 'other']).toContain(iosDetailValue(v));
    expect(() => androidApiError(body.error)).not.toThrow();
    expect(new Date(body.error.timestamp).toISOString()).toBe(body.error.timestamp);
  });

  it('carries the per-address list for new clients in data and error.details (same content)', async () => {
    const res = await call([{ email: 'ok@example.com' }, { phone: '416-555-0123', channel: 'sms' }, { email: 'sam@gmail.con' }]);
    const body = await res.json();
    const expected = [{ index: 2, email: 'sam@gmail.con', reason: 'unknown_tld', suggestion: 'sam@gmail.com' }];
    expect(body.data.invalidEmails).toEqual(expected);
    expect(body.error.details.invalidEmails).toEqual(expected);
    expect(invalidEmailsFrom(body)).toEqual(expected);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });

  it('every field of an entry is a primitive (index number, strings) — nothing a lenient decoder chokes on', async () => {
    const res = await call([{ email: 'not-an-email' }]);
    const [entry] = (await res.json()).data.invalidEmails;
    expect(entry).toEqual({ index: 0, email: 'not-an-email', reason: 'syntax' });
    expect(Object.values(entry).every((v) => typeof v === 'string' || typeof v === 'number')).toBe(true);
  });
});
