/**
 * Data health for the ads console overview (docs/ADS_METRICS_METHODOLOGY.md §7).
 * Computed on read from what the overview already loaded — no extra tables.
 * Pure: callers pass `now`. The point is to make wrong numbers visible: stale
 * syncs, spend that doesn't reconcile across levels, attribution gaps, revenue
 * estimated with fallbacks, and mixed currencies.
 */
import { classifyEvent, dedupeEvents, type CohortUser } from './metrics';
import { effectiveAttribution, networkFor } from './report';
import type {
  AdChannel,
  AdConversionRow,
  AdMetricRow,
  AttributionCoverage,
  ChannelAttributionCoverage,
  CurrencyHealth,
  DataHealth,
  HealthCheck,
  HealthStatus,
  RevenueHealth,
  SpendMismatch,
  SpendReconciliation,
  SyncHealth,
} from './types';
import { CHANNEL_LABEL } from './types';

export const STALE_WARN_MINUTES = 120;
export const STALE_ERROR_MINUTES = 26 * 60;
/** Campaign vs ad-group spend may differ by rounding only. */
export const SPEND_TOLERANCE = 0.01;

const PAID = new Set<string>(['apple_ads', 'meta', 'google_ads']);

export const ATTRIBUTION_EXPLANATION =
  'iOS server-side attribution reporting (AdServices token → POST /api/mobile/attribution) ships in the next app release. ' +
  "Until then, Apple Ads users are attributed only through RevenueCat's Apple Search Ads attribution fallback, which fills in " +
  'attribution when a user purchases or starts a trial. Apple Ads sign-ups who never start a trial show as Unknown, so Apple Ads ' +
  'users / activated are understated (cost per user overstated, user→payer overstated); payers and revenue are mostly captured. ' +
  'Installs come from Apple (tap- and view-through, new downloads and redownloads), so not every install becomes a sign-up. ' +
  'Google Ads: most App-campaign installs (Play search, YouTube, Discover, view-through) arrive with an organic Play referrer and are matched by ' +
  'Google through the advertising id (Firebase / GA4), which the install referrer cannot see, so they show as Organic here until the GA4 ' +
  'attribution sync ties them to users (docs/ADS_ATTRIBUTION_GA4.md). Compare with Google-reported sign-ups / installs per channel.';

export interface SyncRunInfo {
  channel: AdChannel;
  configured: boolean;
  /** finished_at of the latest ok run. */
  lastSuccessAt: string | null;
  /** Latest finished run (ok or not). */
  lastFinishedOk: boolean | null;
  lastError: string | null;
}

export interface DataHealthInput {
  now: Date;
  /** ad_metrics_daily rows for the range (all levels). */
  metricRows: AdMetricRow[];
  /** The counted cohort (test users already excluded unless includeTest). */
  cohort: CohortUser[];
  sync: SyncRunInfo[];
  /** Duplicate deliveries the cohort loader already dropped (same event id / same transaction). */
  duplicatesDroppedAtLoad?: number;
  /** ad_conversions_daily rows for the range (network-reported sign-ups / trials). */
  conversionRows?: AdConversionRow[];
}

const rank: Record<HealthStatus, number> = { ok: 0, warn: 1, error: 2 };
export const worst = (...s: HealthStatus[]): HealthStatus => s.reduce((a, b) => (rank[b] > rank[a] ? b : a), 'ok' as HealthStatus);

const cents = (v: unknown) => Math.round((Number(v) || 0) * 100);
const usd = (c: number) => c / 100;
const pct = (n: number, d: number): number | null => (d > 0 ? Math.round((n / d) * 1000) / 10 : null);
const money = (n: number) => `$${n.toFixed(2)}`;

export function syncHealth(runs: SyncRunInfo[], now: Date): SyncHealth[] {
  return runs.map((r) => {
    const at = r.lastSuccessAt ? Date.parse(r.lastSuccessAt) : NaN;
    const ageMinutes = Number.isFinite(at) ? Math.max(0, Math.round((now.getTime() - at) / 60_000)) : null;
    let status: HealthStatus = 'ok';
    if (r.configured) {
      if (ageMinutes === null || ageMinutes > STALE_ERROR_MINUTES) status = 'error';
      else if (ageMinutes > STALE_WARN_MINUTES || r.lastFinishedOk === false) status = 'warn';
    }
    return {
      channel: r.channel,
      configured: r.configured,
      lastSuccessAt: r.lastSuccessAt,
      ageMinutes,
      lastRunFailed: r.lastFinishedOk === false,
      lastError: r.lastFinishedOk === false ? r.lastError : null,
      status,
    };
  });
}

