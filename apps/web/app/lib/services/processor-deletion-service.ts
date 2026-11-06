import { createHash } from 'crypto';

import { amplitudeServerKey } from '../analytics/amplitude-server';
import { createAdminSupabase } from '../supabase-admin';

/**
 * ProcessorDeletionService: tell our processors that a user deleted their
 * account (UK GDPR Art. 17 + Art. 19, Washington MHMDA, PIPEDA).
 *
 * Called by AccountDeletionService after the account rows and the auth user
 * are gone, with the identifiers captured before deletion. Every vendor call is
 * fail-soft: it never throws and never blocks the account deletion. Retries on
 * 429 / 5xx / network errors with backoff. Logs carry the user id only, never
 * the email.
 *
 *   amplitude   User Privacy API, POST /api/2/deletions/users (basic auth:
 *               API key + AMPLITUDE_SECRET_KEY).
 *   revenuecat  DELETE customer. The configured REVENUECAT_SECRET_API_KEY is a
 *               v2 key (see subscription-service), so the v2 endpoint
 *               DELETE /v2/projects/{project}/customers/{id} is used; the
 *               apps log in with the profile uuid in either casing, so both
 *               casings are deleted (404 = nothing there).
 *   stripe      customers.del(profiles.stripe_customer_id). Stripe keeps the
 *               invoices / charges of a deleted customer for its own tax and
 *               legal record keeping; that retention is Stripe's obligation.
 *   resend      contacts.remove from each audience in RESEND_AUDIENCE_IDS. The
 *               app sends transactional / lifecycle mail without audiences, so
 *               this is normally `skipped:no_audiences`. The email_suppressions
 *               hash row is a legitimate suppression record and is KEPT.
 *   sentry      no per-user deletion API; events expire with the 90-day
 *               retention disclosed in the privacy policy. No call is made.
 *
 * The user's subscription_events.raw payloads are scrubbed separately
 * (scrubSubscriptionEvents) before the profile is deleted.
 */

export type ProcessorVendor = 'amplitude' | 'revenuecat' | 'stripe' | 'resend' | 'sentry';
/** 'deleted' | 'skipped:<reason>' | 'failed:<reason>' */
export type ProcessorOutcome = string;
export type ProcessorDeletionSummary = Record<ProcessorVendor, ProcessorOutcome>;

export interface ProcessorSubject {
  userId: string;
  email?: string | null;
  stripeCustomerId?: string | null;
}

export interface StripeLike {
  customers: { del(id: string): Promise<unknown> };
}

export interface ResendLike {
  contacts: {
    remove(opts: { email: string; audienceId: string }): Promise<unknown>;
  };
}

export interface ProcessorDeletionDeps {
  fetch?: typeof fetch;
  env?: NodeJS.ProcessEnv;
  /** Lazily created so no vendor SDK is loaded unless it is configured. */
  stripe?: () => StripeLike | Promise<StripeLike>;
  resend?: () => ResendLike | Promise<ResendLike>;
  sleep?: (ms: number) => Promise<void>;
  maxAttempts?: number;
}

export const AMPLITUDE_DELETION_URL = 'https://amplitude.com/api/2/deletions/users';
export const REVENUECAT_API_BASE = 'https://api.revenuecat.com';
export const PRIVACY_REQUESTER = 'privacy@fitcircle.ai';
const DEFAULT_ATTEMPTS = 3;
const BACKOFF_MS = [500, 1500, 4000];
const REQUEST_TIMEOUT_MS = 8000;

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

class RetryableError extends Error {}
class FinalError extends Error {}

