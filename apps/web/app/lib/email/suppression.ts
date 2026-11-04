/**
 * Email suppression list (docs/EMAIL_QUALITY.md §C).
 *
 * An address that hard-bounced or marked one of our emails as spam must never
 * be mailed again: every bounce and complaint costs the fitcircle.ai sending
 * reputation (and with it inbox placement for everyone). The Resend webhook
 * (/api/webhooks/resend) writes here; `sendEmail` in email-service.ts — the one
 * function every FitCircle email goes through — reads here before every send.
 *
 * Storage: `public.email_suppressions` (migration 127), keyed by the salted
 * hash of the lower-cased address (lib/referrals/contact-hash.ts) — invitees
 * aren't members, so we keep no plaintext address, only the hash + domain.
 *
 * Fail-open: if the table is missing (migration not applied yet) or the read
 * fails, the send goes ahead and we log loudly. Losing the suppression check
 * for a while is better than losing every email.
 */
import { emailAddressHash } from '../referrals/contact-hash';
import { createAdminSupabase } from '../supabase-admin';

export const SUPPRESSION_TABLE = 'email_suppressions';
export const SUPPRESSION_MIGRATION = '127_email_suppressions.sql';

export type SuppressionReason = 'hard_bounce' | 'complaint' | 'manual';

export interface SuppressionRow {
  email_hash: string;
  reason: SuppressionReason;
  domain: string | null;
  source: string;
  first_event_at: string;
  last_event_at: string;
  event_count: number;
  last_provider_email_id: string | null;
  detail: Record<string, unknown>;
}

export interface SuppressionWrite {
  address: string;
  reason: SuppressionReason;
  source?: string;
  at?: string;
  providerEmailId?: string | null;
  detail?: Record<string, unknown>;
}

/** Storage seam (Supabase in production, in-memory in tests). Methods may throw. */
export interface SuppressionStore {
  /** The subset of `hashes` that is suppressed. */
  findSuppressed(hashes: string[]): Promise<Set<string>>;
  /** Insert or refresh a suppression. */
  record(w: SuppressionWrite): Promise<'inserted' | 'updated'>;
}

/** Complaint is the stronger signal: a later bounce never downgrades it. */
const RANK: Record<SuppressionReason, number> = { hard_bounce: 1, complaint: 2, manual: 3 };

export function normalizeAddress(address: string): string {
  return address.trim().toLowerCase();
}

export function domainOfAddress(address: string): string | null {
  const a = normalizeAddress(address);
  const at = a.lastIndexOf('@');
  return at > 0 && at < a.length - 1 ? a.slice(at + 1) : null;
}

/** PostgREST / Postgres "relation does not exist". */
export function isMissingTableError(error: unknown): boolean {
  const e = error as { code?: string; message?: string } | null;
  if (!e) return false;
  if (e.code === '42P01' || e.code === 'PGRST205') return true;
  return /email_suppressions/.test(e.message ?? '') && /(does not exist|could not find|schema cache)/i.test(e.message ?? '');
}

export class SupabaseSuppressionStore implements SuppressionStore {
  async findSuppressed(hashes: string[]): Promise<Set<string>> {
    if (hashes.length === 0) return new Set();
    const { data, error } = await createAdminSupabase().from(SUPPRESSION_TABLE).select('email_hash').in('email_hash', hashes);
    if (error) throw error;
    return new Set(((data ?? []) as Array<{ email_hash: string }>).map((r) => r.email_hash));
  }

  async record(w: SuppressionWrite): Promise<'inserted' | 'updated'> {
    const supabase = createAdminSupabase();
    const hash = emailAddressHash(w.address);
    const at = w.at ?? new Date().toISOString();
    const { data: existing, error: readErr } = await supabase
      .from(SUPPRESSION_TABLE)
      .select('email_hash, reason, event_count, detail')
      .eq('email_hash', hash)
      .maybeSingle();
    if (readErr) throw readErr;

    if (!existing) {
      const { error } = await supabase.from(SUPPRESSION_TABLE).insert({
        email_hash: hash,
        reason: w.reason,
        domain: domainOfAddress(w.address),
        source: w.source ?? 'resend_webhook',
        first_event_at: at,
        last_event_at: at,
        event_count: 1,
        last_provider_email_id: w.providerEmailId ?? null,
        detail: w.detail ?? {},
      });
      if (!error) return 'inserted';
      if ((error as { code?: string }).code !== '23505') throw error;
      // Lost an insert race with a concurrent webhook delivery: fall through to update.
    }
    const prev = (existing ?? { reason: w.reason, event_count: 1, detail: {} }) as { reason: SuppressionReason; event_count: number; detail: Record<string, unknown> | null };
    const reason = RANK[w.reason] > RANK[prev.reason] ? w.reason : prev.reason;
    const { error } = await supabase
      .from(SUPPRESSION_TABLE)
      .update({
        reason,
        last_event_at: at,
        event_count: (prev.event_count ?? 1) + 1,
        last_provider_email_id: w.providerEmailId ?? null,
        detail: { ...(prev.detail ?? {}), ...(w.detail ?? {}) },
      })
      .eq('email_hash', hash);
    if (error) throw error;
    return 'updated';
  }
}

