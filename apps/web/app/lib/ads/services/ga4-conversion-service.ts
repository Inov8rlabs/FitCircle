/**
 * Ga4ConversionService — sends RevenueCat subscription conversions to GA4 (the
 * Android Firebase app stream) with the Measurement Protocol, so Google Ads can
 * import them with real revenue (docs/GA4_SERVER_CONVERSIONS.md).
 *
 *  - Live: POST /api/webhooks/revenuecat schedules `sendForEventId` after the
 *    response (runAfterResponse). It never blocks or fails the webhook.
 *  - Sweep / backfill: GET /api/cron/ads/ga4-conversions re-checks PRODUCTION
 *    events still inside GA4's 72 h backdating window (dry-run by default).
 *
 * Exactly once per subscription_events.id: a row in ga4_conversion_sends
 * (migration 135) is claimed before sending; `sent` is never sent again.
 * Off unless GA4_SERVER_CONVERSIONS_ENABLED=true with GA4_MP_FIREBASE_APP_ID +
 * GA4_MP_API_SECRET set; otherwise a logged no-op. Until migration 135 is
 * applied nothing is sent (no idempotency record → no send).
 */
import { createAdminSupabase } from '@/lib/supabase-admin';

import {
  CONVERSION_RC_TYPES,
  SEND_WINDOW_MS,
  buildMpPayload,
  ga4MpConfig,
  mapRevenueCatEvent,
  mpUrl,
  reclaimDecision,
  sendTimestampMs,
  userEligibility,
  type Ga4Conversion,
  type Ga4MpConfig,
  type Ga4UserFacts,
  type MpPayload,
  type SendRow,
  type SendStatus,
} from '../ga4/conversions';
import type { RevenueEvent } from '../metrics';

// ---------------------------------------------------------------------------
// Store (Supabase in prod, in-memory in tests)
// ---------------------------------------------------------------------------

export type ClaimResult = 'claimed' | 'sent' | 'in_progress' | 'final' | 'unavailable';

export interface Ga4SendStore {
  loadEvent(eventId: string): Promise<RevenueEvent | null>;
  loadUser(userId: string): Promise<Ga4UserFacts | null>;
  /** Insert-or-reclaim the send row; only 'claimed' may send. */
  claim(eventId: string, meta: { userId: string; eventName: string; eventAt: string | null }, nowMs: number): Promise<ClaimResult>;
  finish(
    eventId: string,
    patch: { status: Exclude<SendStatus, 'sending'>; skipReason?: string | null; httpStatus?: number | null; error?: string | null; value?: number | null; currency?: string | null },
    nowMs: number
  ): Promise<void>;
  /** PRODUCTION conversion-type events with a user, at or after `sinceIso`, oldest first. */
  recentEvents(sinceIso: string, limit: number): Promise<RevenueEvent[]>;
  /** Existing send rows for these event ids. */
  sendRows(eventIds: string[]): Promise<Map<string, SendRow>>;
}

const MISSING_TABLE = (e: { code?: string; message?: string } | null | undefined) =>
  !!e && (e.code === '42P01' || e.code === 'PGRST205' || /ga4_conversion_sends/.test(e.message ?? '') && /does not exist|schema cache/i.test(e.message ?? ''));

let lastMissingLog = 0;
function logMissingTable() {
  const now = Date.now();
  if (now - lastMissingLog < 10 * 60_000) return;
  lastMissingLog = now;
  console.warn('[ga4-conversions] ga4_conversion_sends missing (migration 135 not applied); not sending');
}

