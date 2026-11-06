/**
 * Server-side consent records (docs/PRIVACY_COMPLIANCE_SPEC.md).
 *
 * Storage: `user_consents` (migration 130), append-only. The current state of a
 * (user, type) is the newest row by (granted_at, created_at). Written only here,
 * with the service role.
 *
 * AI gating (the rule every AI path goes through, `aiDecision`):
 *  1. A server record decides when one exists: granted → allow; withdrawn → deny.
 *     An explicit withdrawal beats every fallback below.
 *  2. No record, user-initiated request:
 *       - client declares `X-Client-Features: consents_v1` → deny (403 AI_CONSENT_REQUIRED;
 *         the client shows its consent prompt and POSTs /api/mobile/consents);
 *       - client does not declare it (shipped apps before consent sync) → allow, because
 *         those apps gate AI on their on-device consent. Logged as `legacy_client`.
 *  3. No record, server-initiated (daily focus, free plan teaser, plan warm-up, push copy)
 *     → allow only with the hotfix evidence (lib/fitzy/ai-consent.ts, dd7badf): the user has
 *     chatted with Fitzy (the apps send chat only after AI consent). An unreadable consent
 *     store fails closed for server-initiated AI.
 *
 * Health data: record-only for now (exposed in GET so clients can gate).
 * Marketing email: mirrored into profiles.preferences.marketingEmails, which every
 * marketing sender already honours.
 */
import { createAdminSupabase } from '../supabase-admin';

export const CONSENT_TYPES = ['health_data', 'ai_processing', 'marketing_email'] as const;
export type ConsentType = (typeof CONSENT_TYPES)[number];

export const CONSENT_SOURCES = ['ios', 'android', 'web', 'server'] as const;
export type ConsentSource = (typeof CONSENT_SOURCES)[number];

/** Client capability: "I sync consents and handle 403 AI_CONSENT_REQUIRED". */
export const CONSENTS_FEATURE = 'consents_v1';

/** Version of the consent copy the current clients show (informational; clients send their own). */
export const CURRENT_CONSENT_POLICY_VERSION = '2026-11';

/** Earliest grantedAt accepted from a client migration (before any FitCircle AI consent existed). */
export const MIN_GRANTED_AT = Date.parse('2025-01-01T00:00:00Z');

export type AiFeature =
  | 'food_photo'
  | 'food_voice'
  | 'food_text'
  | 'food_estimate'
  | 'fitzy_chat'
  | 'fitzy_plan'
  | 'fitzy_focus'
  | 'fitzy_push'
  | 'nutrition_coach'
  | 'body_comp_scan'
  | 'plan_warmup'
  | 'training_capture';

export type AiInitiator = 'user' | 'server';

export type AiConsentBasis = 'record' | 'legacy_client' | 'chat_evidence' | 'withdrawn' | 'missing';

export interface AiDecision {
  allowed: boolean;
  basis: AiConsentBasis;
}

export interface ConsentState {
  granted: boolean;
  policyVersion: string;
  grantedAt: string;
  recordedAt: string;
  source: ConsentSource;
  appVersion: string | null;
}

export type ConsentSnapshot = Record<ConsentType, ConsentState | null>;

export interface ConsentInput {
  type: ConsentType;
  granted: boolean;
  policyVersion: string;
  /** Original decision time (migrating an on-device consent). Clamped server-side. */
  grantedAt?: string | null;
}

export const AI_CONSENT_MESSAGE =
  'To use AI features, allow FitCircle to send your data to our AI providers. You can turn this on in Settings > Privacy.';

/** Thrown when an AI path runs without consent. Routes map it to 403 AI_CONSENT_REQUIRED. */
export class AiConsentRequiredError extends Error {
  readonly code = 'AI_CONSENT_REQUIRED';
  readonly status = 403;
  constructor(readonly feature: AiFeature) {
    super(AI_CONSENT_MESSAGE);
    this.name = 'AiConsentRequiredError';
  }
}

/** The consent store isn't reachable (e.g. migration 130 not applied). Writes → 503. */
export class ConsentStoreUnavailableError extends Error {
  constructor(message = 'Consent storage is not available yet') {
    super(message);
    this.name = 'ConsentStoreUnavailableError';
  }
}

