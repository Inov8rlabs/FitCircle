import { describe, expect, it } from 'vitest';

import {
  FC_REF_MAX_AGE_SECONDS,
  buildPendingInvite,
  detectPlatform,
  inviteDescription,
  inviteTitle,
  openInAppUrl,
  parsePendingInvite,
  pendingInviteCookieString,
  postSignupReturnUrl,
  readPendingInviteFromCookieHeader,
  registerUrlFor,
  serializePendingInvite,
} from '../web';

describe('fc_ref cookie', () => {
  it('round-trips through serialize/parse', () => {
    const invite = buildPendingInvite({ code: 'fitab12cd', ref: 'maya7k2', circle: 'FITAB12CD', ts: 1000 })!;
    expect(invite).toEqual({ code: 'FITAB12CD', ref: 'MAYA7K2', circle: 'FITAB12CD', ts: 1000 });
    expect(parsePendingInvite(serializePendingInvite(invite), 2000)).toEqual(invite);
  });

  it('expires after 7 days and rejects garbage', () => {
    const invite = buildPendingInvite({ code: 'MAYA7K2', ts: 0 })!;
    const raw = serializePendingInvite(invite);
    expect(parsePendingInvite(raw, FC_REF_MAX_AGE_SECONDS * 1000 - 1)).not.toBeNull();
    expect(parsePendingInvite(raw, FC_REF_MAX_AGE_SECONDS * 1000 + 1)).toBeNull();
    expect(parsePendingInvite('not-json')).toBeNull();
    expect(parsePendingInvite(encodeURIComponent(JSON.stringify({ code: '<script>', ts: Date.now() })))).toBeNull();
  });

  it('writes a 7-day Lax cookie and reads it back from a cookie header', () => {
    const invite = buildPendingInvite({ code: 'MAYA7K2', ref: 'MAYA7K2' })!;
    const str = pendingInviteCookieString(invite, true);
    expect(str).toMatch(/^fc_ref=/);
    expect(str).toContain(`Max-Age=${FC_REF_MAX_AGE_SECONDS}`);
    expect(str).toContain('Path=/');
    expect(str).toContain('SameSite=Lax');
    expect(str).toContain('Secure');
    const value = str.split(';')[0];
    expect(readPendingInviteFromCookieHeader(`a=1; ${value}; b=2`)?.code).toBe('MAYA7K2');
    expect(readPendingInviteFromCookieHeader('a=1')).toBeNull();
  });
});

describe('detectPlatform', () => {
  it('classifies common user agents', () => {
    expect(detectPlatform('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)')).toBe('ios');
    expect(detectPlatform('Mozilla/5.0 (Linux; Android 15; Pixel 9)')).toBe('android');
    expect(detectPlatform('Mozilla/5.0 (Macintosh; Intel Mac OS X 15_0)')).toBe('desktop');
    expect(detectPlatform('Mozilla/5.0 (Macintosh; Intel Mac OS X 15_0)', { maxTouchPoints: 5 })).toBe('ios');
    expect(detectPlatform(null)).toBe('desktop');
  });
});

describe('links', () => {
  it('builds register URLs for personal and circle invites', () => {
    expect(registerUrlFor({ code: 'MAYA7K2', ref: 'MAYA7K2', circle: null })).toBe('/register?ref=MAYA7K2');
    expect(registerUrlFor({ code: 'FITAB12CD', ref: 'MAYA7K2', circle: 'FITAB12CD' })).toBe(
      '/register?ref=MAYA7K2&circle=FITAB12CD'
    );
    expect(registerUrlFor({ code: 'FITAB12CD', ref: null, circle: 'FITAB12CD' })).toBe('/register?circle=FITAB12CD');
  });

  it('returns a post-signup join URL only for circle invites', () => {
    expect(postSignupReturnUrl('FITAB12CD', 'MAYA7K2')).toBe('/join/FITAB12CD?ref=MAYA7K2');
    expect(postSignupReturnUrl('FITAB12CD', null)).toBe('/join/FITAB12CD');
    expect(postSignupReturnUrl(null, 'MAYA7K2')).toBeNull();
    expect(postSignupReturnUrl('//evil.com', null)).toBeNull();
  });

  it('builds open-in-app links per platform', () => {
    const url = 'https://www.fitcircle.ai/join/FITAB12CD?ref=MAYA7K2';
    expect(openInAppUrl('desktop', url, 'x')).toBeNull();
    expect(openInAppUrl('ios', url, 'x')).toBe('https://fitcircle.ai/join/FITAB12CD?ref=MAYA7K2');
    const android = openInAppUrl('android', url, 'https://play.google.com/x?a=1')!;
    expect(android).toMatch(/^intent:\/\/www\.fitcircle\.ai\/join\/FITAB12CD\?ref=MAYA7K2#Intent;scheme=https;/);
    expect(android).toContain('package=com.inov8rlabs.apps.fitcircle');
    expect(android).toContain(`S.browser_fallback_url=${encodeURIComponent('https://play.google.com/x?a=1')}`);
  });
});

describe('copy', () => {
  const personal = {
    valid: true,
    kind: 'personal' as const,
    code: 'MAYA7K2',
    inviter: { firstName: 'Maya', displayName: 'Maya R.', avatarUrl: null },
    circle: null,
    inviteeRewardDays: 7,
  };

  it('titles personal and circle invites', () => {
    expect(inviteTitle(personal)).toBe('Maya saved you a seat on FitCircle');
    expect(
      inviteTitle({
        ...personal,
        kind: 'circle',
        circle: { name: 'Morning Movers', inviteCode: 'FITAB12CD', memberCount: 3, memberAvatars: [], challengeType: null },
      })
    ).toBe('Join Maya\'s circle “Morning Movers” on FitCircle');
    expect(inviteTitle({ valid: false })).toBe('Join me on FitCircle');
  });

  it('ties the reward to checking in, and drops it when disabled', () => {
    expect(inviteDescription(personal)).toContain('Check in on 3 different days and you both get a free week of Pro.');
    expect(inviteDescription({ ...personal, inviteeRewardDays: 0 })).not.toMatch(/Pro/);
    expect(inviteDescription(personal)).not.toMatch(/download/i);
  });
});
