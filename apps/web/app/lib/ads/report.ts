/**
 * Slicing for the ads console (docs/ADS_CONSOLE_SPEC.md §5, §7). Pure: takes
 * already-loaded delivery rows, entities and the sign-up cohort and returns
 * table rows. Spend is grouped by the network entity it was reported on; users
 * by their attribution. Users whose attribution doesn't reach the grouped
 * level land in a per-channel "(none)" row, never folded into another row.
 */
import { eachDay } from './dates';
import { addDelivery, computeMetrics, cumulativeRoas, type CohortUser, type DeliveryTotals, emptyDelivery, userOutcome, type UserOutcome } from './metrics';
import {
  AD_CHANNELS,
  type AdEntityRow,
  type AdEntityView,
  type AdLevel,
  type AdMetricRow,
  type AdsRow,
  type AttributionChannel,
  type AttributionRow,
  CHANNEL_LABEL,
  type GroupBy,
  type TimeseriesPoint,
} from './types';

const PAID = new Set<AttributionChannel>(['apple_ads', 'meta', 'google_ads']);

export const SPEND_LEVEL: Record<GroupBy, AdLevel> = {
  channel: 'campaign',
  platform: 'campaign',
  campaign: 'campaign',
  ad_group: 'ad_group',
  keyword: 'keyword',
  ad: 'ad',
};

const ATTR_FIELD: Partial<Record<GroupBy, keyof AttributionRow>> = {
  campaign: 'campaign_external_id',
  ad_group: 'ad_group_external_id',
  keyword: 'keyword_external_id',
  ad: 'ad_external_id',
};

const PLATFORM_LABEL: Record<string, string> = { ios: 'iOS', android: 'Android', web: 'Web', all: 'All platforms', unknown: 'Unknown' };

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export function entityView(e: AdEntityRow): AdEntityView {
  const raw = (e.raw ?? {}) as Record<string, any>;
  const extra: Record<string, unknown> = {};
  if (raw.displayStatus) extra.displayStatus = raw.displayStatus;
  if (raw.servingStateReasons) extra.servingStateReasons = raw.servingStateReasons;
  if (typeof raw.automatedKeywordsOptIn === 'boolean') extra.searchMatch = raw.automatedKeywordsOptIn;
  if (raw.pricingModel) extra.pricingModel = raw.pricingModel;
  if (raw.paymentModel) extra.paymentModel = raw.paymentModel;
  if (raw.adChannelType) extra.adChannelType = raw.adChannelType;
  if (raw.objective) extra.objective = raw.objective;
  if (raw.effective_status) extra.effectiveStatus = raw.effective_status;
  return {
    channel: e.channel,
    platform: e.platform,
    level: e.level,
    externalId: e.external_id,
    parentExternalId: e.parent_external_id,
    campaignExternalId: e.campaign_external_id,
    name: e.name,
    status: e.status,
    servingStatus: e.serving_status,
    bidStrategy: e.bid_strategy,
    bidAmount: num(e.bid_amount),
    bidCurrency: e.bid_currency,
    dailyBudget: num(e.daily_budget),
    totalBudget: num(e.total_budget),
    matchType: e.match_type,
    countries: e.countries,
    startAt: e.start_at,
    endAt: e.end_at,
    creative: e.creative,
    syncedAt: e.synced_at,
    extra,
  };
}

/** Test attributions (Apple mock payload) don't count as attributed. */
export const effectiveAttribution = (u: CohortUser): AttributionRow | null => (u.attribution && !u.attribution.is_test ? u.attribution : null);

const entityKey = (channel: string, level: AdLevel, id: string) => `${channel}:${level}:${id}`;

function userKey(u: CohortUser, groupBy: GroupBy): string {
  const a = effectiveAttribution(u);
  const ch: AttributionChannel = a?.channel ?? 'unknown';
  if (groupBy === 'channel') return ch;
  if (groupBy === 'platform') return a?.platform ?? 'unknown';
  const field = ATTR_FIELD[groupBy]!;
  let id = a && PAID.has(ch) ? ((a[field] as string | null) ?? null) : null;
  // Apple default-product-page ads carry no adId; they report as default-<adGroupId>.
  if (!id && groupBy === 'ad' && ch === 'apple_ads' && a?.ad_group_external_id) id = `default-${a.ad_group_external_id}`;
  return id ? entityKey(ch, SPEND_LEVEL[groupBy], id) : `${ch}:none`;
}

function defaultPlatform(channel: string): string {
  return channel === 'apple_ads' ? 'ios' : channel === 'meta' || channel === 'google_ads' ? 'android' : 'unknown';
}

export interface SliceInput {
  metricRows: AdMetricRow[];
  entities: AdEntityRow[];
  cohort: CohortUser[];
  rangeEnd: string;
  today: string;
  /** Restrict to one channel / campaign (campaign drill-down, filtered timeseries). */
  filter?: { channel?: string | null; campaignExternalId?: string | null };
}