/** Standard error details for AI_CONSENT_REQUIRED (clients key off `consentType`). */
export function aiConsentErrorDetails(feature: AiFeature): Record<string, unknown> {
  return { consentType: 'ai_processing', feature, policyVersion: CURRENT_CONSENT_POLICY_VERSION };
}

type HeaderSource = { headers: { get(name: string): string | null } };

/** True when an X-Client-Features value lists consents_v1. Pure. */
export function declaresConsentsV1(features: string | null | undefined): boolean {
  return (features ?? '').split(',').some((f) => f.trim().toLowerCase() === CONSENTS_FEATURE);
}

export function requestDeclaresConsents(request: HeaderSource | null | undefined): boolean {
  return !!request && declaresConsentsV1(request.headers.get('x-client-features'));
}

/** ios / android from X-App-Platform (or X-Platform), else web. Pure. */
export function consentSourceFor(request: HeaderSource | null | undefined): ConsentSource {
  const p = (request?.headers.get('x-app-platform') ?? request?.headers.get('x-platform') ?? '').trim().toLowerCase();
  return p === 'ios' || p === 'android' ? p : 'web';
}

export function appVersionFor(request: HeaderSource | null | undefined): string | null {
  const v = (request?.headers.get('x-app-version') ?? '').trim();
  return v ? v.slice(0, 40) : null;
}

/**
 * Clamp a client-supplied decision time to [max(MIN_GRANTED_AT, accountCreatedAt), now].
 * Missing / unparseable → now. Pure.
 */
export function clampGrantedAt(raw: string | null | undefined, now: Date, accountCreatedAt?: string | null): string {
  const t = raw ? Date.parse(raw) : NaN;
  if (!Number.isFinite(t)) return now.toISOString();
  const created = accountCreatedAt ? Date.parse(accountCreatedAt) : NaN;
  const lower = Math.max(MIN_GRANTED_AT, Number.isFinite(created) ? created : MIN_GRANTED_AT);
  const upper = now.getTime();
  return new Date(Math.min(upper, Math.max(lower, t))).toISOString();
}

const isMissingTable = (error: any) =>
  !!error && (error.code === '42P01' || error.code === 'PGRST205' || /does not exist|could not find the table/i.test(error.message ?? ''));

/** Newest row per type (granted_at desc, then created_at desc). Pure. */
export function reduceConsentRows(rows: any[]): ConsentSnapshot {
  const out: ConsentSnapshot = { health_data: null, ai_processing: null, marketing_email: null };
  const newest = new Map<ConsentType, any>();
  for (const r of rows ?? []) {
    const type = r?.consent_type as ConsentType;
    if (!(CONSENT_TYPES as readonly string[]).includes(type)) continue;
    const cur = newest.get(type);
    const key = (x: any) => `${new Date(x.granted_at).toISOString()}|${new Date(x.created_at ?? x.granted_at).toISOString()}`;
    if (!cur || key(r) > key(cur)) newest.set(type, r);
  }
  for (const [type, r] of newest) {
    out[type] = {
      granted: r.granted === true,
      policyVersion: String(r.policy_version ?? ''),
      grantedAt: new Date(r.granted_at).toISOString(),
      recordedAt: new Date(r.created_at ?? r.granted_at).toISOString(),
      source: (CONSENT_SOURCES as readonly string[]).includes(r.source) ? r.source : 'server',
      appVersion: r.app_version ?? null,
    };
  }
  return out;
}

/**
 * The AI rule (see file header). Pure given its inputs, so routes, services and tests
 * share exactly one implementation.
 */
export function decideAi(
  record: ConsentState | null,
  opts: {
    initiator: AiInitiator;
    clientDeclaresConsents: boolean;
    hasChatEvidence: () => boolean;
    /**
     * What an old client (no consents_v1) gets without a record: 'allow' when that app gates the
     * feature on its on-device consent; 'evidence' when it never prompted for it (e.g. Pro
     * "Plan my week") → the server-initiated evidence rule.
     */
    legacyFallback?: 'allow' | 'evidence';
  }
): AiDecision {
  if (record) return record.granted ? { allowed: true, basis: 'record' } : { allowed: false, basis: 'withdrawn' };
  if (opts.initiator === 'user') {
    if (opts.clientDeclaresConsents) return { allowed: false, basis: 'missing' };
    if ((opts.legacyFallback ?? 'allow') === 'allow') return { allowed: true, basis: 'legacy_client' };
    return opts.hasChatEvidence() ? { allowed: true, basis: 'chat_evidence' } : { allowed: false, basis: 'missing' };
  }
  return opts.hasChatEvidence() ? { allowed: true, basis: 'chat_evidence' } : { allowed: false, basis: 'missing' };
}

