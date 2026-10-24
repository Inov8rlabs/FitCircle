'use client';

import { Info } from 'lucide-react';
import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import { adsAdmin } from '@/lib/ads/admin-client';
import { GROUP_BYS, type AdsOverview, type AdsTimeseries, type GroupBy } from '@/lib/ads/types';

import { BreakdownTable } from './BreakdownTable';
import { KpiTiles } from './KpiTiles';
import { AdsHeader, DateRangePicker, ErrorBox, errorText, Panel, Spinner, SyncBar, useRangeParam } from './parts';
import { TimeseriesCharts } from './TimeseriesCharts';

export function AdsOverviewView() {
  const router = useRouter();
  const pathname = usePathname() ?? '/admin/ads';
  const [range, setRange, params] = useRangeParam();
  const groupParam = params.get('groupBy');
  const groupBy: GroupBy = (GROUP_BYS as string[]).includes(groupParam ?? '') ? (groupParam as GroupBy) : 'channel';
  const [data, setData] = useState<AdsOverview | null>(null);
  const [series, setSeries] = useState<AdsTimeseries | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [o, t] = await Promise.all([adsAdmin.overview(range.start, range.end, groupBy), adsAdmin.timeseries(range.start, range.end)]);
      setData(o);
      setSeries(t);
    } catch (e) {
      setError(errorText(e, 'Could not load the ads overview'));
    } finally {
      setLoading(false);
    }
  }, [range.start, range.end, groupBy]);

  useEffect(() => {
    void load();
  }, [load]);

  const setGroupBy = (g: GroupBy) => {
    const p = new URLSearchParams(params.toString());
    p.set('groupBy', g);
    p.set('start', range.start);
    p.set('end', range.end);
    router.replace(`${pathname}?${p.toString()}`, { scroll: false });
  };

  const noChannels = data && data.lastSync.every((s) => !s.configured);
  const nothingYet = data && data.totals.metrics.spend === 0 && data.totals.metrics.users === 0;

  return (
    <div className="space-y-6 py-6 sm:py-10">
      <AdsHeader
        title="Ads"
        subtitle="Spend from the networks, outcomes from our own data: sign-ups, activation, payers and revenue per channel, campaign, keyword and creative."
        actions={data ? <SyncBar status={data.lastSync} onSynced={() => void load()} /> : null}
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <DateRangePicker value={range} onChange={setRange} />
        {loading && data && <span className="text-xs text-slate-500">Refreshing…</span>}
      </div>

      {error && <ErrorBox message={error} onRetry={() => void load()} />}
      {!data && !error && <Spinner />}

      {data && (
        <>
          {noChannels && (
            <div className="flex items-start gap-2 rounded-xl border border-sky-500/30 bg-sky-500/10 px-3 py-2.5 text-sm text-sky-100">
              <Info className="mt-0.5 h-4 w-4 shrink-0" />
              No ad network is connected yet. Set the APPLE_ADS_* (and META_ADS_*) env vars, then Sync now. Organic and unknown sign-ups still show below.
            </div>
          )}
          {!noChannels && nothingYet && (
            <div className="flex items-start gap-2 rounded-xl border border-slate-700 bg-slate-900/60 px-3 py-2.5 text-sm text-slate-300">
              <Info className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
              No spend or sign-ups in this range yet. A campaign that started today usually reports its first spend within a few hours; cohorts fill in as users sign up, log meals and subscribe.
            </div>
          )}
          {data.testUsers > 0 && (
            <p className="text-xs text-slate-500">
              {data.testUsers} sign-up{data.testUsers === 1 ? '' : 's'} carried Apple’s mock attribution payload (test builds) and count as unknown.
            </p>
          )}

          <KpiTiles m={data.totals.metrics} targets={data.targets} />

          {series && (
            <Panel title="Over time" description={`${data.range.start} → ${data.range.end} · ${data.range.timeZone}`}>
              <TimeseriesCharts points={series.points} targets={series.targets} />
            </Panel>
          )}

          <Panel title="Breakdown" description="Click a campaign, ad group, keyword or ad to open the campaign.">
            <BreakdownTable rows={data.rows} totals={data.totals} targets={data.targets} groupBy={groupBy} onGroupBy={setGroupBy} range={data.range} />
          </Panel>
        </>
      )}
    </div>
  );
}
