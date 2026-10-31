'use client';

import { Smartphone } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { campaignsAdmin, CampaignApiError } from '@/lib/campaigns/admin-client';
import { addDays, diffDays, isYmd, placeholderContext, renderPlaceholders, shortDate, todayYmd } from '@/lib/campaigns/campaign-utils';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/stores/auth-store';

import { AppStoreCardMock, AppStoreDetailsMock, CalendarMock, CirclesMock, EmailPreviewMock, HomeMock, MockLabel, PushBannerMock } from '../DeviceMocks';
import type { EditorApi } from '../editor-api';
import { Btn, Callout, Section, Toggle, inputCls } from '../fields';

export function DateScrubber({ api, compact }: { api: EditorApi; compact?: boolean }) {
  const { draft, previewDate, setPreviewDate, previewView } = api;
  const from = isYmd(draft.featuredFrom) && draft.featuredFrom < draft.startsAt ? addDays(draft.featuredFrom, -1) : addDays(draft.startsAt, -7);
  const to = isYmd(draft.endsAt) ? addDays(draft.endsAt, 3) : addDays(draft.startsAt, 30);
  const span = Math.max(1, diffDays(from, to));
  const value = Math.min(span, Math.max(0, diffDays(from, previewDate)));
  const chips: { label: string; date: string }[] = [
    { label: 'Teaser', date: isYmd(draft.featuredFrom) && draft.featuredFrom < draft.startsAt ? draft.featuredFrom : addDays(draft.startsAt, -1) },
    { label: 'Day 1', date: draft.startsAt },
    { label: 'Mid', date: addDays(draft.startsAt, Math.floor(diffDays(draft.startsAt, draft.endsAt) / 2)) },
    { label: 'Last day', date: draft.endsAt },
    { label: 'Wrap-up', date: addDays(draft.endsAt, 1) },
    { label: 'Today', date: todayYmd() },
  ];
  const phase = previewView.phaseOrHidden;
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold text-white">{shortDate(previewDate)}</p>
        <span
          className={cn(
            'rounded-full px-2 py-0.5 text-[11px] font-semibold',
            phase === 'live' && 'bg-emerald-500/15 text-emerald-300',
            phase === 'teaser' && 'bg-sky-500/15 text-sky-300',
            phase === 'ended' && 'bg-amber-500/15 text-amber-300',
            !phase && 'bg-slate-800 text-slate-400'
          )}
        >
          {phase === 'live' ? `Live · day ${previewView.dayNumber}/${previewView.totalDays}` : phase ?? 'Hidden on this date'}
        </span>
      </div>
      <input
        type="range"
        min={0}
        max={span}
        value={value}
        onChange={(e) => setPreviewDate(addDays(from, Number(e.target.value)))}
        className="w-full accent-purple-500"
        aria-label="Preview date"
      />
      {!compact && (
        <div className="flex flex-wrap gap-1.5">
          {chips.map((c) => (
            <button
              key={c.label}
              type="button"
              onClick={() => setPreviewDate(c.date)}
              className={cn('rounded-full border px-2.5 py-1 text-xs transition', previewDate === c.date ? 'border-purple-400 bg-purple-500/15 text-white' : 'border-slate-700 text-slate-300 hover:border-slate-500')}
            >
              {c.label}
            </button>
          ))}
          {draft.template === 'daily_calendar' && (
            <label className="ml-auto flex items-center gap-2 text-xs text-slate-300">
              <Toggle checked={api.todayOpened} onChange={api.setTodayOpened} label="Today's door opened" /> Today&apos;s door opened
            </label>
          )}
        </div>
      )}
    </div>
  );
}