/**
 * Campaign-level spend must equal the sum of ad-group-level spend for the same
 * campaign and day. Keyword rows are NOT compared: Apple's keyword report
 * excludes Search Match spend, so keyword spend is reported as coverage instead.
 */
export function spendReconciliation(rows: AdMetricRow[]): SpendReconciliation {
  const camp = new Map<string, number>();
  const group = new Map<string, number>();
  let appleCampaign = 0;
  let appleKeyword = 0;
  for (const r of rows) {
    const cid = r.level === 'campaign' ? r.external_id : r.campaign_external_id;
    if (!cid) continue;
    const key = `${r.channel}|${cid}|${r.date}`;
    if (r.level === 'campaign') {
      camp.set(key, (camp.get(key) ?? 0) + cents(r.spend));
      if (r.channel === 'apple_ads') appleCampaign += cents(r.spend);
    } else if (r.level === 'ad_group') group.set(key, (group.get(key) ?? 0) + cents(r.spend));
    else if (r.level === 'keyword' && r.channel === 'apple_ads') appleKeyword += cents(r.spend);
  }
  const keys = new Set([...camp.keys(), ...group.keys()]);
  const mismatches: SpendMismatch[] = [];
  let checked = 0;
  let totalAbs = 0;
  let totalSpend = 0;
  for (const key of keys) {
    const c = camp.get(key) ?? 0;
    const g = group.get(key) ?? 0;
    if (c === 0 && g === 0) continue;
    checked += 1;
    totalSpend += c;
    const diff = c - g;
    if (Math.abs(diff) > cents(SPEND_TOLERANCE)) {
      const [channel, campaignExternalId, date] = key.split('|');
      totalAbs += Math.abs(diff);
      mismatches.push({ channel: channel as AdChannel, campaignExternalId, date, campaignSpend: usd(c), adGroupSpend: usd(g), diff: usd(diff) });
    }
  }
  mismatches.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff) || a.date.localeCompare(b.date));
  // error when more than $1 and more than 1% of spend is unreconciled (values in cents)
  const status: HealthStatus = !mismatches.length ? 'ok' : totalAbs > Math.max(100, totalSpend * 0.01) ? 'error' : 'warn';
  return {
    status,
    campaignDays: checked,
    mismatchedCampaignDays: mismatches.length,
    mismatches: mismatches.slice(0, 20),
    totalAbsDiff: usd(totalAbs),
    keywordCoveragePct: pct(appleKeyword, appleCampaign),
    keywordSpend: usd(appleKeyword),
    appleCampaignSpend: usd(appleCampaign),
  };
}

