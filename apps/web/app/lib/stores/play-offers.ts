/**
 * Google Play subscription offers (free trials) for FitCircle Pro (docs/TRIAL_SYNC.md §3.2).
 * androidpublisher v3 monetization.subscriptions.basePlans.offers.
 *
 * Credentials:
 * - Writes need GOOGLE_PLAY_MONETIZATION_SA_KEY: a service account invited in Play Console with the
 *   app permission "Manage store presence" ("Edit pricing, in-app products, and pricing templates").
 * - Reads use that key when set, else the releases tracker's read-only GOOGLE_PLAY_SA_KEY.
 *
 * Strategy (documented operations only; we never patch an ACTIVE offer):
 * one offer per trial length per base plan, id `<basePlanId>-trial<N>d` (the shipped offers are
 * `monthly-trial3d` / `annual-trial3d`). Switching to N days = create that offer from the current
 * one's targeting / regions / tags with the free phase set to PnD (or re-activate it if it already
 * exists with the same regions), activate it, then deactivate the other free-trial offers on the
 * base plan. Deactivating only stops NEW purchases; existing subscribers keep their offer. Offer
 * ids can never be reused once activated, which is why each length keeps its own id and switching
 * back re-activates the old one.
 *
 * The apps never name an offer: RevenueCat's default option on Android is the eligible offer with
 * the longest free trial (skipping offers tagged rc-ignore-offer), so a new offer id is picked up.
 */
import { parseServiceAccountKey, type GoogleServiceAccountKey } from '@/lib/ads/connectors/google-ads';
import { DEFAULT_PLAY_PACKAGE, GOOGLE_TOKEN_URL, PLAY_API, playJwtAssertion } from '@/lib/releases/connectors/google-play';

import { isoDurationDays, playDurationFor, type SupportedTrialDays } from './trial-durations';

type Json = Record<string, any>;
type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/** Play's regions version for create/patch (RegionsVersion). An older version keeps working after a new one ships. */
export const DEFAULT_PLAY_REGIONS_VERSION = '2022/02';

export interface PlayOfferInfo {
  productId: string;
  basePlanId: string;
  offerId: string;
  state: string;
  /** Days of the free phase when the offer starts with one (day/week based), else null. */
  trialDays: number | null;
  trialDuration: string | null;
  regions: string[];
  tags: string[];
  /** The raw offer, used as the template for a new one. */
  raw: Json;
}

export interface PlayBasePlanInfo {
  productId: string;
  basePlanId: string;
  state: string;
  autoRenewing: boolean;
  offers: PlayOfferInfo[];
}

export interface PlayOffersSnapshot {
  packageName: string;
  basePlans: PlayBasePlanInfo[];
}

export type PlayOp =
  | { kind: 'play.create'; productId: string; basePlanId: string; offerId: string; offer: Json }
  | { kind: 'play.activate'; productId: string; basePlanId: string; offerId: string }
  | { kind: 'play.deactivate'; productId: string; basePlanId: string; offerId: string; trialDays: number | null };

export interface PlayOffersConfig {
  packageName: string;
  readKey: GoogleServiceAccountKey | null;
  writeKey: GoogleServiceAccountKey | null;
  regionsVersion: string;
}

export function playOffersConfigFromEnv(env: NodeJS.ProcessEnv = process.env): PlayOffersConfig {
  const writeKey = parseServiceAccountKey(env.GOOGLE_PLAY_MONETIZATION_SA_KEY);
  return {
    packageName: env.GOOGLE_PLAY_PACKAGE_NAME?.trim() || DEFAULT_PLAY_PACKAGE,
    writeKey,
    readKey: writeKey ?? parseServiceAccountKey(env.GOOGLE_PLAY_SA_KEY),
    regionsVersion: env.GOOGLE_PLAY_REGIONS_VERSION?.trim() || DEFAULT_PLAY_REGIONS_VERSION,
  };
}