function inFilterUser(u: CohortUser, f: SliceInput['filter']): boolean {
  if (!f?.channel && !f?.campaignExternalId) return true;
  const a = effectiveAttribution(u);
  if (f.channel && (a?.channel ?? 'unknown') !== f.channel) return false;
  if (f.campaignExternalId && a?.campaign_external_id !== f.campaignExternalId) return false;
  return true;
}

/**
 * Totals and the time series pair spend with users, so with no channel /
 * campaign filter they count only users an ad network brought in (organic and
 * unknown sign-ups keep their own rows in the by-channel table).
 */
function inTotalsUser(u: CohortUser, f: SliceInput['filter']): boolean {
  if (f?.channel || f?.campaignExternalId) return inFilterUser(u, f);
  const a = effectiveAttribution(u);
  return !!a && (AD_CHANNELS as string[]).includes(a.channel);
}

function inFilterRow(r: { channel: string; campaign_external_id: string | null }, f: SliceInput['filter']): boolean {
  if (f?.channel && r.channel !== f.channel) return false;
  if (f?.campaignExternalId && r.campaign_external_id !== f.campaignExternalId) return false;
  return true;
}

export function buildRows(groupBy: GroupBy, input: SliceInput): AdsRow[] {
  const level = SPEND_LEVEL[groupBy];
  const byEntity = new Map(input.entities.map((e) => [entityKey(e.channel, e.level, e.external_id), e]));
  const campaigns = new Map(input.entities.filter((e) => e.level === 'campaign').map((e) => [`${e.channel}:${e.external_id}`, e]));
  const delivery = new Map<string, DeliveryTotals>();
  const outcomes = new Map<string, UserOutcome[]>();
  const keys = new Set<string>();

  const spendKey = (r: AdMetricRow) => {
    if (groupBy === 'channel') return r.channel;
    if (groupBy === 'platform') return campaigns.get(`${r.channel}:${r.external_id}`)?.platform ?? defaultPlatform(r.channel);
    return entityKey(r.channel, level, r.external_id);
  };

  // Every entity at this level shows up, even before it has delivery.
  for (const e of input.entities) {
    if (e.level !== level || !inFilterRow(e, input.filter)) continue;
    if (groupBy === 'channel') keys.add(e.channel);
    else if (groupBy === 'platform') keys.add(e.platform);
    else keys.add(entityKey(e.channel, level, e.external_id));
  }
  for (const r of input.metricRows) {
    if (r.level !== level || !inFilterRow(r, input.filter)) continue;
    const k = spendKey(r);
    keys.add(k);
    delivery.set(k, addDelivery(delivery.get(k) ?? emptyDelivery(), r));
  }
  // Below campaign level, delivery the network reports on no child entity
  // (Apple Search Match has no keyword; Meta has no keywords at all) goes to the
  // channel's "(none)" row, so every breakdown adds up to the campaign totals.
  if (level !== 'campaign') {
    for (const [channel, rest] of childRemainders(input.metricRows, level, input.filter)) {
      const k = `${channel}:none`;
      keys.add(k);
      const d = delivery.get(k) ?? emptyDelivery();
      delivery.set(k, addDelivery(d, rest));
    }
  }
  for (const u of input.cohort) {
    if (!inFilterUser(u, input.filter)) continue;
    const k = userKey(u, groupBy);
    keys.add(k);
    const list = outcomes.get(k) ?? [];
    list.push(userOutcome(u));
    outcomes.set(k, list);
  }

  const rows: AdsRow[] = [];
  for (const key of keys) {
    const metrics = computeMetrics(delivery.get(key) ?? emptyDelivery(), outcomes.get(key) ?? [], { rangeEnd: input.rangeEnd, today: input.today });
    rows.push({ ...describe(groupBy, key, byEntity, campaigns), metrics });
  }
  rows.sort((a, b) => b.metrics.spend - a.metrics.spend || b.metrics.users - a.metrics.users || a.label.localeCompare(b.label));
  return rows;
}

type DeliveryFields = Pick<AdMetricRow, 'spend' | 'currency' | 'impressions' | 'taps' | 'installs'>;

/**
 * Per channel: campaign-level delivery minus the delivery reported on `level`
 * rows (clamped at 0 per field; a negative gap is a data problem that
 * dataHealth reports, not something to show as negative spend).
 */
export function childRemainders(rows: AdMetricRow[], level: AdLevel, filter?: SliceInput['filter']): Map<string, DeliveryFields> {
  const camp = new Map<string, DeliveryTotals>();
  const child = new Map<string, DeliveryTotals>();
  for (const r of rows) {
    if (!inFilterRow(r, filter)) continue;
    if (r.level === 'campaign') camp.set(r.channel, addDelivery(camp.get(r.channel) ?? emptyDelivery(), r));
    else if (r.level === level) child.set(r.channel, addDelivery(child.get(r.channel) ?? emptyDelivery(), r));
  }
  const out = new Map<string, DeliveryFields>();
  for (const [channel, c] of camp) {
    const k = child.get(channel) ?? emptyDelivery();
    const rest = {
      spend: Math.max(0, Math.round(c.spend * 100) - Math.round(k.spend * 100)) / 100,
      currency: c.currency,
      impressions: Math.max(0, c.impressions - k.impressions),
      taps: Math.max(0, c.taps - k.taps),
      installs: Math.max(0, c.installs - k.installs),
    };
    if (rest.spend > 0 || rest.impressions > 0 || rest.taps > 0 || rest.installs > 0) out.set(channel, rest as DeliveryFields);
  }
  return out;
}