export function PreviewSection({ api }: { api: EditorApi }) {
  const { draft, previewView, campaign } = api;
  const ctx = placeholderContext(previewView);
  const render = (s: string) => renderPlaceholders(s, ctx);
  const push = draft.notifications.find((n) => n.enabled) ?? draft.notifications[0];
  const email = draft.emails.find((n) => n.enabled) ?? draft.emails[0];
  const card = api.artFor('appStoreCard');
  const details = api.artFor('appStoreDetails');

  return (
    <Section id="preview" index={8} title="Preview" description="Every surface, at any date. Calendar progress is simulated.">
      <DateScrubber api={api} />
      {!previewView.phaseOrHidden && <Callout tone="info">On this date the apps don&apos;t show the campaign at all. Mocks show the nearest phase.</Callout>}

      <PhonePreviewToggle api={api} />

      <div className="grid gap-8 md:grid-cols-2 xl:grid-cols-3">
        <div>
          <MockLabel note={card.uploaded ? undefined : 'generated art'}>App Store event card</MockLabel>
          <AppStoreCardMock art={card.url} appStore={draft.appStore} view={previewView} />
        </div>
        <div>
          <MockLabel note={details.uploaded ? undefined : 'generated art'}>App Store details</MockLabel>
          <AppStoreDetailsMock art={details.url} appStore={draft.appStore} view={previewView} />
        </div>
        <div>
          <MockLabel note={campaign?.art?.inAppHero ? undefined : 'no hero art → gradient fallback'}>Home card</MockLabel>
          <HomeMock view={previewView} />
        </div>
        {draft.template !== 'spotlight' && (
          <div>
            <MockLabel>Circles banner</MockLabel>
            <CirclesMock view={previewView} />
          </div>
        )}
        {draft.template === 'daily_calendar' && (
          <div>
            <MockLabel>Calendar screen</MockLabel>
            <CalendarMock view={previewView} />
          </div>
        )}
        <div>
          <MockLabel>Push banner</MockLabel>
          {push ? <PushBannerMock title={render(push.title)} body={render(push.body)} /> : <p className="text-sm text-slate-500">No push messages.</p>}
        </div>
        <div className="md:col-span-2 xl:col-span-3">
          <MockLabel>Email</MockLabel>
          {email ? <EmailPreviewMock email={email} view={previewView} headerArt={api.artFor('emailHeader').url} render={render} /> : <p className="text-sm text-slate-500">No emails.</p>}
        </div>
      </div>
    </Section>
  );
}

function PhonePreviewToggle({ api }: { api: EditorApi }) {
  const userId = useAuthStore((s) => s.user?.id);
  const [onMyDevices, setOn] = useState<boolean>(() => Boolean(userId && api.campaign?.previewUserIds?.includes(userId)));
  const [asOf, setAsOf] = useState<string>('');
  const [busy, setBusy] = useState(false);

  const apply = async (next: { onMyDevices: boolean; asOf: string }) => {
    const c = await api.ensureSaved();
    if (!c) return;
    setBusy(true);
    try {
      await campaignsAdmin.preview(c.id, { onMyDevices: next.onMyDevices, asOf: next.asOf || null });
      setOn(next.onMyDevices);
      setAsOf(next.asOf);
      toast.success(next.onMyDevices ? `Previewing on your phone${next.asOf ? ` as of ${shortDate(next.asOf)}` : ''}. Pull to refresh the app.` : 'Phone preview off');
      void api.refreshServer();
    } catch (e) {
      toast.error(e instanceof CampaignApiError ? e.message : 'Could not update the phone preview');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-800 bg-slate-950/40 p-3">
      <Smartphone className="h-5 w-5 text-purple-300" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-white">Preview on my phone</p>
        <p className="text-xs text-slate-400">Shows this campaign (even as a draft) in the apps signed in as you, optionally as of a date.</p>
      </div>
      <input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} className={cn(inputCls, 'h-8 w-auto text-xs')} aria-label="Preview as of" />
      <Btn size="sm" variant="ghost" onClick={() => setAsOf(api.previewDate)}>
        Use scrubber date
      </Btn>
      <Btn size="sm" variant={onMyDevices ? 'success' : 'secondary'} loading={busy} onClick={() => void apply({ onMyDevices: !onMyDevices, asOf })}>
        {onMyDevices ? 'On · turn off' : 'Turn on'}
      </Btn>
      {onMyDevices && (
        <Btn size="sm" variant="ghost" loading={busy} onClick={() => void apply({ onMyDevices: true, asOf })}>
          Update date
        </Btn>
      )}
    </div>
  );
}
