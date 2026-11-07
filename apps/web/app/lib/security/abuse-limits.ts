/**
 * Shared abuse limits for auth and AI endpoints, keyed by IP, account (canonical
 * email or user id) and device id. Every check goes through applyRateLimit (shared
 * Redis window, in-memory fallback) and answers 429 RATE_LIMIT_EXCEEDED.
 *
 * Device ids here are client-reported (X-Device-Id / X-FitCircle-Device) and only
 * narrow a limit further; IP and account limits apply regardless.
 */
import { type NextRequest, type NextResponse } from 'next/server';

import { getClientIp } from '@/lib/http/client-ip';
import { normalizeDeviceId } from '@/lib/integrity/contract';
import { applyRateLimit, createRateLimiter, type SharedRateLimiter } from '@/lib/middleware/rate-limit';
import { recordSecurityEvent } from '@/lib/security/security-events';
import { canonicalEmail } from '@/lib/validation/email-canonical';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

type Dimension = 'ip' | 'account' | 'user' | 'device';

interface LimitDef {
  name: string;
  dimension: Dimension;
  interval: number;
  maxRequests: number;
}

/** The limits per action. Values here are the contract; tests pin them. */
export const ABUSE_LIMITS = {
  register: [
    { name: 'register-ip-1h', dimension: 'ip', interval: HOUR, maxRequests: 3 },
    { name: 'register-ip-1d', dimension: 'ip', interval: DAY, maxRequests: 10 },
    { name: 'register-device-1d', dimension: 'device', interval: DAY, maxRequests: 3 },
  ],
  login: [
    { name: 'login-ip-15m', dimension: 'ip', interval: 15 * MIN, maxRequests: 10 },
    { name: 'login-account-15m', dimension: 'account', interval: 15 * MIN, maxRequests: 5 },
  ],
  social_login: [
    { name: 'social-ip-15m', dimension: 'ip', interval: 15 * MIN, maxRequests: 20 },
    { name: 'social-device-15m', dimension: 'device', interval: 15 * MIN, maxRequests: 10 },
  ],
  refresh: [
    { name: 'refresh-ip-15m', dimension: 'ip', interval: 15 * MIN, maxRequests: 120 },
    { name: 'refresh-device-15m', dimension: 'device', interval: 15 * MIN, maxRequests: 20 },
  ],
  forgot_password: [
    { name: 'forgot-account-1h', dimension: 'account', interval: HOUR, maxRequests: 3 },
    { name: 'forgot-ip-1h', dimension: 'ip', interval: HOUR, maxRequests: 10 },
  ],
  resend_confirmation: [
    { name: 'resend-account-1h', dimension: 'account', interval: HOUR, maxRequests: 3 },
    { name: 'resend-ip-1h', dimension: 'ip', interval: HOUR, maxRequests: 10 },
  ],
  food_ai: [
    { name: 'food-ai-user-10m', dimension: 'user', interval: 10 * MIN, maxRequests: 20 },
    { name: 'food-ai-device-10m', dimension: 'device', interval: 10 * MIN, maxRequests: 30 },
  ],
  fitzy: [
    { name: 'fitzy-user-5m', dimension: 'user', interval: 5 * MIN, maxRequests: 30 },
    { name: 'fitzy-device-5m', dimension: 'device', interval: 5 * MIN, maxRequests: 40 },
  ],
  integrity_nonce: [
    { name: 'nonce-ip-10m', dimension: 'ip', interval: 10 * MIN, maxRequests: 120 },
    { name: 'nonce-device-10m', dimension: 'device', interval: 10 * MIN, maxRequests: 60 },
  ],
} as const satisfies Record<string, readonly LimitDef[]>;

export type AbuseAction = keyof typeof ABUSE_LIMITS;

const limiters = new Map<string, SharedRateLimiter>();

function limiterFor(def: LimitDef): SharedRateLimiter {
  let l = limiters.get(def.name);
  if (!l) {
    l = createRateLimiter({ name: def.name, interval: def.interval, maxRequests: def.maxRequests, uniqueTokenPerInterval: 10_000 });
    limiters.set(def.name, l);
  }
  return l;
}

export interface AbuseKeys {
  /** Email the request names (login / forgot / resend): limited per canonical mailbox. */
  email?: string | null;
  userId?: string | null;
  /** Overrides the device id read from headers. */
  deviceId?: string | null;
}

type HeaderSource = { headers: { get(name: string): string | null } };

/** Client-reported device id (integrity header first, then the referral hub header). */
export function requestDeviceId(request: HeaderSource): string | null {
  return normalizeDeviceId(request.headers.get('x-device-id')) ?? normalizeDeviceId(request.headers.get('x-fitcircle-device'));
}

function identifierFor(dimension: Dimension, request: HeaderSource, keys: AbuseKeys): string | null {
  switch (dimension) {
    case 'ip': {
      const ip = getClientIp(request);
      return ip ? `ip:${ip}` : 'ip:unknown';
    }
    case 'account': {
      const c = canonicalEmail(keys.email);
      return c ? `acct:${c}` : null;
    }
    case 'user':
      return keys.userId ? `user:${keys.userId}` : null;
    case 'device': {
      const d = keys.deviceId !== undefined ? normalizeDeviceId(keys.deviceId) : requestDeviceId(request);
      return d ? `dev:${d}` : null;
    }
  }
}

/**
 * Run every limit for an action. Returns the first 429 response, or null.
 * Dimensions without a key (no device id, no email) are skipped.
 */
export async function enforceAbuseLimits(request: NextRequest, action: AbuseAction, keys: AbuseKeys = {}): Promise<NextResponse | null> {
  for (const def of ABUSE_LIMITS[action] as readonly LimitDef[]) {
    const id = identifierFor(def.dimension, request, keys);
    if (!id) continue;
    const limited = await applyRateLimit(request, limiterFor(def), id);
    if (limited) {
      // One row per (ip prefix, route, limiter, minute) with a count: floods can't flood the table.
      await recordSecurityEvent(request, {
        kind: 'rate_limit',
        result: 'limited',
        action: def.name,
        reason: def.dimension,
        userId: keys.userId ?? null,
        deviceId: def.dimension === 'device' ? id.slice(4) : null,
        dedupe: true,
      });
      return limited;
    }
  }
  return null;
}
