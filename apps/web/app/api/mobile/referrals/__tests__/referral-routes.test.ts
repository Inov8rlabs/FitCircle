import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ReferralError } from '@/lib/referrals/types';

const requireMobileAuth = vi.fn();
vi.mock('@/lib/middleware/mobile-auth', () => ({
  requireMobileAuth: (...args: unknown[]) => requireMobileAuth(...args),
}));
const svc = vi.hoisted(() => ({
  claim: vi.fn(),
  getHub: vi.fn(),
  preview: vi.fn(),
  markRewardsSeen: vi.fn(),
  recordDevice: vi.fn(),
}));
vi.mock('@/lib/services/referral-service', () => ({ ReferralService: svc }));

import { GET as previewGET } from '../../../referrals/preview/route';
import { POST as claimPOST } from '../claim/route';
import { POST as seenPOST } from '../rewards/seen/route';
import { GET as hubGET } from '../route';

const USER = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const json = (url: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) }) as any;

beforeEach(() => {
  vi.clearAllMocks();
  requireMobileAuth.mockResolvedValue({ id: USER });
});

describe('POST /api/mobile/referrals/claim', () => {
  it('claims and answers the standard envelope', async () => {
    svc.claim.mockResolvedValue({ status: 'pending', inviter: { firstName: 'Maya', avatarUrl: null }, circle: null, inviteeRewardDays: 7 });
    const res = await claimPOST(json('http://localhost/api/mobile/referrals/claim', { code: 'MAYA7K2', source: 'paste', deviceId: 'IDFV-1234-5678' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true, data: { status: 'pending', inviter: { firstName: 'Maya' } }, error: null });
    expect(svc.claim).toHaveBeenCalledWith(USER, { code: 'MAYA7K2', ref: null, source: 'paste', deviceId: 'IDFV-1234-5678' });
  });

  it('treats explicit nulls as absent (Android/iOS optional fields)', async () => {
    svc.claim.mockResolvedValue({ status: 'pending' });
    const res = await claimPOST(json('http://localhost/x', { code: 'FITAB12CD', ref: null, source: 'universal_link', deviceId: null }));
    expect(res.status).toBe(200);
  });

  it.each([
    ['INVALID_CODE', 404],
    ['SELF_REFERRAL', 400],
    ['ALREADY_ATTRIBUTED', 409],
    ['WINDOW_CLOSED', 422],
    ['DEVICE_INELIGIBLE', 422],
    ['PROGRAM_DISABLED', 403],
  ] as const)('maps %s to %i', async (code, status) => {
    svc.claim.mockRejectedValue(new ReferralError(code, 'nope', code === 'ALREADY_ATTRIBUTED' ? { firstName: 'Maya' } : null));
    const res = await claimPOST(json('http://localhost/x', { code: 'MAYA7K2', source: 'typed' }));
    const body = await res.json();
    expect(res.status).toBe(status);
    expect(body).toMatchObject({ success: false, error: { code } });
    if (code === 'ALREADY_ATTRIBUTED') expect(body.data).toEqual({ firstName: 'Maya' });
  });

  it('rejects unknown sources and unauthenticated calls', async () => {
    expect((await claimPOST(json('http://localhost/x', { code: 'MAYA7K2', source: 'sms' }))).status).toBe(400);
    requireMobileAuth.mockRejectedValue(new Error('Unauthorized'));
    expect((await claimPOST(json('http://localhost/x', { code: 'MAYA7K2', source: 'typed' }))).status).toBe(401);
  });
});

describe('GET /api/mobile/referrals', () => {
  it('returns the hub and remembers the install id header', async () => {
    svc.getHub.mockResolvedValue({ enabled: false });
    const res = await hubGET(new Request('http://localhost/api/mobile/referrals', { headers: { 'X-FitCircle-Device': 'IDFV-9' } }) as any);
    expect(await res.json()).toMatchObject({ success: true, data: { enabled: false } });
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(svc.recordDevice).toHaveBeenCalledWith(USER, 'IDFV-9');
  });
});

describe('POST /api/mobile/referrals/rewards/seen', () => {
  it('marks rewards seen', async () => {
    svc.markRewardsSeen.mockResolvedValue(1);
    const id = '00000000-0000-4000-8000-000000000001';
    const res = await seenPOST(json('http://localhost/x', { ids: [id] }));
    expect(await res.json()).toMatchObject({ success: true, data: { updated: 1 } });
    expect(svc.markRewardsSeen).toHaveBeenCalledWith(USER, [id]);
  });
});

describe('GET /api/referrals/preview', () => {
  const get = (qs: string) => {
    const url = `http://localhost/api/referrals/preview${qs}`;
    const req = new Request(url) as any;
    req.nextUrl = new URL(url);
    return previewGET(req);
  };

  it('is public and answers valid:false for an empty code', async () => {
    const res = await get('');
    expect(await res.json()).toMatchObject({ success: true, data: { valid: false } });
    expect(requireMobileAuth).not.toHaveBeenCalled();
  });

  it('passes code + ref through', async () => {
    svc.preview.mockResolvedValue({ valid: true, kind: 'circle' });
    await get('?code=FITAB12CD&ref=MAYA7K2');
    expect(svc.preview).toHaveBeenCalledWith('FITAB12CD', 'MAYA7K2');
  });
});
