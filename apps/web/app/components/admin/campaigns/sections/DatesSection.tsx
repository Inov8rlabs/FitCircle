'use client';

import { AlertTriangle, CheckCircle2 } from 'lucide-react';

import { APP_STORE_LIMITS, addDays, appStoreRules, dateRange, diffDays, isYmd, resizeDoors, shortDate, spanDays } from '@/lib/campaigns/campaign-utils';
import type { CampaignInput } from '@/lib/campaigns/types';
import { cn } from '@/lib/utils';

import type { EditorApi } from '../editor-api';
import { Section, TextField } from '../fields';

/** Applies a date change and keeps dependent fields (doors, circle dates) in step. */
export function withDates(d: CampaignInput, patch: Partial<Pick<CampaignInput, 'featuredFrom' | 'startsAt' | 'endsAt'>>): CampaignInput {
  const next = { ...d, ...patch };
  if (next.circle && (d.circle?.startDate === d.startsAt || !d.circle?.startDate) && (d.circle?.endDate === d.endsAt || !d.circle?.endDate)) {
    next.circle = { ...next.circle, startDate: next.startsAt, endDate: next.endsAt };
  }
  if (next.template === 'daily_calendar' && isYmd(next.startsAt) && isYmd(next.endsAt)) {
    next.calendar = { doors: resizeDoors(Math.min(62, spanDays(next.startsAt, next.endsAt)), d.calendar?.doors ?? []) };
  }
  return next;
}

export function DatesSection({ api }: { api: EditorApi }) {
  const { draft, set } = api;
  const rules = appStoreRules(draft);
  const days = spanDays(draft.startsAt, draft.endsAt);
  const order = isYmd(draft.startsAt) && isYmd(draft.endsAt) && draft.startsAt <= draft.endsAt;
  const featuredOk = !draft.featuredFrom || draft.featuredFrom <= draft.startsAt;

  // Timeline proportions
  const tlStart = draft.featuredFrom && isYmd(draft.featuredFrom) ? draft.featuredFrom : draft.startsAt;
  const tlEnd = isYmd(draft.endsAt) ? addDays(draft.endsAt, 2) : draft.endsAt;
  const total = Math.max(1, diffDays(tlStart, tlEnd) + 1);
  const pct = (d: string) => `${Math.min(100, Math.max(0, (diffDays(tlStart, d) / total) * 100))}%`;

  return (
    <Section id="dates" index={2} title="Dates" description="Calendar days in each viewer's local time.">
      <div className="grid gap-4 sm:grid-cols-3">
        <TextField
          label="Featured from"
          type="date"
          value={draft.featuredFrom}
          hint="Teaser starts showing"
          error={featuredOk ? null : 'Must be on or before the start'}
          onChange={(featuredFrom) => set((d) => withDates(d, { featuredFrom }))}
        />
        <TextField label="Starts" type="date" value={draft.startsAt} onChange={(startsAt) => set((d) => withDates(d, { startsAt }))} />
        <TextField
          label="Ends"
          type="date"
          value={draft.endsAt}
          error={order ? null : 'Must be on or after the start'}
          onChange={(endsAt) => set((d) => withDates(d, { endsAt }))}
        />
      </div>

      {order && (
        <div>
          <div className="relative h-9 overflow-hidden rounded-lg bg-slate-950/60 ring-1 ring-slate-800">
            {draft.featuredFrom && draft.featuredFrom < draft.startsAt && (
              <div className="absolute inset-y-0 bg-sky-500/20" style={{ left: pct(draft.featuredFrom), width: `calc(${pct(draft.startsAt)} - ${pct(draft.featuredFrom)})` }}>
                <span className="absolute left-2 top-1/2 -translate-y-1/2 whitespace-nowrap text-[11px] text-sky-200">Teaser</span>
              </div>
            )}
            <div className="absolute inset-y-0 bg-gradient-to-r from-purple-500/50 to-fuchsia-500/50" style={{ left: pct(draft.startsAt), width: `calc(${pct(addDays(draft.endsAt, 1))} - ${pct(draft.startsAt)})` }}>
              <span className="absolute left-2 top-1/2 -translate-y-1/2 whitespace-nowrap text-[11px] font-semibold text-white">Live · {days} days</span>
            </div>
            <div className="absolute inset-y-0 bg-amber-500/15" style={{ left: pct(addDays(draft.endsAt, 1)), right: 0 }}>
              <span className="absolute left-1 top-1/2 -translate-y-1/2 whitespace-nowrap text-[10px] text-amber-200/80">Wrap</span>
            </div>
            {rules.promoStart && (
              <div className="absolute inset-y-0 w-0.5 bg-white/70" style={{ left: pct(rules.promoStart) }} title={`App Store promo starts ${shortDate(rules.promoStart)}`} />
            )}
          </div>
          <div className="mt-1 flex justify-between text-[11px] text-slate-500">
            <span>{shortDate(tlStart)}</span>
            <span>{dateRange(draft.startsAt, draft.endsAt)}</span>
            <span>{shortDate(tlEnd)}</span>
          </div>
        </div>
      )}

      <div className="grid gap-2 sm:grid-cols-2">
        <Rule ok={rules.durationOk} title={`App Store event ≤ ${APP_STORE_LIMITS.maxEventDays} days`}>
          {rules.eventDays} {rules.eventDays === 1 ? 'day' : 'days'}
          {!rules.durationOk && rules.eventDays > APP_STORE_LIMITS.maxEventDays && ' · shorten it or skip the App Store event'}
        </Rule>
        <Rule ok={!rules.promoCapped} warnOnly title={`Promotion ≤ ${APP_STORE_LIMITS.maxPromoDays} days before start`}>
          {rules.promoStart
            ? rules.promoCapped
              ? `In-app teaser from ${shortDate(draft.featuredFrom)}; App Store promo capped to ${shortDate(rules.promoStart)}`
              : `App Store promo from ${shortDate(rules.promoStart)} (${rules.promoDays} days)`
            : 'Set a start date'}
        </Rule>
      </div>
      {draft.template === 'daily_calendar' && days > 0 && (
        <p className="text-xs text-slate-500">
          {days} doors · the doors editor resizes automatically{days > 62 ? ' (max 62)' : ''}.
        </p>
      )}
    </Section>
  );
}

function Rule({ ok, warnOnly, title, children }: { ok: boolean; warnOnly?: boolean; title: string; children: React.ReactNode }) {
  return (
    <div className={cn('flex items-start gap-2.5 rounded-xl border p-3', ok ? 'border-emerald-500/20 bg-emerald-500/5' : warnOnly ? 'border-sky-500/20 bg-sky-500/5' : 'border-amber-500/30 bg-amber-500/10')}>
      {ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" /> : <AlertTriangle className={cn('mt-0.5 h-4 w-4 shrink-0', warnOnly ? 'text-sky-300' : 'text-amber-300')} />}
      <div>
        <p className="text-sm font-medium text-white">{title}</p>
        <p className="text-xs text-slate-400">{children}</p>
      </div>
    </div>
  );
}