function describe(groupBy: GroupBy, key: string, byEntity: Map<string, AdEntityRow>, campaigns: Map<string, AdEntityRow>): Omit<AdsRow, 'metrics'> {
  const base = { key, groupBy, sublabel: null, platform: null, level: null, externalId: null, campaignExternalId: null, entity: null } as Omit<AdsRow, 'metrics' | 'label' | 'channel'>;
  if (groupBy === 'channel') return { ...base, label: CHANNEL_LABEL[key as AttributionChannel] ?? key, channel: key as AttributionChannel };
  if (groupBy === 'platform') return { ...base, label: PLATFORM_LABEL[key] ?? key, channel: null, platform: key };
  const [channel, ...rest] = key.split(':');
  const ch = channel as AttributionChannel;
  if (rest[0] === 'none') {
    const label = PAID.has(ch) ? `${CHANNEL_LABEL[ch]} · unattributed ${groupBy.replace('_', ' ')}` : CHANNEL_LABEL[ch] ?? channel;
    return {
      ...base,
      label,
      channel: ch,
      sublabel: PAID.has(ch) ? `Delivery and attributed users not tied to one ${groupBy.replace('_', ' ')} (e.g. Search Match)` : 'No ad spend',
    };
  }
  const level = rest[0] as AdLevel;
  const id = rest.slice(1).join(':');
  const e = byEntity.get(key) ?? null;
  const parent = e?.parent_external_id && level !== 'campaign' ? byEntity.get(entityKey(channel, level === 'ad_group' ? 'campaign' : 'ad_group', e.parent_external_id)) : null;
  const camp = e?.campaign_external_id ? campaigns.get(`${channel}:${e.campaign_external_id}`) : null;
  const sub = level === 'campaign' ? CHANNEL_LABEL[ch] : [camp?.name, level !== 'ad_group' ? parent?.name : null].filter(Boolean).join(' › ') || null;
  return {
    ...base,
    label: e?.name ?? (level === 'ad' && id.startsWith('default-') ? 'Default product page' : `#${id}`),
    sublabel: sub,
    channel: ch,
    platform: e?.platform ?? defaultPlatform(channel),
    level,
    externalId: id,
    campaignExternalId: e?.campaign_external_id ?? (level === 'campaign' ? id : null),
    entity: e ? entityView(e) : null,
  };
}

export function buildTotals(input: SliceInput): AdsRow {
  let d = emptyDelivery();
  for (const r of input.metricRows) if (r.level === 'campaign' && inFilterRow(r, input.filter)) d = addDelivery(d, r);
  const outs = input.cohort.filter((u) => inTotalsUser(u, input.filter)).map(userOutcome);
  return {
    key: 'total',
    groupBy: 'channel',
    label: 'Total',
    sublabel: null,
    channel: null,
    platform: null,
    level: null,
    externalId: null,
    campaignExternalId: null,
    entity: null,
    metrics: computeMetrics(d, outs, { rangeEnd: input.rangeEnd, today: input.today }),
  };
}

export function buildTimeseries(start: string, end: string, input: SliceInput): TimeseriesPoint[] {
  const days = eachDay(start, end);
  const idx = new Map(days.map((d, i) => [d, i]));
  const pts = days.map((date) => ({ date, spend: 0, installs: 0, users: 0, activated: 0, payers: 0, revenue: 0, cumulativeRoas: null as number | null }));
  for (const r of input.metricRows) {
    if (r.level !== 'campaign' || !inFilterRow(r, input.filter)) continue;
    const i = idx.get(r.date);
    if (i === undefined) continue;
    pts[i].spend = (Math.round(pts[i].spend * 100) + Math.round((Number(r.spend) || 0) * 100)) / 100;
    pts[i].installs += Number(r.installs) || 0;
  }
  for (const u of input.cohort) {
    if (!inTotalsUser(u, input.filter)) continue;
    const i = idx.get(u.signupDate);
    if (i === undefined) continue;
    const o = userOutcome(u);
    pts[i].users += 1;
    if (o.activated) pts[i].activated += 1;
    if (o.payer) pts[i].payers += 1;
    pts[i].revenue = (Math.round(pts[i].revenue * 100) + Math.round(o.revenueToDate * 100)) / 100;
  }
  const roas = cumulativeRoas(pts);
  pts.forEach((p, i) => (p.cumulativeRoas = roas[i]));
  return pts;
}
