/**
 * Server-side gate for addresses a member typed for someone else (referral
 * invites, circle invites). Runs the shared validator (lib/validation/email-address.ts)
 * and then a cheap DNS sanity check for uncommon domains, so we never hand
 * Resend an address that is certain to bounce.
 *
 * Wire shape (422 from every invite route) — see docs/INVITE_EMAIL_VALIDATION.md:
 *   { index, email, reason, suggestion? }
 */
import { promises as dns } from 'node:dns';

import { KNOWN_DOMAINS, validateEmailAddress, type EmailRejectReason } from '../validation/email-address';

/** `domain_not_found` is server-only: the domain has no MX and no A/AAAA record (or a null MX). */
export type InviteEmailRejectReason = EmailRejectReason | 'domain_not_found';

export interface InvalidInviteEmail {
  /** Position in the request's list (contacts[] / emails[]). */
  index: number;
  /** What the member typed (trimmed). */
  email: string;
  reason: InviteEmailRejectReason;
  suggestion?: string;
}

export const INVALID_EMAIL_MESSAGE = "That email doesn't look right.";

// ---------------------------------------------------------------------------
// DNS check: MX, falling back to A/AAAA (implicit MX). Fail-open on timeouts
// and resolver errors — only a definitive "no such domain / no mail host"
// rejects. Definitive verdicts are cached per domain for 6h (per serverless
// instance); fail-open verdicts are not cached, so a flaky resolver never
// pins a domain as "unknown" for hours.
//
// Hard rule: a lookup TIMEOUT is never evidence. If any lookup that the
// verdict depends on timed out (or failed with anything but NXDOMAIN/NODATA),
// the address is let through. Only answers the resolver actually gave
// (NXDOMAIN, NODATA, null MX) can block a send.
// ---------------------------------------------------------------------------

export interface MailDnsResolver {
  resolveMx(domain: string): Promise<Array<{ exchange: string; priority: number }>>;
  resolve4(domain: string): Promise<string[]>;
  resolve6(domain: string): Promise<string[]>;
}

export const DNS_TIMEOUT_MS = 1500;
export const DNS_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const CACHE_MAX = 1000;
const cache = new Map<string, { ok: boolean; at: number }>();
let resolver: MailDnsResolver = dns;
/** Off under vitest unless a test installs a resolver; `INVITE_EMAIL_MX_CHECK=off` disables in any env. */
let dnsEnabled = !process.env.VITEST;

/** Tests: install a fake resolver (enables the check) or pass null to restore defaults. */
export function setMailDnsResolverForTests(r: MailDnsResolver | null): void {
  resolver = r ?? dns;
  dnsEnabled = r !== null || !process.env.VITEST;
  cache.clear();
}

/** `INVITE_EMAIL_MX_CHECK=off|false|0` turns the DNS check off (format/TLD/typo rules still apply). */
export function mxCheckEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = (env.INVITE_EMAIL_MX_CHECK ?? '').trim().toLowerCase();
  return !['off', 'false', '0', 'no'].includes(v);
}

const DEFINITIVE = new Set(['ENOTFOUND', 'ENODATA', 'NXDOMAIN']);

/** yes = records; no = the resolver definitively said none; unknown = timeout / SERVFAIL / anything else. */
type Answer = 'yes' | 'no' | 'unknown';

async function lookup<T>(fn: () => Promise<T[]>): Promise<Answer> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const records = await Promise.race([
      fn(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(Object.assign(new Error('timeout'), { code: 'ETIMEOUT' })), DNS_TIMEOUT_MS);
      }),
    ]);
    return records.length > 0 ? 'yes' : 'no';
  } catch (err: any) {
    return DEFINITIVE.has(err?.code) ? 'no' : 'unknown';
  } finally {
    clearTimeout(timer);
  }
}

/** True unless the domain definitely can't receive mail. Never throws. */
export async function domainAcceptsMail(domain: string): Promise<boolean> {
  if (!dnsEnabled || !mxCheckEnabled() || KNOWN_DOMAINS.has(domain)) return true;
  const hit = cache.get(domain);
  if (hit && Date.now() - hit.at < DNS_CACHE_TTL_MS) return hit.ok;

  let nullMx = false;
  const mx = await lookup(async () => {
    const records = await resolver.resolveMx(domain);
    // RFC 7505 null MX ("." / "") = the domain explicitly accepts no mail.
    nullMx = records.length === 1 && (records[0].exchange === '' || records[0].exchange === '.');
    return records;
  });

  let verdict: { ok: boolean; definitive: boolean };
  if (mx === 'yes') verdict = { ok: !nullMx, definitive: true };
  else if (mx === 'unknown') verdict = { ok: true, definitive: false }; // MX timed out / errored: never block on that
  else {
    const [a, aaaa] = await Promise.all([lookup(() => resolver.resolve4(domain)), lookup(() => resolver.resolve6(domain))]);
    if (a === 'yes' || aaaa === 'yes') verdict = { ok: true, definitive: true };
    else if (a === 'unknown' || aaaa === 'unknown') verdict = { ok: true, definitive: false };
    else verdict = { ok: false, definitive: true }; // every lookup answered "no such host"
  }

  if (verdict.definitive) {
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string);
    cache.set(domain, { ok: verdict.ok, at: Date.now() });
  } else {
    console.warn('[invite-email-check] DNS inconclusive (timeout/resolver error), allowing domain:', domain);
  }
  return verdict.ok;
}

/**
 * Validate a batch. Returns one entry per rejected address (empty = all good)
 * and the normalized form of each accepted one, keyed by index.
 */
export async function checkInviteEmails(
  entries: Array<{ index: number; email: string | null | undefined }>
): Promise<{ invalid: InvalidInviteEmail[]; normalized: Map<number, string> }> {
  const invalid: InvalidInviteEmail[] = [];
  const normalized = new Map<number, string>();
  const pending: Array<{ index: number; email: string; domain: string }> = [];

  for (const { index, email } of entries) {
    const result = validateEmailAddress(email);
    if (!result.valid) {
      invalid.push({
        index,
        email: (email ?? '').trim().slice(0, 254),
        reason: result.reason ?? 'syntax',
        ...(result.suggestion ? { suggestion: result.suggestion } : {}),
      });
      continue;
    }
    normalized.set(index, result.normalized);
    pending.push({ index, email: result.normalized, domain: result.normalized.split('@')[1] });
  }

  const domains = [...new Set(pending.map((p) => p.domain))];
  const verdicts = new Map(await Promise.all(domains.map(async (d) => [d, await domainAcceptsMail(d)] as const)));
  for (const p of pending) {
    if (verdicts.get(p.domain) === false) {
      invalid.push({ index: p.index, email: p.email, reason: 'domain_not_found' });
      normalized.delete(p.index);
    }
  }
  invalid.sort((a, b) => a.index - b.index);
  return { invalid, normalized };
}
