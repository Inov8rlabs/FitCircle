/**
 * GET /api/admin/ads/verify: fetch the network's own totals for a range live and
 * compare them with what the console stored (ad_metrics_daily, campaign level).
 * Read-only: never writes to the network or the database.
 */
import { CampaignError } from '@/lib/campaigns/http';

import { reportTimeZone } from '../config';
import { getConnector } from '../connectors';
import type { DeliveryFieldTotals } from '../connectors/types';
import { diffDays } from '../dates';
import type { AdChannel, AdMetricRow, AdsVerifyResult, VerifyCampaignDiff, VerifyField, VerifyFieldDiff } from '../types';

import { AdsReportService, type RangeQuery } from './report-service';
import { AdsSyncService } from './sync-service';

const FIELDS: VerifyField[] = ['spend', 'impressions', 'taps', 'installs'];
/** Networks restate recent days; a diff there is expected until the next sync. */
const RESTATE_DAYS = 3;

const empty = (): DeliveryFieldTotals => ({ spend: 0, currency: null, impressions: 0, taps: 0, installs: 0 });

export function storedTotals(rows: AdMetricRow[], channel: AdChannel): { totals: DeliveryFieldTotals; byCampaign: Map<string, DeliveryFieldTotals> } {
  const totals = empty();
  const byCampaign = new Map<string, DeliveryFieldTotals>();
  const add = (t: DeliveryFieldTotals, r: AdMetricRow) => {
    t.spend = (Math.round(t.spend * 100) + Math.round((Number(r.spend) || 0) * 100)) / 100;
    t.currency = t.currency ?? r.currency ?? null;
    t.impressions += Number(r.impressions) || 0;
    t.taps += Number(r.taps) || 0;
    t.installs += Number(r.installs) || 0;
  };
  for (const r of rows) {
    if (r.channel !== channel || r.level !== 'campaign') continue;
    add(totals, r);
    const c = byCampaign.get(r.external_id) ?? empty();
    add(c, r);
    byCampaign.set(r.external_id, c);
  }
  return { totals, byCampaign };
}

export function diffFields(network: DeliveryFieldTotals, stored: DeliveryFieldTotals): VerifyFieldDiff[] {
  return FIELDS.map((field) => {
    const n = Number(network[field]) || 0;
    const s = Number(stored[field]) || 0;
    const diff = field === 'spend' ? (Math.round(s * 100) - Math.round(n * 100)) / 100 : s - n;
    // Money within a cent; counts exact.
    const ok = field === 'spend' ? Math.abs(diff) <= 0.01 : diff === 0;
    return { field, network: n, stored: s, diff, diffPct: n !== 0 ? Math.round((diff / n) * 10000) / 100 : null, ok };
  });
}

export class AdsVerifyService {
  static async verify(range: RangeQuery, channel: AdChannel): Promise<AdsVerifyResult> {
    if (channel !== 'apple_ads') throw new CampaignError(400, 'VALIDATION_ERROR', 'Live verification is available for apple_ads only');
    const connector = getConnector(channel);
    if (!connector?.isConfigured() || !connector.fetchTotals) throw new CampaignError(409, 'NOT_CONFIGURED', 'Apple Ads is not configured');

    const [network, rows, lastSuccess, networkTz] = await Promise.all([
      connector.fetchTotals(range.start, range.end),
      AdsReportService.loadMetrics(range.start, range.end),
      AdsSyncService.lastSuccess(),
      connector.reportTimeZone ? connector.reportTimeZone().catch(() => null) : Promise.resolve(null),
    ]);
    const stored = storedTotals(rows, channel);
    const totals = diffFields(network.totals, stored.totals);

    const names = new Map(network.campaigns.map((c) => [c.campaignExternalId, c.name]));
    const netBy = new Map(network.campaigns.map((c) => [c.campaignExternalId, c.fields]));
    const ids = new Set([...netBy.keys(), ...stored.byCampaign.keys()]);
    const campaigns: VerifyCampaignDiff[] = [];
    for (const id of ids) {
      const fields = diffFields(netBy.get(id) ?? empty(), stored.byCampaign.get(id) ?? empty());
      if (fields.some((f) => !f.ok)) campaigns.push({ campaignExternalId: id, name: names.get(id) ?? null, fields });
    }
    campaigns.sort((a, b) => Math.abs(b.fields[0].diff) - Math.abs(a.fields[0].diff));

    const consoleTz = reportTimeZone();
    const timeZoneMatches = networkTz ? networkTz === consoleTz : null;
    const ok = totals.every((f) => f.ok);
    const notes: string[] = [];
    if (timeZoneMatches === false) notes.push(`Apple reports days in ${networkTz} but the console cohorts days in ${consoleTz} (ADS_REPORT_TIMEZONE); day boundaries differ.`);
    if (!ok && diffDays(range.end, range.today) < RESTATE_DAYS) notes.push(`The range includes the last ${RESTATE_DAYS} days, which Apple restates; diffs there clear after the next sync (cron every few hours, or "Sync now").`);
    if (!ok && diffDays(range.end, range.today) >= RESTATE_DAYS) notes.push(`Diffs on days older than ${RESTATE_DAYS} days are not restatement: re-run a backfill sync for ${range.start} … ${range.end}.`);
    if (network.totals.currency && network.totals.currency !== 'USD') notes.push(`Apple account currency is ${network.totals.currency}; the console sums spend without FX conversion.`);
    notes.push('Installs compared on Apple totalInstalls (tap- + view-through, new downloads + redownloads), the same field the console stores.');

    return {
      channel,
      range: { start: range.start, end: range.end, timeZone: consoleTz },
      fetchedAt: (range.now ?? new Date()).toISOString(),
      ok,
      totals,
      campaigns: campaigns.slice(0, 50),
      networkTimeZone: networkTz,
      timeZoneMatches,
      lastSyncAt: lastSuccess[channel] ?? null,
      notes,
    };
  }
}