// ---------------------------------------------------------------------------
// Store selection. Under vitest the check is off unless a test installs a
// store (same pattern as the invite DNS check), so unrelated suites never
// touch a fake `email_suppressions` table.
// ---------------------------------------------------------------------------

let store: SuppressionStore | null = process.env.VITEST ? null : new SupabaseSuppressionStore();

export function setSuppressionStoreForTests(s: SuppressionStore | null): void {
  store = s;
  lastLoudLog = 0;
}

let lastLoudLog = 0;
const LOUD_LOG_EVERY_MS = 60_000;

/** Loud, but at most once a minute per instance (a campaign run would otherwise flood the logs). */
function logFailOpen(what: string, error: unknown): void {
  const now = Date.now();
  if (now - lastLoudLog < LOUD_LOG_EVERY_MS) return;
  lastLoudLog = now;
  const missing = isMissingTableError(error);
  console.error(
    missing
      ? `[email-suppression] ${what}: table public.${SUPPRESSION_TABLE} is MISSING — apply supabase/migrations/${SUPPRESSION_MIGRATION}. Sending WITHOUT the bounce/complaint suppression check (fail-open).`
      : `[email-suppression] ${what} FAILED — sending WITHOUT the bounce/complaint suppression check (fail-open):`,
    missing ? '' : ((error as { message?: string })?.message ?? error)
  );
}

/**
 * Which of these addresses are suppressed (returned normalised: trimmed,
 * lower-cased). Never throws: on any storage error returns an empty set
 * (fail-open) and logs loudly.
 */
export async function findSuppressedAddresses(addresses: readonly string[]): Promise<Set<string>> {
  const s = store;
  const list = [...new Set(addresses.map(normalizeAddress).filter((a) => a.includes('@')))];
  if (!s || list.length === 0) return new Set();
  try {
    const hashes = new Map(list.map((a) => [emailAddressHash(a), a] as const));
    const hit = await s.findSuppressed([...hashes.keys()]);
    return new Set([...hit].map((h) => hashes.get(h)!).filter(Boolean));
  } catch (error) {
    logFailOpen('suppression check', error);
    return new Set();
  }
}

export async function isEmailSuppressed(address: string | null | undefined): Promise<boolean> {
  if (!address) return false;
  return (await findSuppressedAddresses([address])).has(normalizeAddress(address));
}

/**
 * Record a hard bounce / complaint. Returns false (and logs loudly) when the
 * table is missing or the write fails — the webhook then answers 500 so Resend
 * retries the event later.
 */
export async function suppressAddress(w: SuppressionWrite): Promise<{ ok: boolean; outcome?: 'inserted' | 'updated'; error?: string }> {
  const s = store;
  if (!s) return { ok: false, error: 'no_store' };
  if (!normalizeAddress(w.address).includes('@')) return { ok: false, error: 'invalid_address' };
  try {
    return { ok: true, outcome: await s.record(w) };
  } catch (error) {
    const missing = isMissingTableError(error);
    console.error(
      missing
        ? `[email-suppression] cannot record ${w.reason}: table public.${SUPPRESSION_TABLE} is MISSING — apply supabase/migrations/${SUPPRESSION_MIGRATION}.`
        : `[email-suppression] cannot record ${w.reason}:`,
      missing ? '' : ((error as { message?: string })?.message ?? error)
    );
    return { ok: false, error: missing ? 'table_missing' : 'write_failed' };
  }
}

/** In-memory store for tests and scripts. */
export class MemorySuppressionStore implements SuppressionStore {
  rows = new Map<string, SuppressionRow>();
  failWith: unknown = null;

  async findSuppressed(hashes: string[]): Promise<Set<string>> {
    if (this.failWith) throw this.failWith as Error;
    return new Set(hashes.filter((h) => this.rows.has(h)));
  }

  async record(w: SuppressionWrite): Promise<'inserted' | 'updated'> {
    if (this.failWith) throw this.failWith as Error;
    const hash = emailAddressHash(w.address);
    const at = w.at ?? new Date().toISOString();
    const prev = this.rows.get(hash);
    if (!prev) {
      this.rows.set(hash, {
        email_hash: hash,
        reason: w.reason,
        domain: domainOfAddress(w.address),
        source: w.source ?? 'resend_webhook',
        first_event_at: at,
        last_event_at: at,
        event_count: 1,
        last_provider_email_id: w.providerEmailId ?? null,
        detail: w.detail ?? {},
      });
      return 'inserted';
    }
    this.rows.set(hash, {
      ...prev,
      reason: RANK[w.reason] > RANK[prev.reason] ? w.reason : prev.reason,
      last_event_at: at,
      event_count: prev.event_count + 1,
      last_provider_email_id: w.providerEmailId ?? null,
      detail: { ...prev.detail, ...(w.detail ?? {}) },
    });
    return 'updated';
  }

  add(address: string, reason: SuppressionReason = 'hard_bounce'): this {
    void this.record({ address, reason });
    return this;
  }
}
