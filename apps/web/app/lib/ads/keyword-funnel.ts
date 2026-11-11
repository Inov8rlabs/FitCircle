/**
 * Keyword funnel (docs/ADS_METRICS_METHODOLOGY.md §10): spend → taps →
 * installs → sign-ups → paywall → trials → payers → net revenue for every
 * keyword / ad group of one channel. Pure: reuses report.ts buildRows /
 * buildTotals (same delivery, attribution, outcome and test-user rules as the
 * overview), and only adds the paywall step and the low-sample / flag verdicts.
 *
 * Rows always add up to the channel's campaign-level total: delivery and users
 * not tied to one keyword (Apple Search Match, no-consent installs, an
 * attribution without a keyword id) land in an explicit "unattributed" row.
 */
import { ratio, type CohortUser } from './metrics';
import { buildRows, buildTotals, effectiveAttribution, type SliceInput, userKey } from './report';
import type { AdChannel, AdsMetrics, AdsRow, FunnelLevel, FunnelMetrics, FunnelReconciliation, FunnelRow } from './types';

/** Rows with fewer attributed sign-ups than this are "too few to judge". */
export const MIN_SIGNUPS_TO_JUDGE = 10;

/** Which breakdowns each channel's attribution supports. Google Ads reports no keyword on an app install. */
export const FUNNEL_LEVELS_BY_CHANNEL: Record<AdChannel, FunnelLevel[]> = {
  apple_ads: ['keyword', 'ad_group'],
  google_ads: ['ad_group'],
  meta: ['ad_group'],
};