export function attributionCoverage(rows: AdMetricRow[], cohort: CohortUser[], conversionRows: AdConversionRow[] = []): AttributionCoverage {
  let installs = 0;
  const channelInstalls = new Map<AdChannel, number>();
  for (const r of rows) {
    if (r.level !== 'campaign' || !PAID.has(r.channel)) continue;
    installs += Number(r.installs) || 0;
    channelInstalls.set(r.channel, (channelInstalls.get(r.channel) ?? 0) + (Number(r.installs) || 0));
  }
  const bySource: Record<string, number> = {};
  const channelUsers = new Map<AdChannel, number>();
  let users = 0;
  for (const u of cohort) {
    const a = effectiveAttribution(u);
    if (!a || !PAID.has(a.channel)) continue;
    users += 1;
    bySource[a.source || 'unknown'] = (bySource[a.source || 'unknown'] ?? 0) + 1;
    channelUsers.set(a.channel as AdChannel, (channelUsers.get(a.channel as AdChannel) ?? 0) + 1);
  }
  const convByChannel = new Map<AdChannel, AdConversionRow[]>();
  for (const r of conversionRows) if (r.level === 'campaign' && PAID.has(r.channel)) convByChannel.set(r.channel, [...(convByChannel.get(r.channel) ?? []), r]);
  const byChannel: ChannelAttributionCoverage[] = [];
  for (const channel of ['apple_ads', 'meta', 'google_ads'] as AdChannel[]) {
    const inst = channelInstalls.get(channel) ?? 0;
    const attributed = channelUsers.get(channel) ?? 0;
    const net = networkFor(convByChannel.get(channel) ?? []);
    if (!inst && !attributed && net.signUps === null && net.trials === null) continue;
    const bySignUps = net.signUps !== null && net.signUps > 0;
    const basis = bySignUps ? 'sign_ups' : inst > 0 ? 'installs' : null;
    byChannel.push({
      channel,
      installs: inst,
      networkSignUps: net.signUps,
      networkTrials: net.trials,
      attributedUsers: attributed,
      coveragePct: bySignUps ? pct(attributed, net.signUps!) : pct(attributed, inst),
      basis,
    });
  }
  const coveragePct = pct(users, installs);
  const channelLow = byChannel.some((c) => c.coveragePct !== null && c.coveragePct < 50);
  const status: HealthStatus = (installs > 0 && (coveragePct ?? 0) < 50) || channelLow ? 'warn' : 'ok';
  return { status, paidInstalls: installs, attributedPaidUsers: users, coveragePct, bySource, byChannel, explanation: ATTRIBUTION_EXPLANATION };
}

/** One "Data health" line per channel, e.g. "Google Ads: 3 attributed users for 29 Google-reported sign-ups (10.3%)". */
export function channelCoverageLine(c: ChannelAttributionCoverage): string {
  const name = CHANNEL_LABEL[c.channel] ?? c.channel;
  const trials = c.networkTrials !== null ? `; ${c.networkTrials} ${name}-reported trials` : '';
  if (c.basis === 'sign_ups') return `${name}: ${c.attributedUsers} attributed users for ${c.networkSignUps} ${name}-reported sign-ups (${c.coveragePct}%)${trials}`;
  if (c.basis === 'installs') return `${name}: ${c.attributedUsers} attributed users for ${c.installs} installs (${c.coveragePct}%; no sign-up conversion reported)${trials}`;
  return `${name}: ${c.attributedUsers} attributed users, no installs reported${trials}`;
}

export function revenueHealth(cohort: CohortUser[], droppedAtLoad = 0): RevenueHealth {
  let revenueEvents = 0;
  let missingTakehome = 0;
  let fallbackRateUsed = 0;
  let missingPrice = 0;
  let familyShareExcluded = 0;
  let dropped = droppedAtLoad;
  for (const u of cohort) {
    const d = dedupeEvents(u.events);
    dropped += d.dropped;
    for (const e of d.events) {
      const c = classifyEvent(e);
      if (c.excluded === 'family_share') familyShareExcluded += 1;
      if (c.kind === 'none') continue;
      revenueEvents += 1;
      const tk = e.raw?.takehome_percentage;
      if (tk === null || tk === undefined || tk === '') missingTakehome += 1;
      if (c.rateSource === 'fallback') fallbackRateUsed += 1;
      if (c.missingPrice) missingPrice += 1;
    }
  }
  const status: HealthStatus = missingPrice > 0 || fallbackRateUsed > 0 ? 'warn' : 'ok';
  return { status, revenueEvents, missingTakehome, fallbackRateUsed, missingPrice, familyShareExcluded, duplicatesDropped: dropped };
}

export function currencyHealth(rows: AdMetricRow[]): CurrencyHealth {
  const set = new Set<string>();
  for (const r of rows) if (r.level === 'campaign' && cents(r.spend) !== 0) set.add((r.currency || 'USD').toUpperCase());
  const currencies = [...set].sort();
  const mixed = currencies.some((c) => c !== 'USD');
  return { status: mixed ? 'error' : 'ok', mixedCurrency: mixed, currencies };
}