/** The first phase whose every regional config is free (a free trial), else null. */
export function freePhase(offer: Json): { index: number; phase: Json } | null {
  const phases: Json[] = offer?.phases ?? [];
  for (let i = 0; i < phases.length; i++) {
    const rc: Json[] = phases[i]?.regionalConfigs ?? [];
    const other = phases[i]?.otherRegionsConfig;
    const allFree = rc.length > 0 ? rc.every((r) => r && r.free !== undefined) : other?.free !== undefined;
    if (allFree) return { index: i, phase: phases[i] };
  }
  return null;
}

export function mapPlayOffer(o: Json): PlayOfferInfo {
  const fp = freePhase(o);
  return {
    productId: String(o.productId),
    basePlanId: String(o.basePlanId),
    offerId: String(o.offerId),
    state: String(o.state ?? 'STATE_UNSPECIFIED'),
    trialDays: fp ? isoDurationDays(fp.phase.duration) : null,
    trialDuration: fp ? String(fp.phase.duration ?? '') : null,
    regions: ((o.regionalConfigs ?? []) as Json[]).filter((r) => r.newSubscriberAvailability !== false).map((r) => String(r.regionCode)).sort(),
    tags: ((o.offerTags ?? []) as Json[]).map((t) => String(t.tag)),
    raw: o,
  };
}

export const isTrialOffer = (o: PlayOfferInfo) => o.trialDuration !== null;
export const targetOfferId = (basePlanId: string, days: number) => `${basePlanId}-trial${days}d`.toLowerCase().slice(0, 63);

export class PlayOffersClient {
  private tokens = new Map<'read' | 'write', string>();
  constructor(
    readonly cfg: PlayOffersConfig,
    private readonly fetchImpl: FetchLike = fetch
  ) {}

  static fromEnv(fetchImpl?: FetchLike): PlayOffersClient {
    return new PlayOffersClient(playOffersConfigFromEnv(), fetchImpl);
  }

  get canRead() {
    return !!this.cfg.readKey;
  }
  get canWrite() {
    return !!this.cfg.writeKey;
  }

