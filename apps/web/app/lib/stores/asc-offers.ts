/**
 * App Store Connect introductory offers (free trials) for the FitCircle Pro subscriptions
 * (docs/TRIAL_SYNC.md §3.1). Reuses the campaigns ASC client/auth (ASC_KEY_ID / ASC_ISSUER_ID /
 * ASC_PRIVATE_KEY, app ASC_APP_ID; the key needs the App Manager role or higher).
 *
 * Apple facts this relies on (App Store Connect Help, "Set up introductory offers"):
 * - An introductory offer can't be edited ("To change the details of your introductory offer,
 *   delete it and create a new one"). The API's update request only accepts endDate.
 * - One current and one future introductory offer per storefront.
 * - Leaving startDate out (or today) makes the offer start immediately.
 *
 * So changing N days → M days is, per subscription × territory: DELETE the current offer, then
 * POST a new FREE_TRIAL offer (no startDate). If the create fails the old offer is re-created.
 * Reads are plain GETs; writes happen only in applyAscOp (called from TrialSyncService.apply).
 */
import { ASC_BASE, AscClient, ascConfig, type AscConfig } from '@/lib/campaigns/app-store';

import { ascDurationDays, ascDurationFor, type AscOfferDuration, type SupportedTrialDays } from './trial-durations';

type Json = Record<string, any>;

export type OfferTiming = 'current' | 'future' | 'ended';

export interface AscIntroOffer {
  id: string;
  territory: string;
  offerMode: string;
  duration: string;
  /** Whole days when day/week based, else null. */
  days: number | null;
  numberOfPeriods: number;
  startDate: string | null;
  endDate: string | null;
  targetSubscriptionPlanType: string | null;
  pricePointId: string | null;
  timing: OfferTiming;
}

export interface AscSubscriptionOffers {
  subscriptionId: string;
  productId: string;
  name: string;
  state: string | null;
  period: string | null;
  offers: AscIntroOffer[];
}

export interface AscOffersSnapshot {
  appId: string;
  subscriptions: AscSubscriptionOffers[];
}

export type AscOp =
  | { kind: 'asc.delete'; subscriptionId: string; productId: string; territory: string; offerId: string; previous: AscIntroOffer }
  | {
      kind: 'asc.create';
      subscriptionId: string;
      productId: string;
      territory: string;
      duration: AscOfferDuration;
      targetSubscriptionPlanType: string | null;
      /** The offer this replaces, re-created if this create fails. */
      replaces: AscIntroOffer | null;
    };

const MAX_PAGES = 10;

/** Today as YYYY-MM-DD in UTC (Apple dates are plain dates; "time varies by region"). */
export const isoDay = (now: Date) => now.toISOString().slice(0, 10);

export function offerTiming(startDate: string | null, endDate: string | null, today: string): OfferTiming {
  if (endDate && endDate < today) return 'ended';
  if (startDate && startDate > today) return 'future';
  return 'current';
}

/** subscriptionIntroductoryOffers list response → offers (territory from the relationship). */
export function mapIntroOffers(body: { data?: Json[] }, today: string): AscIntroOffer[] {
  return (body.data ?? []).map((o) => {
    const a = o.attributes ?? {};
    const startDate = typeof a.startDate === 'string' ? a.startDate : null;
    const endDate = typeof a.endDate === 'string' ? a.endDate : null;
    return {
      id: String(o.id),
      territory: String(o.relationships?.territory?.data?.id ?? 'UNKNOWN'),
      offerMode: String(a.offerMode ?? ''),
      duration: String(a.duration ?? ''),
      days: ascDurationDays(a.duration),
      numberOfPeriods: Number(a.numberOfPeriods ?? 1),
      startDate,
      endDate,
      targetSubscriptionPlanType: typeof a.targetSubscriptionPlanType === 'string' ? a.targetSubscriptionPlanType : null,
      pricePointId: o.relationships?.subscriptionPricePoint?.data?.id ?? null,
      timing: offerTiming(startDate, endDate, today),
    };
  });
}

export function ascOffersConfigured(): boolean {
  return !!ascConfig();
}

export class AscOffersClient {
  private readonly client: AscClient;
  constructor(cfg: AscConfig, fetchImpl: typeof fetch = fetch, sleep?: (ms: number) => Promise<void>) {
    this.client = new AscClient(cfg, fetchImpl, sleep);
  }

