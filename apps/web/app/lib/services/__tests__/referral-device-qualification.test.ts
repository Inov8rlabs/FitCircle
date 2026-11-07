/**
 * Referral device rules (app integrity): only integrity_v1 Android claims without a live
 * attestation are held; legacy clients qualify normally; a shared attested device rejects.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ devices: {} as Record<string, string[]>, mode: 'block' }));
vi.mock('@/lib/integrity/attestations', () => ({ attestedDeviceIds: async (userId: string) => h.devices[userId] ?? [] }));
vi.mock('@/lib/integrity/enforcement', () => ({ enforceMode: async () => h.mode }));
vi.mock('@/lib/supabase-admin', () => ({ createAdminSupabase: () => ({}) }));

import { ReferralService } from '../referral-service';

const base = {
  id: 'r1',
  invitee_id: 'invitee',
  inviter_id: 'inviter',
  code: 'MAYA7K2',
  circle_id: null,
  source: 'paste',
  status: 'pending' as const,
  status_reason: null,
  attributed_at: '2026-11-01T00:00:00Z',
  qualified_at: null,
};

beforeEach(() => {
  h.devices = {};
  h.mode = 'block';
});

describe('ReferralService.deviceQualification', () => {
  it('legacy Android claims (no integrity_v1: attested null) are not held', async () => {
    expect(await ReferralService.deviceQualification({ ...base, invitee_platform: 'android', invitee_device_attested: null })).toBe('ok');
    expect(await ReferralService.deviceQualification({ ...base })).toBe('ok'); // before migration 132
  });

  it('integrity_v1 claims without a live attestation are held for review', async () => {
    expect(await ReferralService.deviceQualification({ ...base, invitee_platform: 'android', invitee_device_attested: false })).toBe('device_not_attested');
  });

  it('…unless enforcement is switched off', async () => {
    h.mode = 'off';
    expect(await ReferralService.deviceQualification({ ...base, invitee_device_attested: false })).toBe('ok');
  });

  it('attested claims qualify', async () => {
    expect(await ReferralService.deviceQualification({ ...base, invitee_device_attested: true })).toBe('ok');
  });

  it('a device both accounts attested from is the inviter’s phone (any client)', async () => {
    h.devices = { inviter: ['dev-a', 'dev-b'], invitee: ['dev-b'] };
    expect(await ReferralService.deviceQualification({ ...base, invitee_device_attested: null })).toBe('device_matches_inviter');
    expect(await ReferralService.deviceQualification({ ...base, invitee_device_attested: true })).toBe('device_matches_inviter');
  });
});