  private async token(kind: 'read' | 'write'): Promise<string> {
    const cached = this.tokens.get(kind);
    if (cached) return cached;
    const key = kind === 'write' ? this.cfg.writeKey : this.cfg.readKey;
    if (!key) throw new Error(kind === 'write' ? 'Google Play writes need GOOGLE_PLAY_MONETIZATION_SA_KEY' : 'Google Play is not configured (GOOGLE_PLAY_SA_KEY)');
    const res = await this.fetchImpl(key.token_uri || GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: playJwtAssertion(key) }).toString(),
    });
    const json: Json = await res.json().catch(() => ({}));
    if (!res.ok || !json.access_token) throw new Error(`Google token: ${json.error_description ?? json.error ?? `HTTP ${res.status}`}`);
    this.tokens.set(kind, json.access_token);
    return json.access_token;
  }

  private async call(kind: 'read' | 'write', method: 'GET' | 'POST', path: string, body?: unknown): Promise<Json | null> {
    const token = await this.token(kind);
    const res = await this.fetchImpl(`${PLAY_API}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}) },
      body: method === 'POST' ? JSON.stringify(body ?? {}) : undefined,
    });
    const text = await res.text();
    let json: Json | null = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    if (!res.ok) {
      const err = new Error(`Google Play ${method} ${path.split('?')[0]}: ${json?.error?.message ?? `HTTP ${res.status}`}`) as Error & { status?: number };
      err.status = res.status;
      throw err;
    }
    return json;
  }

  private get pkg() {
    return encodeURIComponent(this.cfg.packageName);
  }

  /** Auto-renewing base plans with every offer. GETs only. */
  async snapshot(): Promise<PlayOffersSnapshot> {
    const subs: Json[] = [];
    let pageToken: string | null = null;
    for (let i = 0; i < 10; i++) {
      const page: Json | null = await this.call('read', 'GET', `/applications/${this.pkg}/subscriptions?pageSize=100${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`);
      subs.push(...(page?.subscriptions ?? []));
      pageToken = page?.nextPageToken ?? null;
      if (!pageToken) break;
    }
    const offers: Json[] = [];
    pageToken = null;
    for (let i = 0; i < 10; i++) {
      const page: Json | null = await this.call('read', 'GET', `/applications/${this.pkg}/subscriptions/-/basePlans/-/offers?pageSize=100${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`);
      offers.push(...(page?.subscriptionOffers ?? []));
      pageToken = page?.nextPageToken ?? null;
      if (!pageToken) break;
    }
    const mapped = offers.map(mapPlayOffer);
    const basePlans: PlayBasePlanInfo[] = [];
    for (const s of subs) {
      for (const bp of s.basePlans ?? []) {
        const autoRenewing = !!bp.autoRenewingBasePlanType;
        basePlans.push({
          productId: String(s.productId),
          basePlanId: String(bp.basePlanId),
          state: String(bp.state ?? 'STATE_UNSPECIFIED'),
          autoRenewing,
          offers: mapped.filter((o) => o.productId === s.productId && o.basePlanId === bp.basePlanId).sort((a, b) => a.offerId.localeCompare(b.offerId)),
        });
      }
    }
    basePlans.sort((a, b) => a.productId.localeCompare(b.productId) || a.basePlanId.localeCompare(b.basePlanId));
    return { packageName: this.cfg.packageName, basePlans };
  }

  private offerPath(op: { productId: string; basePlanId: string }) {
    return `/applications/${this.pkg}/subscriptions/${encodeURIComponent(op.productId)}/basePlans/${encodeURIComponent(op.basePlanId)}/offers`;
  }

  /** Executes one planned write (needs the monetization key). Activate / deactivate are idempotent on Play. */
  async apply(op: PlayOp): Promise<Json | null> {
    const ids = { packageName: this.cfg.packageName, productId: op.productId, basePlanId: op.basePlanId, offerId: op.offerId };
    if (op.kind === 'play.create') {
      const qs = `offerId=${encodeURIComponent(op.offerId)}&regionsVersion.version=${encodeURIComponent(this.cfg.regionsVersion)}`;
      return this.call('write', 'POST', `${this.offerPath(op)}?${qs}`, op.offer);
    }
    const verb = op.kind === 'play.activate' ? 'activate' : 'deactivate';
    return this.call('write', 'POST', `${this.offerPath(op)}/${encodeURIComponent(op.offerId)}:${verb}`, ids);
  }

  opRequest(op: PlayOp): { method: string; path: string; body?: unknown } {
    if (op.kind === 'play.create') {
      return { method: 'POST', path: `${this.offerPath(op)}?offerId=${op.offerId}&regionsVersion.version=${this.cfg.regionsVersion}`, body: op.offer };
    }
    return { method: 'POST', path: `${this.offerPath(op)}/${op.offerId}:${op.kind === 'play.activate' ? 'activate' : 'deactivate'}` };
  }
}

/** A new offer body from a template offer with its free phase set to `duration` (state / ids are set by Play). */
export function offerFromTemplate(template: Json, productId: string, basePlanId: string, offerId: string, packageName: string, duration: string): Json {
  const fp = freePhase(template);
  const phases: Json[] = (template.phases ?? []).map((p: Json, i: number) => (fp && i === fp.index ? { ...p, duration } : p));
  return {
    packageName,
    productId,
    basePlanId,
    offerId,
    phases,
    ...(template.targeting ? { targeting: template.targeting } : {}),
    regionalConfigs: template.regionalConfigs ?? [],
    ...(template.otherRegionsConfig ? { otherRegionsConfig: template.otherRegionsConfig } : {}),
    ...(template.offerTags ? { offerTags: template.offerTags } : {}),
  };
}

/**
 * Operations that leave exactly one ACTIVE free-trial offer of `days` on every active auto-renewing
 * base plan that sells a free trial today. Base plans with no free-trial offer at all are left alone.
 */
export function planPlayOps(snap: PlayOffersSnapshot, days: SupportedTrialDays): { ops: PlayOp[]; warnings: string[]; errors: string[] } {
  const duration = playDurationFor(days);
  const ops: PlayOp[] = [];
  const warnings: string[] = [];
  const errors: string[] = [];
  for (const bp of snap.basePlans) {
    if (!bp.autoRenewing || bp.state !== 'ACTIVE') continue;
    const trials = bp.offers.filter(isTrialOffer);
    if (!trials.length) continue;
    const active = trials.filter((o) => o.state === 'ACTIVE');
    const label = `${bp.productId}/${bp.basePlanId}`;
    if (active.length === 1 && active[0].trialDays === days) continue;
    // Template: the active trial offer (any of them, they share regions in practice), else the newest known one.
    const template = active[0] ?? trials[trials.length - 1];
    if (active.length > 1) warnings.push(`Google Play ${label}: ${active.length} free-trial offers are active (${active.map((o) => o.offerId).join(', ')}); all but the ${days}-day one will be deactivated.`);
    let target = active.find((o) => o.trialDays === days) ?? null;
    if (!target) {
      const sameRegions = (o: PlayOfferInfo) => o.regions.join(',') === template.regions.join(',');
      const existing = trials.find((o) => o.trialDays === days && o.state !== 'ACTIVE' && sameRegions(o) && o.raw?.phases?.length === template.raw?.phases?.length);
      if (existing) {
        ops.push({ kind: 'play.activate', productId: bp.productId, basePlanId: bp.basePlanId, offerId: existing.offerId });
        target = existing;
      } else {
        let offerId = targetOfferId(bp.basePlanId, days);
        let n = 2;
        while (bp.offers.some((o) => o.offerId === offerId)) offerId = `${targetOfferId(bp.basePlanId, days)}-v${n++}`;
        if (n > 2) warnings.push(`Google Play ${label}: ${targetOfferId(bp.basePlanId, days)} exists with different settings and an activated id can't be reused; creating ${offerId}.`);
        ops.push({ kind: 'play.create', productId: bp.productId, basePlanId: bp.basePlanId, offerId, offer: offerFromTemplate(template.raw, bp.productId, bp.basePlanId, offerId, snap.packageName, duration) });
        ops.push({ kind: 'play.activate', productId: bp.productId, basePlanId: bp.basePlanId, offerId });
        target = { ...template, offerId };
      }
    }
    for (const o of active) {
      if (o.offerId !== target.offerId) ops.push({ kind: 'play.deactivate', productId: bp.productId, basePlanId: bp.basePlanId, offerId: o.offerId, trialDays: o.trialDays });
    }
    if (template.tags.includes('rc-ignore-offer')) errors.push(`Google Play ${label}: the template offer is tagged rc-ignore-offer, so RevenueCat would not pick the new offer.`);
  }
  return { ops, warnings, errors };
}