  static fromEnv(fetchImpl?: typeof fetch): AscOffersClient | null {
    const cfg = ascConfig();
    return cfg ? new AscOffersClient(cfg, fetchImpl) : null;
  }

  private async all(path: string): Promise<{ data: Json[]; included: Json[] }> {
    const data: Json[] = [];
    const included: Json[] = [];
    let next: string | null = path;
    for (let page = 0; next && page < MAX_PAGES; page++) {
      const res: Json = await this.client.call('GET', next);
      data.push(...(res?.data ?? []));
      included.push(...(res?.included ?? []));
      const link: string | undefined = res?.links?.next;
      next = link ? link.replace(ASC_BASE, '') : null;
    }
    return { data, included };
  }

  /** Every auto-renewable subscription of the app with its introductory offers. GETs only. */
  async snapshot(now = new Date()): Promise<AscOffersSnapshot> {
    const today = isoDay(now);
    const groups = await this.all(`/v1/apps/${this.client.appId}/subscriptionGroups?include=subscriptions&limit=50&limit[subscriptions]=50`);
    const subs = groups.included.filter((i) => i.type === 'subscriptions');
    const out: AscSubscriptionOffers[] = [];
    for (const s of subs) {
      const offers = await this.all(`/v1/subscriptions/${encodeURIComponent(s.id)}/introductoryOffers?include=territory&limit=200`);
      out.push({
        subscriptionId: String(s.id),
        productId: String(s.attributes?.productId ?? s.id),
        name: String(s.attributes?.name ?? s.attributes?.productId ?? s.id),
        state: s.attributes?.state ?? null,
        period: s.attributes?.subscriptionPeriod ?? null,
        offers: mapIntroOffers(offers, today).sort((a, b) => a.territory.localeCompare(b.territory) || (a.startDate ?? '').localeCompare(b.startDate ?? '')),
      });
    }
    out.sort((a, b) => a.productId.localeCompare(b.productId));
    return { appId: this.client.appId, subscriptions: out };
  }

  /** One subscription × territory's non-ended offers (used after a failed POST: ASC can answer 500 and still create). */
  async territoryOffers(subscriptionId: string, territory: string, now = new Date()): Promise<AscIntroOffer[]> {
    const res = await this.all(`/v1/subscriptions/${encodeURIComponent(subscriptionId)}/introductoryOffers?include=territory&limit=200`);
    return mapIntroOffers(res, isoDay(now)).filter((o) => o.territory === territory && o.timing !== 'ended');
  }

  /** Executes one planned write. A DELETE of an offer that is already gone counts as done (idempotent retry). */
  async apply(op: AscOp): Promise<{ id?: string }> {
    if (op.kind === 'asc.delete') {
      try {
        await this.client.call('DELETE', `/v1/subscriptionIntroductoryOffers/${encodeURIComponent(op.offerId)}`);
      } catch (e: any) {
        if (e?.data?.status === 404) return {};
        throw e;
      }
      return {};
    }
    const res: Json = await this.client.call('POST', '/v1/subscriptionIntroductoryOffers', ascCreateBody(op.subscriptionId, op.territory, op.duration, op.targetSubscriptionPlanType));
    return { id: res?.data?.id };
  }

  /** Best-effort undo of a delete whose replacement could not be created: re-create the previous offer. */
  async restore(previous: AscIntroOffer, subscriptionId: string): Promise<void> {
    await this.client.call(
      'POST',
      '/v1/subscriptionIntroductoryOffers',
      ascCreateBody(subscriptionId, previous.territory, previous.duration as AscOfferDuration, previous.targetSubscriptionPlanType, previous.offerMode, previous.numberOfPeriods, previous.pricePointId, previous.endDate)
    );
  }
}

/** POST /v1/subscriptionIntroductoryOffers body. No startDate = starts immediately. */
export function ascCreateBody(
  subscriptionId: string,
  territory: string,
  duration: AscOfferDuration,
  targetSubscriptionPlanType: string | null,
  offerMode = 'FREE_TRIAL',
  numberOfPeriods = 1,
  pricePointId: string | null = null,
  endDate: string | null = null
) {
  return {
    data: {
      type: 'subscriptionIntroductoryOffers',
      attributes: {
        duration,
        offerMode,
        numberOfPeriods,
        ...(endDate ? { endDate } : {}),
        ...(targetSubscriptionPlanType ? { targetSubscriptionPlanType } : {}),
      },
      relationships: {
        subscription: { data: { type: 'subscriptions', id: subscriptionId } },
        territory: { data: { type: 'territories', id: territory } },
        ...(pricePointId ? { subscriptionPricePoint: { data: { type: 'subscriptionPricePoints', id: pricePointId } } } : {}),
      },
    },
  };
}