export class ConsentService {
  /** Current state per type (null = never recorded). Fails soft to all-null on read errors. */
  static async current(userId: string): Promise<ConsentSnapshot> {
    return (await this.read(userId)).snapshot;
  }

  /**
   * Snapshot + whether the store was readable. A missing table (migration 130 not applied yet)
   * counts as readable-and-empty; any other error is `ok: false` (server-initiated AI fails closed).
   */
  static async read(userId: string): Promise<{ snapshot: ConsentSnapshot; ok: boolean }> {
    const { data, error } = await createAdminSupabase()
      .from('user_consents')
      .select('consent_type, granted, policy_version, source, app_version, granted_at, created_at')
      .eq('user_id', userId)
      .order('granted_at', { ascending: false })
      .limit(500);
    if (error) {
      if (isMissingTable(error)) return { snapshot: reduceConsentRows([]), ok: true };
      console.error('[consents] read failed:', error.message);
      return { snapshot: reduceConsentRows([]), ok: false };
    }
    return { snapshot: reduceConsentRows((data as any[]) ?? []), ok: true };
  }

  /**
   * What the user actually gets today, for UI toggles when no record exists:
   * marketing email follows profiles.preferences.marketingEmails (opt-out model: absent = on).
   */
  static async effective(userId: string): Promise<{ marketingEmail: boolean }> {
    const { data } = await createAdminSupabase().from('profiles').select('preferences').eq('id', userId).maybeSingle();
    return { marketingEmail: ((data as any)?.preferences?.marketingEmails ?? true) !== false };
  }

  /** Append one row per input; returns the new snapshot. Throws ConsentStoreUnavailableError on storage errors. */
  static async record(
    userId: string,
    consents: ConsentInput[],
    ctx: { source: ConsentSource; appVersion: string | null; now?: Date }
  ): Promise<ConsentSnapshot> {
    const now = ctx.now ?? new Date();
    const supabase = createAdminSupabase();
    let createdAt: string | null = null;
    if (consents.some((c) => c.grantedAt)) {
      const { data } = await supabase.from('profiles').select('created_at').eq('id', userId).maybeSingle();
      createdAt = (data as any)?.created_at ?? null;
    }
    const rows = consents.map((c) => ({
      user_id: userId,
      consent_type: c.type,
      granted: c.granted,
      policy_version: c.policyVersion.trim().slice(0, 40),
      source: ctx.source,
      app_version: ctx.appVersion,
      granted_at: clampGrantedAt(c.grantedAt ?? null, now, createdAt),
      created_at: now.toISOString(),
    }));
    if (rows.length > 0) {
      const { error } = await supabase.from('user_consents').insert(rows);
      if (error) {
        console.error('[consents] write failed:', error.message);
        throw new ConsentStoreUnavailableError();
      }
    }
    const snapshot = await this.current(userId);
    await this.applySideEffects(userId, consents, snapshot);
    return snapshot;
  }

  /**
   * Keep derived state in line with the decision (best-effort):
   *  - marketing_email → profiles.preferences.marketingEmails (what every sender checks);
   *  - ai_processing withdrawn → drop cached AI daily-focus rows.
   */
  static async applySideEffects(userId: string, consents: ConsentInput[], snapshot: ConsentSnapshot): Promise<void> {
    const supabase = createAdminSupabase();
    try {
      if (consents.some((c) => c.type === 'marketing_email') && snapshot.marketing_email) {
        const { data } = await supabase.from('profiles').select('preferences').eq('id', userId).maybeSingle();
        const prefs = { ...(((data as any)?.preferences as Record<string, unknown>) ?? {}), marketingEmails: snapshot.marketing_email.granted };
        await supabase.from('profiles').update({ preferences: prefs }).eq('id', userId);
      }
      if (consents.some((c) => c.type === 'ai_processing') && snapshot.ai_processing && !snapshot.ai_processing.granted) {
        await supabase.from('fitzy_daily').delete().eq('user_id', userId);
      }
    } catch (err: any) {
      console.error('[consents] side effect failed:', err?.message ?? err);
    }
  }