/** Read-back check: every planned base plan has exactly one ACTIVE free-trial offer and it is `days` long. */
export function verifyPlay(snap: PlayOffersSnapshot, days: SupportedTrialDays, basePlans: ReadonlyArray<{ productId: string; basePlanId: string }>): string[] {
  const problems: string[] = [];
  for (const want of basePlans) {
    const bp = snap.basePlans.find((b) => b.productId === want.productId && b.basePlanId === want.basePlanId);
    const active = (bp?.offers ?? []).filter((o) => isTrialOffer(o) && o.state === 'ACTIVE');
    if (active.length !== 1 || active[0].trialDays !== days) {
      problems.push(`Google Play ${want.productId}/${want.basePlanId}: expected one active ${days}-day trial offer, found ${active.map((o) => `${o.offerId} (${o.trialDuration})`).join(', ') || 'none'}`);
    }
  }
  return problems;
}

export function describePlayOp(op: PlayOp, days: number): string {
  const where = `Google Play · ${op.productId} / ${op.basePlanId}`;
  if (op.kind === 'play.create') return `${where}: create offer ${op.offerId} (${days}-day free trial, same regions, eligibility and tags as the current offer)`;
  if (op.kind === 'play.activate') return `${where}: activate offer ${op.offerId}`;
  return `${where}: deactivate offer ${op.offerId}${op.trialDays ? ` (${op.trialDays}-day trial)` : ''}; existing subscribers keep it, new purchases stop`;
}