/** Territories that currently have a free trial on ANY subscription: the set every subscription should cover. */
export function ascTrialTerritories(snap: AscOffersSnapshot): string[] {
  const set = new Set<string>();
  for (const s of snap.subscriptions) for (const o of s.offers) if (o.timing === 'current' && o.offerMode === 'FREE_TRIAL') set.add(o.territory);
  return [...set].sort();
}

/**
 * Operations that make every subscription's free trial exactly `days` in every trial territory.
 * A territory already on a current FREE_TRIAL of that duration, with no future offer queued, is left alone.
 */
export function planAscOps(snap: AscOffersSnapshot, days: SupportedTrialDays): { ops: AscOp[]; warnings: string[] } {
  const duration = ascDurationFor(days);
  const territories = ascTrialTerritories(snap);
  const ops: AscOp[] = [];
  const warnings: string[] = [];
  for (const s of snap.subscriptions) {
    for (const territory of territories) {
      const live = s.offers.filter((o) => o.territory === territory && o.timing !== 'ended');
      const current = live.filter((o) => o.timing === 'current');
      const future = live.filter((o) => o.timing === 'future');
      const ok = current.length === 1 && current[0].offerMode === 'FREE_TRIAL' && current[0].duration === duration && !current[0].endDate && future.length === 0;
      if (ok) continue;
      for (const o of current) {
        if (o.offerMode !== 'FREE_TRIAL') warnings.push(`App Store ${s.name} ${territory}: the current ${o.offerMode} introductory offer will be replaced by the free trial.`);
      }
      for (const o of future) warnings.push(`App Store ${s.name} ${territory}: a scheduled offer starting ${o.startDate} will be deleted.`);
      const template = current[0] ?? future[0] ?? null;
      for (const o of live) ops.push({ kind: 'asc.delete', subscriptionId: s.subscriptionId, productId: s.productId, territory, offerId: o.id, previous: o });
      ops.push({
        kind: 'asc.create',
        subscriptionId: s.subscriptionId,
        productId: s.productId,
        territory,
        duration,
        targetSubscriptionPlanType: template?.targetSubscriptionPlanType ?? (s.offers.find((o) => o.targetSubscriptionPlanType)?.targetSubscriptionPlanType ?? null),
        replaces: current[0] ?? null,
      });
      if (!current.length) warnings.push(`App Store ${s.name} ${territory}: has no current free trial; one will be created.`);
    }
  }
  return { ops, warnings };
}

/** Read-back check: every subscription × trial territory has exactly one current FREE_TRIAL of `days`. */
export function verifyAsc(snap: AscOffersSnapshot, days: SupportedTrialDays, territories: readonly string[]): string[] {
  const duration = ascDurationFor(days);
  const problems: string[] = [];
  for (const s of snap.subscriptions) {
    for (const t of territories) {
      const cur = s.offers.filter((o) => o.territory === t && o.timing === 'current');
      if (cur.length !== 1 || cur[0].offerMode !== 'FREE_TRIAL' || cur[0].duration !== duration) {
        problems.push(`App Store ${s.name} ${t}: expected one current ${days}-day free trial, found ${cur.map((o) => `${o.offerMode} ${o.duration}`).join(', ') || 'none'}`);
      }
    }
  }
  return problems;
}

export function describeAscOp(op: AscOp): string {
  if (op.kind === 'asc.delete') return `App Store · ${op.productId} · ${op.territory}: delete the current ${op.previous.offerMode} ${op.previous.duration} offer (Apple offers can't be edited)`;
  return `App Store · ${op.productId} · ${op.territory}: create a ${op.duration} FREE_TRIAL introductory offer starting today`;
}

export function ascOpRequest(op: AscOp): { method: string; path: string; body?: unknown } {
  if (op.kind === 'asc.delete') return { method: 'DELETE', path: `/v1/subscriptionIntroductoryOffers/${op.offerId}` };
  return { method: 'POST', path: '/v1/subscriptionIntroductoryOffers', body: ascCreateBody(op.subscriptionId, op.territory, op.duration, op.targetSubscriptionPlanType) };
}
