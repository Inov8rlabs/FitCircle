'use client';

import type { AdsMetrics, AdsTargets } from '@/lib/ads/types';
import { cn } from '@/lib/utils';

import { count, money, pct } from './format';

type Verdict = 'good' | 'bad' | 'neutral';

function Tile({ label, value, sub, verdict = 'neutral', incomplete, target }: { label: string; value: string; sub?: React.ReactNode; verdict?: Verdict; incomplete?: boolean; target?: string }) {
  return (
    <div className={cn('flex min-w-0 flex-col gap-1 rounded-xl border border-hairline bg-slate-900/60 p-3.5', incomplete && 'opacity-60')} title={incomplete ? 'Cohort window still open: this number will grow' : undefined}>
      <p className="flex items-center gap-1.5 truncate text-[11px] font-medium uppercase tracking-wider text-slate-400">
        {label}
        {incomplete && <span className="rounded bg-slate-800 px-1 py-px text-[9px] normal-case tracking-normal text-slate-400">incomplete</span>}
      </p>
      <p className="truncate text-2xl font-bold tabular-nums text-white">{value}</p>
      <div className="flex min-h-[16px] flex-wrap items-center gap-x-2 text-xs text-slate-500">
        {sub}
        {target && (
          <span className={cn('inline-flex items-center gap-1', verdict === 'good' ? 'text-emerald-300' : verdict === 'bad' ? 'text-amber-300' : 'text-slate-500')}>
            {verdict === 'good' ? '✓' : verdict === 'bad' ? '!' : '·'} target {target}
          </span>
        )}
      </div>
    </div>
  );
}

const atMost = (v: number | null, max: number): Verdict => (v === null ? 'neutral' : v <= max ? 'good' : 'bad');
const atLeast = (v: number | null, min: number, incomplete = false): Verdict => (v === null ? 'neutral' : v >= min ? 'good' : incomplete ? 'neutral' : 'bad');

export function KpiTiles({ m, targets }: { m: AdsMetrics; targets: AdsTargets }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      <Tile label="Spend" value={money(m.spend)} sub={<>{count(m.impressions)} impr · {count(m.taps)} taps{m.mixedCurrency ? ' · mixed currency' : ''}</>} />
      <Tile label="Installs" value={count(m.installs)} sub={<>CPI {money(m.cpi)}</>} />
      <Tile label="Users" value={count(m.users)} sub={<>{money(m.costPerUser)} / user · {pct(m.installToUser)} of installs</>} />
      <Tile label="Activated" value={count(m.activated)} sub={<>{money(m.costPerActivated)} each · {pct(m.userToActivated)}</>} incomplete={m.incomplete.activated} />
      <Tile
        label="Payers"
        value={count(m.payers)}
        sub={<>CAC {money(m.costPerPayer)}{m.trials ? ` · ${count(m.trials)} trials` : ''}</>}
        target={`≤ ${money(targets.costPerPayerMax)}`}
        verdict={atMost(m.costPerPayer, targets.costPerPayerMax)}
      />
      <Tile label="Revenue to date" value={money(m.revenueToDate)} sub={<>net of store fees & refunds</>} />
      <Tile label="ROAS D7" value={pct(m.roasD7)} sub={<>{money(m.revenueD7)}</>} target={`≥ ${pct(targets.roasD7Min)}`} verdict={atLeast(m.roasD7, targets.roasD7Min, m.incomplete.d7)} incomplete={m.incomplete.d7} />
      <Tile label="ROAS D30" value={pct(m.roasD30)} sub={<>{money(m.revenueD30)}</>} target={`≥ ${pct(targets.roasD30Min)}`} verdict={atLeast(m.roasD30, targets.roasD30Min, m.incomplete.d30)} incomplete={m.incomplete.d30} />
      <Tile label="ROAS to date" value={pct(m.roasToDate)} sub={<>12-month goal</>} target={`≥ ${pct(targets.roas12mMin)}`} verdict={atLeast(m.roasToDate, targets.roas12mMin, true)} />
      <Tile label="CPT · TTR" value={money(m.cpt)} sub={<>TTR {pct(m.ttr, 1)}</>} />
      <Tile label="User → payer" value={pct(m.userToPayer, 1)} sub={<>{count(m.payers)} of {count(m.users)}</>} />
      <Tile label="Cost / activated" value={money(m.costPerActivated)} sub={<>{count(m.activated)} activated</>} incomplete={m.incomplete.activated} />
    </div>
  );
}