export interface FunnelInput extends Omit<SliceInput, 'filter'> {
  channel: AdChannel;
  level: FunnelLevel;
  /** Cohort user ids with profiles.onboarding_paywall_at set. */
  paywallUsers: ReadonlySet<string>;
  minSignUps?: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Spend below this with no sign-ups is rounding residue (campaign vs child rows), not a finding. */
const MIN_FLAG_SPEND = 1;

export function funnelMetrics(m: AdsMetrics, paywall: number, minSignUps = MIN_SIGNUPS_TO_JUDGE): FunnelMetrics {
  const signUps = m.users;
  const flag: FunnelMetrics['flag'] = signUps === 0 ? (m.spend >= MIN_FLAG_SPEND ? 'no_signups' : null) : m.trials === 0 ? 'no_trials' : null;
  return {
    spend: m.spend,
    currency: m.currency,
    mixedCurrency: m.mixedCurrency,
    impressions: m.impressions,
    taps: m.taps,
    installs: m.installs,
    signUps,
    paywall,
    trials: m.trials,
    payers: m.payers,
    revenue: m.revenueToDate,
    cpt: m.cpt,
    cpi: m.cpi,
    costPerSignUp: m.costPerUser,
    costPerTrial: m.costPerTrial,
    costPerPayer: m.costPerPayer,
    signUpToPaywall: ratio(paywall, signUps),
    signUpToTrial: ratio(m.trials, signUps),
    roas: m.roasToDate,
    lowSample: signUps < minSignUps,
    flag,
  };
}

const inChannel = (u: CohortUser, channel: AdChannel) => (effectiveAttribution(u)?.channel ?? 'unknown') === channel;

function toRow(r: AdsRow, level: FunnelLevel, paywall: number, minSignUps: number): FunnelRow {
  const unattributed = r.key.endsWith(':none');
  const e = r.entity;
  const unknownEntity = !unattributed && !e && r.metrics.spend === 0 && r.metrics.taps === 0;
  const metrics = funnelMetrics(r.metrics, paywall, minSignUps);
  // Sign-ups with no (or only rounding-residue) spend of their own: a cost per sign-up of $0.00 would be a lie.
  if ((unattributed || unknownEntity) && metrics.spend < MIN_FLAG_SPEND) {
    metrics.costPerSignUp = null;
    metrics.costPerTrial = null;
    metrics.costPerPayer = null;
    metrics.roas = null;
  }
  return {
    key: r.key,
    label: unattributed ? (level === 'keyword' ? 'Unattributed (no keyword)' : 'Unattributed (no ad group)') : r.label,
    sublabel: unattributed
      ? level === 'keyword'
        ? 'Search Match, no-consent installs and sign-ups whose attribution has no keyword id'
        : 'Delivery and sign-ups whose attribution has no ad group id'
      : r.sublabel,
    level: unattributed ? null : level,
    externalId: r.externalId,
    campaignExternalId: r.campaignExternalId,
    adGroupExternalId: level === 'keyword' ? (e?.parentExternalId ?? null) : null,
    unattributed,
    unknownEntity,
    matchType: e?.matchType ?? null,
    status: e?.servingStatus || e?.status || null,
    bidAmount: e?.bidAmount ?? null,
    bidCurrency: e?.bidCurrency ?? null,
    metrics,
  };
}

const FIELDS: FunnelReconciliation['field'][] = ['spend', 'taps', 'installs', 'signUps', 'paywall', 'trials', 'payers', 'revenue'];

/** Known, explained reasons a field cannot add up at a level (shown next to the mismatch, never hidden). */
const KNOWN_GAPS: Partial<Record<AdChannel, Partial<Record<FunnelLevel, Partial<Record<FunnelReconciliation['field'], string>>>>>> = {
  google_ads: {
    ad_group: {
      installs:
        'Google Ads does not allow the app-install column on ad-group rows, so ad groups report conversions instead; the campaign total uses app installs.',
    },
  },
};

export function reconcile(rows: FunnelRow[], totals: FunnelRow, channel?: AdChannel, level?: FunnelLevel): FunnelReconciliation[] {
  return FIELDS.map((field) => {
    const sum = round2(rows.reduce((s, r) => s + (r.metrics[field] as number), 0));
    const campaign = round2(totals.metrics[field] as number);
    const ok = Math.abs(sum - campaign) < 0.005;
    const note = ok || !channel || !level ? null : (KNOWN_GAPS[channel]?.[level]?.[field] ?? null);
    return { field, rows: sum, campaign, ok, note };
  });
}

/** Rows (keyword / ad group, unattributed row last), the channel total and the reconciliation between them. */
export interface KeywordFunnelResult {
  rows: FunnelRow[];
  totals: FunnelRow;
  reconciliation: FunnelReconciliation[];
  /** Sign-ups whose attribution names a keyword / ad group the synced account does not have (no spend to pair with). */
  unknownEntitySignUps: number;
}

export function buildKeywordFunnel(input: FunnelInput): KeywordFunnelResult {
  const minSignUps = input.minSignUps ?? MIN_SIGNUPS_TO_JUDGE;
  const slice: SliceInput = { ...input, filter: { channel: input.channel } };
  const users = input.cohort.filter((u) => inChannel(u, input.channel));

  const paywallBy = new Map<string, number>();
  let paywallTotal = 0;
  for (const u of users) {
    if (!input.paywallUsers.has(u.userId)) continue;
    paywallTotal += 1;
    const k = userKey(u, input.level);
    paywallBy.set(k, (paywallBy.get(k) ?? 0) + 1);
  }

  const rows = buildRows(input.level, slice)
    .map((r) => toRow(r, input.level, paywallBy.get(r.key) ?? 0, minSignUps))
    .sort(
      (a, b) =>
        Number(a.unattributed) - Number(b.unattributed) ||
        b.metrics.spend - a.metrics.spend ||
        b.metrics.signUps - a.metrics.signUps ||
        a.label.localeCompare(b.label)
    );

  const t = buildTotals(slice);
  const totals: FunnelRow = {
    key: `${input.channel}:total`,
    label: 'Total',
    sublabel: 'Campaign level, same as the overview',
    level: null,
    externalId: null,
    campaignExternalId: null,
    adGroupExternalId: null,
    unattributed: false,
    unknownEntity: false,
    matchType: null,
    status: null,
    bidAmount: null,
    bidCurrency: null,
    metrics: funnelMetrics(t.metrics, paywallTotal, minSignUps),
  };
  const unknownEntitySignUps = rows.filter((r) => r.unknownEntity).reduce((n, r) => n + r.metrics.signUps, 0);
  return { rows, totals, reconciliation: reconcile(rows, totals, input.channel, input.level), unknownEntitySignUps };
}
