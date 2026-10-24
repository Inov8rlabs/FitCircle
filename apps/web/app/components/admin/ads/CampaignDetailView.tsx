'use client';

import { ImageOff, Lock, Pause, Play } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { Btn } from '@/components/admin/campaigns/fields';
import { adsAdmin } from '@/lib/ads/admin-client';
import { CHANNEL_LABEL, type AdsMetrics, type AdsTargets, type AdsTimeseries, type CampaignDetail, type CampaignDetailEntity } from '@/lib/ads/types';
import { cn } from '@/lib/utils';

import { METRIC_COLS, MetricCells, MetricHeaders } from './BreakdownTable';
import { ChangeSheet, EditableMoney, type EditTarget } from './ChangeSheet';
import { count, dateTime, money, strategyLabel } from './format';
import { KpiTiles } from './KpiTiles';
import { AdsHeader, DateRangePicker, EntityStatus, ErrorBox, errorText, Panel, Spinner, SyncBar, useRangeParam } from './parts';
import { TimeseriesCharts } from './TimeseriesCharts';

const SUB_COLS = METRIC_COLS.filter((c) => ['spend', 'taps', 'installs', 'cpi', 'users', 'activated', 'payers', 'costPerPayer', 'revenueToDate', 'roasD7', 'roasToDate'].includes(c.key));

const PAUSED = new Set(['PAUSED']);