export function buildDataHealth(input: DataHealthInput): DataHealth {
  const sync = syncHealth(input.sync, input.now);
  const spend = spendReconciliation(input.metricRows);
  const attribution = attributionCoverage(input.metricRows, input.cohort, input.conversionRows ?? []);
  const revenue = revenueHealth(input.cohort, input.duplicatesDroppedAtLoad ?? 0);
  const currency = currencyHealth(input.metricRows);

  const syncReasons: string[] = [];
  for (const s of sync) {
    const name = CHANNEL_LABEL[s.channel] ?? s.channel;
    if (!s.configured) {
      syncReasons.push(`${name}: not configured`);
      continue;
    }
    if (s.ageMinutes === null) syncReasons.push(`${name}: never synced successfully`);
    else syncReasons.push(`${name}: last successful sync ${s.ageMinutes < 60 ? `${s.ageMinutes} min` : `${Math.round(s.ageMinutes / 6) / 10} h`} ago${s.ageMinutes > STALE_WARN_MINUTES ? ' (stale)' : ''}`);
    if (s.lastRunFailed) syncReasons.push(`${name}: latest run failed — ${s.lastError ?? 'unknown error'}`);
  }
  const syncStatus = worst(...sync.map((s) => s.status));
  syncReasons.sort((a, b) => Number(/never|stale|failed/.test(b)) - Number(/never|stale|failed/.test(a)));

  const spendReasons = spend.mismatchedCampaignDays
    ? [
        `${spend.mismatchedCampaignDays} of ${spend.campaignDays} campaign-days: campaign spend ≠ Σ ad-group spend (total off by ${money(spend.totalAbsDiff)})`,
        ...spend.mismatches.slice(0, 3).map((m) => `${CHANNEL_LABEL[m.channel]} campaign ${m.campaignExternalId} on ${m.date}: ${money(m.campaignSpend)} vs ${money(m.adGroupSpend)}`),
      ]
    : [`Campaign spend = Σ ad-group spend on all ${spend.campaignDays} campaign-days`];
  if (spend.keywordCoveragePct !== null)
    spendReasons.push(`Apple keyword coverage ${spend.keywordCoveragePct}% of spend (${money(spend.keywordSpend)} of ${money(spend.appleCampaignSpend)}); the rest is Search Match / no keyword`);

  const attrReasons = [
    attribution.coveragePct === null
      ? `No paid installs in range (${attribution.attributedPaidUsers} attributed paid users)`
      : `${attribution.attributedPaidUsers} attributed paid users for ${attribution.paidInstalls} paid installs (${attribution.coveragePct}% coverage)`,
    ...attribution.byChannel.map(channelCoverageLine),
    ...Object.entries(attribution.bySource).map(([src, n]) => `${n} via ${src}`),
    attribution.explanation,
  ];

  const revReasons: string[] = [];
  if (revenue.missingPrice) revReasons.push(`${revenue.missingPrice} revenue event(s) without a USD price counted as $0`);
  if (revenue.fallbackRateUsed) revReasons.push(`${revenue.fallbackRateUsed} event(s) without tax/commission data: store fallback rate (85% / Stripe 97%) applied to the tax-inclusive price`);
  if (revenue.duplicatesDropped) revReasons.push(`${revenue.duplicatesDropped} duplicate event(s) of the same transaction counted once`);
  if (revenue.familyShareExcluded) revReasons.push(`${revenue.familyShareExcluded} Family Sharing event(s) excluded (no revenue)`);
  revReasons.push(`${revenue.revenueEvents} PRODUCTION revenue event(s) for this cohort; ${revenue.missingTakehome} lack takehome_percentage (tax/commission used instead when present)`);

  const checks: HealthCheck[] = [
    { key: 'sync', label: 'Sync freshness', status: syncStatus, reasons: syncReasons },
    { key: 'spend_reconciliation', label: 'Spend reconciliation', status: spend.status, reasons: spendReasons },
    { key: 'attribution', label: 'Attribution coverage', status: attribution.status, reasons: attrReasons },
    { key: 'revenue', label: 'Revenue data', status: revenue.status, reasons: revReasons },
    {
      key: 'currency',
      label: 'Currency',
      status: currency.status,
      reasons: currency.mixedCurrency
        ? [`Spend in ${currency.currencies.join(', ')} is summed as-is (no FX conversion) — totals are wrong`]
        : [`All spend in ${currency.currencies.join(', ') || 'USD'}`],
    },
  ];
  return {
    status: worst(...checks.map((c) => c.status)),
    generatedAt: input.now.toISOString(),
    checks,
    sync,
    spend,
    attribution,
    revenue,
    currency,
  };
}
