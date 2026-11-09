/** EU/EEA web sign-up + checkout restriction behind WEB_EU_SIGNUP_BLOCK (docs/PRIVACY_COMPLIANCE_SPEC.md §7). */
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { POST as register } from '@/api/auth/register/route';
import { POST as checkout } from '@/api/billing/checkout/route';
import { POST as mobileRegister } from '@/api/mobile/auth/register/route';
import {
  EU_EEA_COUNTRIES,
  euSignupBlockEnabled,
  isRegionRestricted,
  restrictedPagePath,
} from '@/lib/geo/region-restriction';

import { isPublicPath, middleware } from '../../middleware';

const req = (path: string, country?: string, method = 'GET', body?: unknown) =>
  new NextRequest(`https://www.fitcircle.ai${path}`, {
    method,
    headers: { ...(country ? { 'x-vercel-ip-country': country } : {}), 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });

let saved: string | undefined;
beforeEach(() => {
  saved = process.env.WEB_EU_SIGNUP_BLOCK;
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://test.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= 'anon';
});
afterEach(() => {
  if (saved === undefined) delete process.env.WEB_EU_SIGNUP_BLOCK;
  else process.env.WEB_EU_SIGNUP_BLOCK = saved;
});

describe('pure rules', () => {
  it('flag is ON by default (owner decision); only an explicit false/0/off/no reopens EU sign-up', () => {
    expect(euSignupBlockEnabled({})).toBe(true);
    for (const v of ['1', 'true', 'ON', 'yes', 'anything']) expect(euSignupBlockEnabled({ WEB_EU_SIGNUP_BLOCK: v })).toBe(true);
    for (const v of ['false', 'FALSE', '0', 'off', 'no']) expect(euSignupBlockEnabled({ WEB_EU_SIGNUP_BLOCK: v })).toBe(false);
  });
  it('EU-27 + IS/LI/NO + CH; the launch markets are never restricted', () => {
    expect(EU_EEA_COUNTRIES.size).toBe(31);
    for (const c of ['DE', 'FR', 'BG', 'IE', 'NO', 'CH']) expect(isRegionRestricted(req('/', c), { WEB_EU_SIGNUP_BLOCK: 'true' })).toBe(true);
    for (const c of ['GB', 'GG', 'JE', 'IM']) expect(isRegionRestricted(req('/', c), { WEB_EU_SIGNUP_BLOCK: 'true' })).toBe(true);
    for (const c of ['US', 'CA', 'IN', 'SG']) expect(isRegionRestricted(req('/', c), { WEB_EU_SIGNUP_BLOCK: 'true' })).toBe(false);
    expect(isRegionRestricted(req('/', 'GB'), { WEB_EU_SIGNUP_BLOCK: 'false' })).toBe(false); // same switch reopens the UK
    expect(isRegionRestricted(req('/'), { WEB_EU_SIGNUP_BLOCK: 'true' })).toBe(false); // unknown country
    expect(isRegionRestricted(req('/', 'DE'), {})).toBe(true); // default on
    expect(isRegionRestricted(req('/', 'DE'), { WEB_EU_SIGNUP_BLOCK: 'false' })).toBe(false); // explicitly reopened
  });
  it('only sign-up and purchase pages are gated', () => {
    expect(restrictedPagePath('/register')).toBe('signup');
    expect(restrictedPagePath('/upgrade')).toBe('checkout');
    for (const p of ['/login', '/settings/privacy', '/privacy', '/privacy/delete-account', '/dashboard']) expect(restrictedPagePath(p)).toBeNull();
  });
});

describe('middleware', () => {
  it('flag on + EU visitor: /register and /upgrade redirect to /not-available', async () => {
    process.env.WEB_EU_SIGNUP_BLOCK = 'true';
    const res = await middleware(req('/register', 'DE'));
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('https://www.fitcircle.ai/not-available?reason=signup');
    expect((await middleware(req('/upgrade', 'FR'))).headers.get('location')).toContain('reason=checkout');
  });
  it('the restriction page and the new legal pages are public', () => {
    for (const p of ['/not-available', '/consumer-health-privacy', '/privacy-choices', '/fr/privacy', '/fr/terms']) expect(isPublicPath(p)).toBe(true);
  });
});

describe('APIs', () => {
  it('flag on + EU: Stripe checkout and both register APIs answer 403 REGION_NOT_AVAILABLE', async () => {
    process.env.WEB_EU_SIGNUP_BLOCK = 'true';
    for (const res of [
      await checkout(req('/api/billing/checkout', 'NL', 'POST', { plan: 'monthly' })),
      await register(req('/api/auth/register', 'NL', 'POST', { email: 'a@example.com', password: 'longenough1', fullName: 'A B' })),
      await mobileRegister(req('/api/mobile/auth/register', 'IT', 'POST', { email: 'a@example.com', password: 'longenough1', name: 'A B' })),
    ]) {
      expect(res.status).toBe(403);
      expect((await res.json()).error.code).toBe('REGION_NOT_AVAILABLE');
    }
  });
});