  /** Hotfix evidence (lib/fitzy/ai-consent.ts): the user has chatted with Fitzy. Fails closed. */
  static async hasChatEvidence(userId: string): Promise<boolean> {
    const { hasFitzyConversation } = await import('../fitzy/ai-consent');
    return hasFitzyConversation(userId);
  }

  /** The AI rule for one user (see file header). */
  static async aiDecision(
    userId: string,
    opts: { feature: AiFeature; initiator: AiInitiator; request?: HeaderSource | null; legacyFallback?: 'allow' | 'evidence' }
  ): Promise<AiDecision> {
    const { snapshot, ok } = await this.read(userId);
    if (!ok && opts.initiator === 'server') {
      console.info('[ai-consent] blocked', JSON.stringify({ userId, feature: opts.feature, basis: 'store_unreadable', initiator: 'server' }));
      return { allowed: false, basis: 'missing' };
    }
    const declares = requestDeclaresConsents(opts.request);
    const needsEvidence =
      !snapshot.ai_processing && (opts.initiator === 'server' || (!declares && opts.legacyFallback === 'evidence'));
    const evidence = needsEvidence ? await this.hasChatEvidence(userId) : false;
    const decision = decideAi(snapshot.ai_processing, {
      initiator: opts.initiator,
      clientDeclaresConsents: declares,
      hasChatEvidence: () => evidence,
      legacyFallback: opts.legacyFallback,
    });
    if (decision.basis === 'legacy_client') {
      console.info(
        '[ai-consent] legacy_client',
        JSON.stringify({
          userId,
          feature: opts.feature,
          platform: opts.request?.headers.get('x-app-platform') ?? null,
          appVersion: appVersionFor(opts.request),
        })
      );
    } else if (!decision.allowed) {
      console.info('[ai-consent] blocked', JSON.stringify({ userId, feature: opts.feature, basis: decision.basis, initiator: opts.initiator }));
    }
    return decision;
  }

  /** User-initiated AI request: throws AiConsentRequiredError when not allowed. */
  static async assertUserAi(
    userId: string,
    request: HeaderSource,
    feature: AiFeature,
    opts: { legacyFallback?: 'allow' | 'evidence' } = {}
  ): Promise<void> {
    const d = await this.aiDecision(userId, { feature, initiator: 'user', request, legacyFallback: opts.legacyFallback });
    if (!d.allowed) throw new AiConsentRequiredError(feature);
  }

  /** Server-initiated AI: true only with a granted record or chat evidence. */
  static async serverAiAllowed(userId: string, feature: AiFeature): Promise<boolean> {
    return (await this.aiDecision(userId, { feature, initiator: 'server' })).allowed;
  }

  /**
   * Batch form of serverAiAllowed for crons (push). Users with a granted record, plus users
   * with no record who have chatted with Fitzy; a withdrawal always excludes.
   */
  static async serverAiAllowedSet(userIds: string[], chatEvidence: Set<string>): Promise<Set<string>> {
    const out = new Set<string>();
    if (userIds.length === 0) return out;
    const supabase = createAdminSupabase();
    const rows: any[] = [];
    let readOk = true;
    for (let i = 0; i < userIds.length; i += 200) {
      const part = userIds.slice(i, i + 200);
      const { data, error } = await supabase
        .from('user_consents')
        .select('user_id, consent_type, granted, policy_version, source, app_version, granted_at, created_at')
        .in('user_id', part)
        .eq('consent_type', 'ai_processing')
        .limit(part.length * 50);
      if (error) {
        if (isMissingTable(error)) break; // migration 130 not applied: no records, evidence decides
        console.error('[consents] batch read failed (server AI fails closed):', error.message);
        readOk = false;
        break;
      }
      rows.push(...((data as any[]) ?? []));
    }
    if (!readOk) return out;
    const byUser = new Map<string, any[]>();
    for (const r of rows) byUser.set(r.user_id, [...(byUser.get(r.user_id) ?? []), r]);
    for (const id of userIds) {
      const record = reduceConsentRows(byUser.get(id) ?? []).ai_processing;
      if (decideAi(record, { initiator: 'server', clientDeclaresConsents: false, hasChatEvidence: () => chatEvidence.has(id) }).allowed) out.add(id);
    }
    return out;
  }
}