function log(vendor: ProcessorVendor, userId: string, status: string, attempt?: number) {
  console.log('[processor-deletion]', JSON.stringify({ vendor, userId, status, ...(attempt ? { attempt } : {}) }));
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

/** Stripe / Resend SDK errors expose statusCode; anything without one is treated as a network error. */
function sdkStatus(err: unknown): number | null {
  const e = err as { statusCode?: unknown; status?: unknown } | null;
  const status = typeof e?.statusCode === 'number' ? e.statusCode : typeof e?.status === 'number' ? e.status : null;
  return status;
}

export class ProcessorDeletionService {
  /** Run every vendor deletion concurrently. Never throws. */
  static async deleteFromProcessors(
    subject: ProcessorSubject,
    deps: ProcessorDeletionDeps = {}
  ): Promise<ProcessorDeletionSummary> {
    const tasks: Array<[ProcessorVendor, () => Promise<ProcessorOutcome>]> = [
      ['amplitude', () => this.deleteAmplitude(subject, deps)],
      ['revenuecat', () => this.deleteRevenueCat(subject, deps)],
      ['stripe', () => this.deleteStripe(subject, deps)],
      ['resend', () => this.deleteResend(subject, deps)],
      ['sentry', () => Promise.resolve('skipped:retention_90d')],
    ];

    const settled = await Promise.allSettled(tasks.map(([, run]) => run()));
    const summary = {} as ProcessorDeletionSummary;
    settled.forEach((result, i) => {
      const vendor = tasks[i][0];
      summary[vendor] =
        result.status === 'fulfilled'
          ? result.value
          : `failed:${result.reason instanceof Error ? result.reason.message : 'unknown'}`;
      log(vendor, subject.userId, summary[vendor]);
    });
    return summary;
  }

  // ==========================================================================
  // RETRY
  // ==========================================================================

  /**
   * Runs `attempt` up to maxAttempts times. The callback throws RetryableError
   * for 429 / 5xx / network problems and FinalError for anything else.
   */
  private static async withRetries(
    vendor: ProcessorVendor,
    userId: string,
    deps: ProcessorDeletionDeps,
    attempt: () => Promise<ProcessorOutcome>
  ): Promise<ProcessorOutcome> {
    const max = Math.max(1, deps.maxAttempts ?? DEFAULT_ATTEMPTS);
    const sleep = deps.sleep ?? defaultSleep;
    let last = 'unknown';
    for (let n = 1; n <= max; n++) {
      try {
        return await attempt();
      } catch (err) {
        last = err instanceof Error ? err.message : 'unknown';
        log(vendor, userId, `attempt_failed:${last}`, n);
        if (err instanceof FinalError) return `failed:${last}`;
        if (n < max) await sleep(BACKOFF_MS[Math.min(n - 1, BACKOFF_MS.length - 1)]);
      }
    }
    return `failed:${last}`;
  }

  private static async request(
    deps: ProcessorDeletionDeps,
    url: string,
    init: RequestInit
  ): Promise<Response> {
    const doFetch = deps.fetch ?? fetch;
    try {
      return await doFetch(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    } catch (err) {
      throw new RetryableError(`network:${err instanceof Error ? err.name : 'error'}`);
    }
  }

  // ==========================================================================
  // VENDORS
  // ==========================================================================

  static async deleteAmplitude(subject: ProcessorSubject, deps: ProcessorDeletionDeps = {}): Promise<ProcessorOutcome> {
    const env = deps.env ?? process.env;
    const secret = (env.AMPLITUDE_SECRET_KEY ?? '').trim();
    const apiKey = amplitudeServerKey(env) ?? (env.NEXT_PUBLIC_AMPLITUDE_API_KEY ?? '').trim();
    if (!secret || !apiKey) return 'skipped:not_configured';

    // iOS sets the Amplitude user id from UUID().uuidString (upper case).
    const userIds = Array.from(new Set([subject.userId, subject.userId.toLowerCase(), subject.userId.toUpperCase()]));
    const auth = Buffer.from(`${apiKey}:${secret}`).toString('base64');

    return this.withRetries('amplitude', subject.userId, deps, async () => {
      const res = await this.request(deps, AMPLITUDE_DELETION_URL, {
        method: 'POST',
        headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_ids: userIds, requester: PRIVACY_REQUESTER, ignore_invalid_id: true }),
      });
      if (res.ok) return 'deleted';
      if (isRetryableStatus(res.status)) throw new RetryableError(`http_${res.status}`);
      throw new FinalError(`http_${res.status}`);
    });
  }

  static async deleteRevenueCat(subject: ProcessorSubject, deps: ProcessorDeletionDeps = {}): Promise<ProcessorOutcome> {
    const env = deps.env ?? process.env;
    const apiKey = (env.REVENUECAT_SECRET_API_KEY ?? '').trim();
    const projectId = (env.REVENUECAT_PROJECT_ID ?? '').trim();
    if (!apiKey || !projectId) return 'skipped:not_configured';

    // Customer ids are case-sensitive; the apps log in with the profile uuid
    // in either casing (subscription-service resolveCustomerPath).
    const ids = Array.from(new Set([subject.userId, subject.userId.toUpperCase(), subject.userId.toLowerCase()]));

    return this.withRetries('revenuecat', subject.userId, deps, async () => {
      let deleted = 0;
      for (const id of ids) {
        const url = `${REVENUECAT_API_BASE}/v2/projects/${encodeURIComponent(projectId)}/customers/${encodeURIComponent(id)}`;
        const res = await this.request(deps, url, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${apiKey}` },
        });
        if (res.ok) {
          deleted++;
          continue;
        }
        if (res.status === 404) continue;
        if (isRetryableStatus(res.status)) throw new RetryableError(`http_${res.status}`);
        throw new FinalError(`http_${res.status}`);
      }
      return deleted > 0 ? 'deleted' : 'skipped:not_found';
    });
  }

  static async deleteStripe(subject: ProcessorSubject, deps: ProcessorDeletionDeps = {}): Promise<ProcessorOutcome> {
    const env = deps.env ?? process.env;
    const customerId = subject.stripeCustomerId?.trim();
    if (!customerId) return 'skipped:no_customer';
    const key = env.STRIPE_SECRET_KEY ?? '';
    if (!key || key.startsWith('sk_test_your')) return 'skipped:not_configured';

    let client: StripeLike;
    try {
      client = deps.stripe ? await deps.stripe() : await this.defaultStripe();
    } catch {
      return 'skipped:not_configured';
    }

    return this.withRetries('stripe', subject.userId, deps, async () => {
      try {
        // Stripe retains the invoices / charges of a deleted customer for its
        // own tax and legal record keeping; the customer object (email, name,
        // payment methods) is removed.
        await client.customers.del(customerId);
        return 'deleted';
      } catch (err) {
        const status = sdkStatus(err);
        const code = (err as { code?: string } | null)?.code;
        if (status === 404 || code === 'resource_missing') return 'skipped:not_found';
        if (status === null || isRetryableStatus(status)) throw new RetryableError(status ? `http_${status}` : 'network');
        throw new FinalError(`http_${status}`);
      }
    });
  }

  static async deleteResend(subject: ProcessorSubject, deps: ProcessorDeletionDeps = {}): Promise<ProcessorOutcome> {
    const env = deps.env ?? process.env;
    const audiences = (env.RESEND_AUDIENCE_IDS ?? env.RESEND_AUDIENCE_ID ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (audiences.length === 0) return 'skipped:no_audiences';
    if (!env.RESEND_API_KEY) return 'skipped:not_configured';
    const email = subject.email?.trim();
    if (!email) return 'skipped:no_email';

    let client: ResendLike;
    try {
      client = deps.resend ? await deps.resend() : await this.defaultResend(env.RESEND_API_KEY);
    } catch {
      return 'skipped:not_configured';
    }

    return this.withRetries('resend', subject.userId, deps, async () => {
      for (const audienceId of audiences) {
        let error: { statusCode?: number; name?: string } | null | undefined;
        try {
          const res = (await client.contacts.remove({ email, audienceId })) as { error?: typeof error } | undefined;
          error = res?.error;
        } catch (err) {
          const status = sdkStatus(err);
          if (status === null || isRetryableStatus(status)) throw new RetryableError(status ? `http_${status}` : 'network');
          throw new FinalError(`http_${status}`);
        }
        if (!error) continue;
        const status = typeof error.statusCode === 'number' ? error.statusCode : null;
        if (status === 404 || error.name === 'not_found') continue;
        if (status === null || isRetryableStatus(status)) throw new RetryableError(status ? `http_${status}` : 'error');
        throw new FinalError(`http_${status}`);
      }
      return 'deleted';
    });
  }

  private static async defaultStripe(): Promise<StripeLike> {
    const { getStripe } = await import('./billing-service');
    return getStripe();
  }

  private static async defaultResend(apiKey: string): Promise<ResendLike> {
    const { Resend } = await import('resend');
    return new Resend(apiKey) as unknown as ResendLike;
  }

  // ==========================================================================
  // subscription_events.raw
  // ==========================================================================

  /**
   * Replace identifiers in the user's subscription_events.raw payloads
   * (RevenueCat webhooks: app_user_id, original_app_user_id, aliases,
   * transferred_from/to, subscriber_attributes such as $email) with a one-way
   * hash, so the financial event survives without pointing at the person.
   * Must run while user_id still points at the user (it is SET NULL with the
   * profile). TypeScript only, no triggers. Never throws; returns rows scrubbed.
   */
  static async scrubSubscriptionEvents(
    userId: string,
    email: string | null | undefined,
    db: ReturnType<typeof createAdminSupabase> = createAdminSupabase()
  ): Promise<number> {
    let scrubbed = 0;
    try {
      const { data, error } = await db.from('subscription_events').select('id, raw').eq('user_id', userId);
      if (error) {
        log('revenuecat', userId, `raw_scrub_read_failed:${error.code ?? 'error'}`);
        return 0;
      }
      for (const row of (data ?? []) as Array<{ id: string; raw: unknown }>) {
        const raw = scrubIdentifiers(row.raw, userId, email);
        const { error: updateError } = await db.from('subscription_events').update({ raw }).eq('id', row.id);
        if (updateError) {
          log('revenuecat', userId, `raw_scrub_write_failed:${updateError.code ?? 'error'}`);
        } else {
          scrubbed++;
        }
      }
    } catch (err) {
      log('revenuecat', userId, `raw_scrub_failed:${err instanceof Error ? err.message : 'error'}`);
    }
    return scrubbed;
  }
}

// ============================================================================
// SCRUBBING
// ============================================================================

const IDENTIFIER_KEYS = new Set([
  'app_user_id',
  'original_app_user_id',
  'aliases',
  'transferred_from',
  'transferred_to',
  'subscriber_attributes',
  'email',
  '$email',
  'customer_email',
  'user_id',
  'display_name',
  'name',
  '$displayName',
  '$phoneNumber',
  'phone',
]);

export function hashIdentifier(value: string): string {
  return `sha256:${createHash('sha256').update(`fitcircle-deleted-user:${value.toLowerCase()}`).digest('hex').slice(0, 32)}`;
}

function redactValue(value: unknown): unknown {
  if (typeof value === 'string') return hashIdentifier(value);
  if (Array.isArray(value)) return value.map(redactValue);
  if (value && typeof value === 'object') return '[redacted]';
  return value;
}

/** Exported for tests. */
export function scrubIdentifiers(value: unknown, userId: string, email?: string | null): unknown {
  const needles = [userId, ...(email ? [email] : [])].filter(Boolean);
  const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(needles.map(escape).join('|'), 'gi');
  const walk = (v: unknown): unknown => {
    // Whole value or embedded (e.g. "user <uuid>"): every occurrence is hashed.
    if (typeof v === 'string') return v.replace(pattern, (hit) => hashIdentifier(hit));
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') {
      const out: Record<string, unknown> = {};
      for (const [key, inner] of Object.entries(v as Record<string, unknown>)) {
        out[key] = IDENTIFIER_KEYS.has(key) ? redactValue(inner) : walk(inner);
      }
      return out;
    }
    return v;
  };
  return walk(value);
}