function StatusToggle({ e, onEdit }: { e: CampaignDetailEntity; onEdit: (t: EditTarget) => void }) {
  const paused = PAUSED.has((e.status ?? '').toUpperCase());
  const enableValue = e.channel === 'apple_ads' ? (e.level === 'keyword' ? 'ACTIVE' : 'ENABLED') : 'ACTIVE';
  if (!e.editability.status.editable) {
    return (
      <span className="inline-flex cursor-help text-slate-600" title={e.editability.status.reason ?? 'Read-only'}>
        <Lock className="h-3 w-3" aria-hidden />
        <span className="sr-only">{e.editability.status.reason}</span>
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={() => onEdit({ entity: e, field: 'status', value: paused ? enableValue : 'PAUSED' })}
      className="rounded-md p-1 text-slate-400 hover:bg-slate-800 hover:text-white"
      aria-label={paused ? `Enable ${e.name}` : `Pause ${e.name}`}
      title={paused ? 'Enable' : 'Pause'}
    >
      {paused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
    </button>
  );
}

function Fact({ label, children, wide }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className={cn('min-w-0', wide && 'col-span-2')}>
      <dt className="text-[11px] font-medium uppercase tracking-wider text-slate-500">{label}</dt>
      <dd className="mt-0.5 truncate text-sm text-slate-200">{children}</dd>
    </div>
  );
}

/** Why a value is read-only (the global "enable writes" banner covers that case once). */
function Reason({ text }: { text: string | null }) {
  return text && !text.startsWith('Read-only') ? <p className="mt-1 text-[11px] text-slate-500">{text}</p> : null;
}

function EntityTable({
  title,
  description,
  rows,
  targets,
  kind,
  onEdit,
  unplaced,
  unplacedLabel,
}: {
  title: string;
  description?: string;
  rows: CampaignDetailEntity[];
  targets: AdsTargets;
  kind: 'ad_group' | 'keyword';
  onEdit: (t: EditTarget) => void;
  unplaced?: AdsMetrics | null;
  unplacedLabel?: string;
}) {
  return (
    <Panel title={title} description={description}>
      <div className="overflow-x-auto rounded-xl border border-slate-800">
        <table className="w-full min-w-[960px] text-sm">
          <thead className="bg-slate-900/80 text-[11px] uppercase tracking-wider text-slate-400">
            <tr>
              <th scope="col" className="sticky left-0 z-10 bg-slate-900 px-3 py-2 text-left font-medium">
                {kind === 'keyword' ? 'Keyword' : 'Ad group'}
              </th>
              <th scope="col" className="px-3 py-2 text-left font-medium">
                {kind === 'keyword' ? 'Match' : 'Setup'}
              </th>
              <th scope="col" className="px-3 py-2 text-left font-medium">
                {kind === 'keyword' ? 'Bid' : 'Default bid'}
              </th>
              <MetricHeaders cols={SUB_COLS} />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/80">
            {rows.length === 0 && (
              <tr>
                <td colSpan={SUB_COLS.length + 3} className="px-3 py-8 text-center text-slate-400">
                  None synced yet.
                </td>
              </tr>
            )}
            {rows.map((e) => (
              <tr key={e.externalId} className="hover:bg-slate-800/30">
                <th scope="row" className="sticky left-0 z-10 max-w-[260px] bg-slate-950/95 px-3 py-2.5 text-left font-normal">
                  <p className="flex items-center gap-1.5 truncate font-medium text-white">
                    <span className="truncate">{e.name ?? e.externalId}</span>
                    <EntityStatus status={e.status} serving={e.servingStatus} />
                    <StatusToggle e={e} onEdit={onEdit} />
                  </p>
                  <p className="truncate font-mono text-[10px] text-slate-600">#{e.externalId}</p>
                </th>
                <td className="whitespace-nowrap px-3 py-2.5 text-xs text-slate-300">
                  {kind === 'keyword' ? (
                    (e.matchType ?? '—').toLowerCase()
                  ) : (
                    <span className="space-x-2">
                      <span>{strategyLabel(e.bidStrategy)}</span>
                      {typeof e.extra.searchMatch === 'boolean' && <span className="text-slate-500">Search Match {e.extra.searchMatch ? 'on' : 'off'}</span>}
                      {typeof e.extra.pricingModel === 'string' && <span className="text-slate-500">{e.extra.pricingModel}</span>}
                    </span>
                  )}
                </td>
                <td className="whitespace-nowrap px-3 py-2.5 text-sm">
                  <EditableMoney entity={e} field="bid" edit={e.editability.bid} onEdit={onEdit} />
                  {!e.editability.bid.editable && <Reason text={e.editability.bid.reason} />}
                </td>
                <MetricCells m={e.metrics} targets={targets} cols={SUB_COLS} />
              </tr>
            ))}
            {unplaced && unplaced.users > 0 && (
              <tr className="bg-slate-900/30">
                <th scope="row" colSpan={3} className="sticky left-0 px-3 py-2.5 text-left text-xs font-normal italic text-slate-400">
                  {unplacedLabel}
                </th>
                <MetricCells m={unplaced} targets={targets} cols={SUB_COLS} />
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function Creatives({ ads, targets }: { ads: CampaignDetailEntity[]; targets: AdsTargets }) {
  if (!ads.length) {
    return (
      <Panel title="Creatives" description="Custom Product Pages (Apple) / ads (Meta)">
        <p className="text-sm text-slate-400">No ads synced yet.</p>
      </Panel>
    );
  }
  return (
    <Panel title="Creatives" description="Custom Product Pages (Apple) / ads (Meta), with what they brought in">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {ads.map((a) => {
          const cr = a.creative ?? {};
          const m = a.metrics;
          return (
            <article key={a.externalId} className="flex gap-3 rounded-xl border border-hairline bg-slate-950/40 p-3">
              {a.channel === 'meta' ? (
                cr.thumbnailUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- remote Meta CDN thumbnail, not worth next/image config
                  <img src={cr.thumbnailUrl} alt="" className="h-16 w-16 shrink-0 rounded-lg object-cover ring-1 ring-white/10" />
                ) : (
                  <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-lg bg-slate-800 text-slate-500">
                    <ImageOff className="h-5 w-5" />
                  </span>
                )
              ) : (
                <span className="flex h-16 w-12 shrink-0 items-center justify-center rounded-lg bg-gradient-to-b from-purple-500/30 to-fuchsia-500/20 text-[10px] font-semibold text-purple-100 ring-1 ring-white/10">
                  {cr.creativeType === 'DEFAULT_PRODUCT_PAGE' ? 'DPP' : 'CPP'}
                </span>
              )}
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-1.5 truncate text-sm font-medium text-white">
                  <span className="truncate">{a.channel === 'meta' ? (cr.headline ?? a.name) : (cr.productPageName ?? a.name ?? 'Custom product page')}</span>
                  <EntityStatus status={a.status} serving={a.servingStatus} />
                </p>
                <p className="truncate text-[11px] text-slate-500">
                  {a.channel === 'meta' ? (a.name ?? `ad #${a.externalId}`) : cr.productPageId ? `CPP ${cr.productPageId}` : 'Default product page'}
                  {cr.body ? ` · ${cr.body}` : ''}
                </p>
                <dl className="mt-2 grid grid-cols-4 gap-1 text-[11px]">
                  {[
                    ['Spend', money(m.spend)],
                    ['Installs', count(m.installs)],
                    ['Users', count(m.users)],
                    ['Payers', count(m.payers)],
                  ].map(([k, v]) => (
                    <div key={k}>
                      <dt className="text-slate-500">{k}</dt>
                      <dd className="tabular-nums text-slate-200">{v}</dd>
                    </div>
                  ))}
                </dl>
                <p className="mt-1 text-[11px] text-slate-500">
                  CAC <span className={cn('tabular-nums', m.costPerPayer !== null && m.costPerPayer <= targets.costPerPayerMax ? 'text-emerald-300' : 'text-slate-300')}>{money(m.costPerPayer)}</span> · CPI{' '}
                  <span className="tabular-nums text-slate-300">{money(m.cpi)}</span>
                </p>
              </div>
            </article>
          );
        })}
      </div>
    </Panel>
  );
}

export function CampaignDetailView({ channel, externalId }: { channel: string; externalId: string }) {
  const [range, setRange] = useRangeParam();
  const [data, setData] = useState<CampaignDetail | null>(null);
  const [series, setSeries] = useState<AdsTimeseries | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [edit, setEdit] = useState<EditTarget | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [d, t] = await Promise.all([adsAdmin.campaign(channel, externalId, range.start, range.end), adsAdmin.timeseries(range.start, range.end, channel, externalId)]);
      setData(d);
      setSeries(t);
    } catch (e) {
      setError(errorText(e, 'Could not load this campaign'));
    }
  }, [channel, externalId, range.start, range.end]);

  useEffect(() => {
    void load();
  }, [load]);

  const c = data?.campaign;
  const backHref = `/admin/ads?start=${range.start}&end=${range.end}&groupBy=campaign`;
  const readOnly = data && !data.sync.writeEnabled;
  const serving = useMemo(() => {
    const reasons = c?.extra.servingStateReasons;
    return Array.isArray(reasons) && reasons.length ? reasons.join(', ').replace(/_/g, ' ').toLowerCase() : null;
  }, [c]);

  return (
    <div className="space-y-6 py-6 sm:py-10">
      <AdsHeader
        back={{ href: backHref, label: 'All campaigns' }}
        title={c?.name ?? (error ? 'Campaign' : 'Loading…')}
        subtitle={
          c ? (
            <span className="inline-flex flex-wrap items-center gap-2">
              <span>{CHANNEL_LABEL[c.channel]}</span>·<span className="uppercase">{c.platform}</span>·<span className="font-mono text-xs text-slate-500">#{c.externalId}</span>
              <EntityStatus status={c.status} serving={c.servingStatus} />
            </span>
          ) : null
        }
        actions={data ? <SyncBar status={[data.sync]} onSynced={() => void load()} /> : null}
      />

      <DateRangePicker value={range} onChange={setRange} />

      {error && <ErrorBox message={error} onRetry={() => void load()} />}
      {!data && !error && <Spinner />}

      {data && c && (
        <>
          {readOnly && (
            <div className="flex items-start gap-2 rounded-xl border border-slate-700 bg-slate-900/60 px-3 py-2.5 text-sm text-slate-300">
              <Lock className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
              Read-only: bids and budgets are shown but not editable. Enable writes with {c.channel === 'apple_ads' ? 'APPLE_ADS_WRITE_ENABLED=true (and upgrade the API user to API Account Manager)' : 'META_ADS_WRITE_ENABLED=true'}.
            </div>
          )}

          <Panel title="Setup">
            <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
              <Fact label="Bid strategy">{strategyLabel(c.bidStrategy)}</Fact>
              <Fact label="Daily budget">
                <EditableMoney entity={c} field="daily_budget" edit={c.editability.dailyBudget} onEdit={setEdit} />
              </Fact>
              <Fact label="Total budget">{money(c.totalBudget)}</Fact>
              <Fact label="Dates" wide>
                {c.startAt ? dateTime(c.startAt) : '—'} → {c.endAt ? dateTime(c.endAt) : 'no end'}
              </Fact>
              <Fact label="Countries">{c.countries?.join(', ') || '—'}</Fact>
              <Fact label="Status">
                <span className="inline-flex items-center gap-1.5">
                  {(c.status ?? '—').toLowerCase()}
                  <StatusToggle e={c} onEdit={setEdit} />
                </span>
              </Fact>
              <Fact label="Serving">{(c.servingStatus ?? '—').toLowerCase()}{serving ? ` · ${serving}` : ''}</Fact>
              {typeof c.extra.paymentModel === 'string' && <Fact label="Payment">{c.extra.paymentModel}</Fact>}
              {typeof c.extra.adChannelType === 'string' && <Fact label="Placement">{c.extra.adChannelType.toLowerCase()}</Fact>}
              {typeof c.extra.objective === 'string' && <Fact label="Objective">{c.extra.objective.replace(/_/g, ' ').toLowerCase()}</Fact>}
              <Fact label="Today’s spend">{money(c.todaySpend)}</Fact>
              <Fact label="Synced">{dateTime(c.syncedAt)}</Fact>
            </dl>
            {!c.editability.dailyBudget.editable && <Reason text={c.editability.dailyBudget.reason} />}
          </Panel>

          <KpiTiles m={c.metrics} targets={data.targets} />

          {series && (
            <Panel title="Over time">
              <TimeseriesCharts points={series.points} targets={series.targets} />
            </Panel>
          )}

          <EntityTable title="Ad groups" rows={data.adGroups} targets={data.targets} kind="ad_group" onEdit={setEdit} unplaced={data.unplaced.adGroup} unplacedLabel="Attributed to this campaign, ad group not reported" />
          <EntityTable
            title="Keywords"
            description="Users without a keyword usually came through Search Match or a keyword since removed."
            rows={data.keywords}
            targets={data.targets}
            kind="keyword"
            onEdit={setEdit}
            unplaced={data.unplaced.keyword}
            unplacedLabel="Attributed users without a keyword (Search Match / removed)"
          />
          <Creatives ads={data.ads} targets={data.targets} />

          <div className="flex justify-end">
            <Btn variant="ghost" size="sm" onClick={() => void load()}>
              Refresh
            </Btn>
          </div>
        </>
      )}

      <ChangeSheet target={edit} onClose={() => setEdit(null)} onApplied={() => void load()} />
    </div>
  );
}