export function supabaseGa4Store(): Ga4SendStore {
  const db = () => createAdminSupabase();
  return {
    async loadEvent(eventId) {
      const { data, error } = await db()
        .from('subscription_events')
        .select('id, user_id, type, store, environment, event_timestamp, raw')
        .eq('id', eventId)
        .maybeSingle();
      if (error) throw new Error(`subscription_events read failed: ${error.message}`);
      return (data as RevenueEvent | null) ?? null;
    },
    async loadUser(userId) {
      const [profile, attribution] = await Promise.all([
        db().from('profiles').select('id, email, is_admin').eq('id', userId).maybeSingle(),
        db().from('user_attribution').select('app_instance_id, platform, is_test').eq('user_id', userId).maybeSingle(),
      ]);
      if (profile.error) throw new Error(`profiles read failed: ${profile.error.message}`);
      if (!profile.data) return null;
      // A missing app_instance_id column (pre-117) reads as "no id".
      const a = attribution.error ? null : (attribution.data as any);
      return {
        email: (profile.data as any).email ?? null,
        isAdmin: (profile.data as any).is_admin ?? null,
        appInstanceId: a?.app_instance_id ?? null,
        platform: a?.platform ?? null,
        mockAttribution: a?.is_test === true,
      };
    },
    async claim(eventId, meta, nowMs) {
      const at = new Date(nowMs).toISOString();
      const { error } = await db().from('ga4_conversion_sends').insert({
        subscription_event_id: eventId,
        user_id: meta.userId,
        event_name: meta.eventName,
        event_at: meta.eventAt,
        status: 'sending',
        attempts: 1,
        created_at: at,
        updated_at: at,
      });
      if (!error) return 'claimed';
      if (MISSING_TABLE(error)) {
        logMissingTable();
        return 'unavailable';
      }
      if (error.code !== '23505') throw new Error(`ga4_conversion_sends claim failed: ${error.message}`);
      const { data: row, error: readError } = await db()
        .from('ga4_conversion_sends')
        .select('status, skip_reason, attempts, updated_at')
        .eq('subscription_event_id', eventId)
        .maybeSingle();
      if (readError || !row) return 'in_progress';
      const decision = reclaimDecision(row as SendRow, nowMs);
      if (decision !== 'reclaim') return decision;
      // Optimistic: only one concurrent caller moves (status, attempts) forward.
      const { data: won, error: updError } = await db()
        .from('ga4_conversion_sends')
        .update({ status: 'sending', attempts: (row as SendRow).attempts + 1, updated_at: at, event_name: meta.eventName })
        .eq('subscription_event_id', eventId)
        .eq('status', (row as SendRow).status)
        .eq('attempts', (row as SendRow).attempts)
        .select('subscription_event_id');
      if (updError) throw new Error(`ga4_conversion_sends reclaim failed: ${updError.message}`);
      return Array.isArray(won) && won.length === 1 ? 'claimed' : 'in_progress';
    },
    async finish(eventId, patch, nowMs) {
      const at = new Date(nowMs).toISOString();
      const { error } = await db()
        .from('ga4_conversion_sends')
        .update({
          status: patch.status,
          skip_reason: patch.skipReason ?? null,
          http_status: patch.httpStatus ?? null,
          error: patch.error ? patch.error.slice(0, 500) : null,
          value: patch.value ?? null,
          currency: patch.currency ?? null,
          updated_at: at,
          ...(patch.status === 'sent' ? { sent_at: at } : {}),
        })
        .eq('subscription_event_id', eventId);
      if (error) console.error('[ga4-conversions] finish failed:', eventId, error.message);
    },
    async recentEvents(sinceIso, limit) {
      const { data, error } = await db()
        .from('subscription_events')
        .select('id, user_id, type, store, environment, event_timestamp, raw')
        .eq('environment', 'PRODUCTION')
        .in('type', [...CONVERSION_RC_TYPES])
        .not('user_id', 'is', null)
        .gte('event_timestamp', sinceIso)
        .order('event_timestamp', { ascending: true })
        .limit(limit);
      if (error) throw new Error(`subscription_events read failed: ${error.message}`);
      return (data ?? []) as RevenueEvent[];
    },
    async sendRows(eventIds) {
      const out = new Map<string, SendRow>();
      for (let i = 0; i < eventIds.length; i += 200) {
        const { data, error } = await db()
          .from('ga4_conversion_sends')
          .select('subscription_event_id, status, skip_reason, attempts, updated_at')
          .in('subscription_event_id', eventIds.slice(i, i + 200));
        if (error) {
          if (MISSING_TABLE(error)) return out;
          throw new Error(`ga4_conversion_sends read failed: ${error.message}`);
        }
        for (const r of (data ?? []) as Array<SendRow & { subscription_event_id: string }>) out.set(r.subscription_event_id, r);
      }
      return out;
    },
  };
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export type SendMode = 'apply' | 'dry_run' | 'validate';

export type SendOutcome =
  | 'disabled'
  | 'not_configured'
  | 'not_found'
  | 'no_conversion'
  | 'too_old'
  | 'skipped'
  | 'already_sent'
  | 'in_progress'
  | 'final'
  | 'store_unavailable'
  | 'would_send'
  | 'validated'
  | 'sent'
  | 'failed';

export interface SendResult {
  eventId: string;
  outcome: SendOutcome;
  /** Why not sent: the mapping's / eligibility's reason, or the HTTP error. */
  reason?: string;
  eventName?: string;
  value?: number | null;
  currency?: string | null;
  store?: string;
  /** /debug/mp/collect messages (validate mode). */
  validationMessages?: unknown[];
}

export interface Ga4Deps {
  store?: Ga4SendStore;
  fetchImpl?: typeof fetch;
  env?: Record<string, string | undefined>;
  now?: () => number;
}

const MP_TIMEOUT_MS = 8_000;

let lastDisabledLog = 0;
function logDisabled(reason: string) {
  const now = Date.now();
  if (now - lastDisabledLog < 60 * 60_000) return;
  lastDisabledLog = now;
  console.log(`[ga4-conversions] not sending: ${reason} (GA4_SERVER_CONVERSIONS_ENABLED / GA4_MP_FIREBASE_APP_ID / GA4_MP_API_SECRET)`);
}

async function postMp(fetchImpl: typeof fetch, config: Ga4MpConfig, payload: MpPayload, debug: boolean): Promise<{ status: number; body: any }> {
  const res = await fetchImpl(mpUrl(config, debug), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(MP_TIMEOUT_MS),
  });
  let body: any = null;
  if (debug) body = await res.json().catch(() => null);
  return { status: res.status, body };
}

const summarize = (c: Ga4Conversion, e: RevenueEvent) => ({
  eventName: c.name,
  value: c.value,
  currency: c.currency,
  store: c.store,
  eventId: e.id ?? '',
});

export class Ga4ConversionService {
  /** Is live sending switched on and configured (cheap; the webhook checks this first). */
  static enabled(env: Record<string, string | undefined> = process.env): boolean {
    return ga4MpConfig(env).enabled;
  }

  /** Webhook entry: load the recorded event and send it once. Never throws. */
  static async sendForEventId(eventId: string, deps: Ga4Deps = {}): Promise<SendResult> {
    const env = deps.env ?? process.env;
    const cfg = ga4MpConfig(env);
    if (!cfg.enabled) {
      logDisabled(cfg.reason);
      return { eventId, outcome: cfg.reason };
    }
    try {
      const store = deps.store ?? supabaseGa4Store();
      const event = await store.loadEvent(eventId);
      if (!event) return { eventId, outcome: 'not_found' };
      return await this.sendEvent(event, 'apply', { ...deps, store, env });
    } catch (err: any) {
      console.error('[ga4-conversions] send failed:', eventId, err?.message ?? err);
      return { eventId, outcome: 'failed', reason: String(err?.message ?? err).slice(0, 200) };
    }
  }

  /**
   * One event. `apply` claims + sends (+ records), `dry_run` only evaluates,
   * `validate` posts to /debug/mp/collect (needs config, records nothing).
   */
  static async sendEvent(event: RevenueEvent, mode: SendMode, deps: Ga4Deps = {}): Promise<SendResult> {
    const env = deps.env ?? process.env;
    const now = deps.now ?? Date.now;
    const fetchImpl = deps.fetchImpl ?? fetch;
    const eventId = event.id ?? '';
    const cfg = ga4MpConfig(env);
    if (mode === 'apply' && !cfg.enabled) return { eventId, outcome: cfg.reason };
    if (mode === 'validate' && !cfg.config) return { eventId, outcome: 'not_configured' };
    if (!eventId) return { eventId, outcome: 'no_conversion', reason: 'no_event_id' };

    const mapping = mapRevenueCatEvent(event);
    if (!mapping.send) return { eventId, outcome: 'no_conversion', reason: mapping.reason };
    const c = mapping.conversion;
    const info = summarize(c, event);
    const nowMs = now();
    const ts = sendTimestampMs(c.atMs, nowMs);
    if (ts === null) return { ...info, outcome: 'too_old' };
    if (!event.user_id) return { ...info, outcome: 'skipped', reason: 'no_user' };

    const store = deps.store ?? supabaseGa4Store();
    if (mode === 'apply') {
      const claim = await store.claim(
        eventId,
        { userId: event.user_id, eventName: c.name, eventAt: c.atMs !== null ? new Date(c.atMs).toISOString() : null },
        nowMs
      );
      if (claim === 'sent') return { ...info, outcome: 'already_sent' };
      if (claim === 'in_progress') return { ...info, outcome: 'in_progress' };
      if (claim === 'final') return { ...info, outcome: 'final' };
      if (claim === 'unavailable') return { ...info, outcome: 'store_unavailable' };
    }

    const finish = async (patch: Parameters<Ga4SendStore['finish']>[1]) => {
      if (mode === 'apply') await store.finish(eventId, { value: c.value, currency: c.currency, ...patch }, now());
    };

    let user: Ga4UserFacts | null;
    try {
      user = await store.loadUser(event.user_id);
    } catch (err: any) {
      await finish({ status: 'failed', error: String(err?.message ?? err) });
      return { ...info, outcome: 'failed', reason: 'user_lookup' };
    }
    const who = userEligibility(user, env);
    if (!who.ok) {
      await finish({ status: 'skipped', skipReason: who.reason });
      return { ...info, outcome: 'skipped', reason: who.reason };
    }

    const payload = buildMpPayload({
      appInstanceId: who.appInstanceId,
      userId: event.user_id,
      eventId,
      conversion: c,
      timestampMs: ts,
      enforce: mode === 'validate',
    });
    if (mode === 'dry_run') return { ...info, outcome: 'would_send' };

    try {
      const res = await postMp(fetchImpl, cfg.config!, payload, mode === 'validate');
      if (mode === 'validate') {
        return { ...info, outcome: 'validated', validationMessages: Array.isArray(res.body?.validationMessages) ? res.body.validationMessages : [] };
      }
      if (res.status >= 200 && res.status < 300) {
        await finish({ status: 'sent', httpStatus: res.status });
        return { ...info, outcome: 'sent' };
      }
      await finish({ status: 'failed', httpStatus: res.status, error: `HTTP ${res.status}` });
      return { ...info, outcome: 'failed', reason: `http_${res.status}` };
    } catch (err: any) {
      // Never surface the URL (it carries the API secret).
      const msg = err?.name === 'TimeoutError' ? 'timeout' : String(err?.name ?? 'network_error');
      await finish({ status: 'failed', error: msg });
      return { ...info, outcome: 'failed', reason: msg };
    }
  }

  /**
   * Sweep / backfill: every PRODUCTION conversion event inside the backdating
   * window that has not been sent (or was skipped for a missing app instance
   * id, or failed). Dry-run unless mode = 'apply'. Sequential (volume is tiny).
   */
  static async sweep(opts: { mode?: SendMode; windowMs?: number; limit?: number } = {}, deps: Ga4Deps = {}) {
    const mode = opts.mode ?? 'dry_run';
    const env = deps.env ?? process.env;
    const now = deps.now ?? Date.now;
    const cfg = ga4MpConfig(env);
    if (mode === 'apply' && !cfg.enabled) return { mode, skipped: cfg.reason, scanned: 0, counts: {}, results: [] as SendResult[] };
    if (mode === 'validate' && !cfg.config) return { mode, skipped: 'not_configured' as const, scanned: 0, counts: {}, results: [] as SendResult[] };

    const windowMs = Math.min(Math.max(opts.windowMs ?? SEND_WINDOW_MS, 60_000), SEND_WINDOW_MS);
    const limit = Math.min(Math.max(opts.limit ?? 500, 1), 2000);
    const store = deps.store ?? supabaseGa4Store();
    const since = new Date(now() - windowMs).toISOString();
    const events = await store.recentEvents(since, limit);
    const existing = await store.sendRows(events.map((e) => e.id!).filter(Boolean));

    const results: SendResult[] = [];
    for (const e of events) {
      const row = e.id ? existing.get(e.id) : undefined;
      if (row) {
        const d = reclaimDecision(row, now());
        if (d === 'sent') {
          results.push({ eventId: e.id!, outcome: 'already_sent' });
          continue;
        }
        if (d !== 'reclaim') {
          results.push({ eventId: e.id!, outcome: d, reason: row.skip_reason ?? undefined });
          continue;
        }
      }
      results.push(await this.sendEvent(e, mode, { ...deps, store, env }));
    }

    const counts: Record<string, number> = {};
    for (const r of results) {
      const key = r.reason && (r.outcome === 'skipped' || r.outcome === 'no_conversion' || r.outcome === 'final') ? `${r.outcome}:${r.reason}` : r.outcome;
      counts[key] = (counts[key] ?? 0) + 1;
    }
    return {
      mode,
      skipped: null,
      since,
      scanned: events.length,
      truncated: events.length === limit,
      /** Conversions we could not send because the user has no Firebase app instance id (iOS, web-only, consent off). */
      missingAppInstanceId: results.filter((r) => r.reason === 'no_app_instance_id').length,
      counts,
      results: results.filter((r) => r.outcome !== 'no_conversion'),
    };
  }
}
