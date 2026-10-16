'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, CalendarDays, Check, Loader2 } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';

import { Navbar } from '@/components/layout/navbar';
import { AnalyticsEvents, analytics } from '@/lib/analytics';
import { useTrackOnce } from '@/lib/analytics/react';
import { CampaignApiError } from '@/lib/campaigns/admin-client';
import { dateRange, phaseLine } from '@/lib/campaigns/campaign-utils';
import type { PublicCampaign } from '@/lib/campaigns/server';
import type { CampaignView } from '@/lib/campaigns/types';
import { campaignsWeb } from '@/lib/campaigns/web-client';
import { STREAK_AUTO_CLAIMED_EVENT } from '@/lib/streaks/auto-claim-events';

import { CampaignCalendar } from './CampaignCalendar';
import { DoorDetail } from './CampaignCards';
import { CampaignCtaButton } from './CampaignCta';
import { CampaignHero, paletteBackdrop } from './CampaignHero';

interface Props {
  slug: string;
  /** Public read of the campaign, used if the viewer API says it's not visible to this user right now. */
  fallback: PublicCampaign | null;
}

const KNOWN = new Set(['seasonal_circle', 'daily_calendar', 'spotlight']);

/** Signed-in /c/{slug}: the campaign as the viewer sees it (CAMPAIGNS_SPEC §10). */
export function CampaignPageClient({ slug, fallback }: Props) {
  const [view, setView] = useState<CampaignView | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'missing' | 'error'>('loading');
  const [busy, setBusy] = useState(false);
  const [celebrate, setCelebrate] = useState(false);

  const load = useCallback(async () => {
    try {
      const v = await campaignsWeb.get(slug);
      if (!v || !KNOWN.has(v.template)) {
        setState('missing');
        return;
      }
      setView(v);
      setState('ready');
    } catch (e) {
      setState(e instanceof CampaignApiError && e.status === 404 ? 'missing' : 'error');
    }
  }, [slug]);

  useEffect(() => {
    void load();
    const onClaim = () => void load();
    window.addEventListener(STREAK_AUTO_CLAIMED_EVENT, onClaim);
    return () => window.removeEventListener(STREAK_AUTO_CLAIMED_EVENT, onClaim);
  }, [load]);

  useTrackOnce(
    view ? AnalyticsEvents.campaignViewed({ campaign: view.slug, template: view.template, surface: 'web_page', phase: view.phase }) : null,
    Boolean(view),
    view ? `${view.slug}:${view.phase}` : ''
  );

  // Door reveal celebration: once per campaign/day, when today's door is already opened.
  useEffect(() => {
    if (!view?.calendar?.todayOpened || view.phase !== 'live' || !view.dayNumber) return;
    const key = `fc_campaign_door_${view.slug}_${view.dayNumber}`;
    try {
      if (window.localStorage.getItem(key)) return;
      window.localStorage.setItem(key, '1');
    } catch {
      return;
    }
    setCelebrate(true);
    analytics.track(AnalyticsEvents.campaignDoorOpened({ campaign: view.slug, day: view.dayNumber, opened_count: view.calendar.openedCount }));
    void import('canvas-confetti').then(({ default: confetti }) => {
      void confetti({ particleCount: 140, spread: 80, origin: { y: 0.35 }, colors: [...view.palette, '#fbbf24'] });
    });
  }, [view]);

  const setParticipation = async (body: { joined?: boolean; reminders?: boolean }) => {
    if (!view) return;
    const prev = view;
    setView({ ...view, participant: { joined: body.joined ?? (body.reminders ? true : view.participant.joined), reminders: body.reminders ?? view.participant.reminders } });
    setBusy(true);
    try {
      const next = await campaignsWeb.participate(view.slug, body);
      if (body.reminders !== undefined) analytics.track(AnalyticsEvents.campaignRemindersToggled({ campaign: view.slug, enabled: body.reminders }));
      if (!prev.participant.joined && next.participant.joined) {
        analytics.track(AnalyticsEvents.campaignJoined({ campaign: view.slug, template: view.template, reminders: next.participant.reminders }));
      }
      setView(next);
      if (body.reminders) toast.success("We'll nudge you each morning 🔔");
    } catch {
      setView(prev);
      toast.error("Couldn't update that. Try again?");
    } finally {
      setBusy(false);
    }
  };

  const todayDoor = view?.calendar?.doors.find((d) => d.day === view.dayNumber) ?? null;

  return (
    <>
      <Navbar />
      <div className="min-h-screen bg-slate-950" style={view ? { background: paletteBackdrop(view.palette) } : undefined}>
        <div className="mx-auto max-w-3xl px-4 pb-24 pt-6 sm:pt-10">
          <Link href="/dashboard" className="mb-4 inline-flex items-center gap-1.5 text-sm text-slate-400 hover:text-white">
            <ArrowLeft className="h-4 w-4" /> Dashboard
          </Link>

          {state === 'loading' && (
            <div className="flex min-h-[50vh] items-center justify-center text-slate-400">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          )}

          {(state === 'missing' || state === 'error') && <Unavailable fallback={fallback} error={state === 'error'} onRetry={load} />}

          {state === 'ready' && view && (
            <>
              {view.isPreview && (
                <div className="mb-4 rounded-xl border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-sm text-amber-200">
                  Draft preview: only visible to you{view.today ? ` · as of ${view.today}` : ''}
                </div>
              )}
              {view.template === 'daily_calendar' ? (
                <CampaignCalendar view={view} onToggleReminders={(v) => void setParticipation({ reminders: v })} remindersBusy={busy} />
              ) : (
                <CampaignDetail view={view} busy={busy} onJoin={() => void setParticipation({ joined: true })} />
              )}
            </>
          )}
        </div>
      </div>

      <AnimatePresence>
        {celebrate && todayDoor && view && (
          <motion.div
            className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setCelebrate(false)}
          >
            <motion.div
              initial={{ rotateY: -90, scale: 0.8 }}
              animate={{ rotateY: 0, scale: 1 }}
              transition={{ type: 'spring', stiffness: 120, damping: 14 }}
              className="w-full max-w-md"
              onClick={(e) => e.stopPropagation()}
            >
              <p className="mb-3 text-center text-sm font-semibold uppercase tracking-[0.2em] text-amber-300">Door {todayDoor.day} opened!</p>
              <DoorDetail door={todayDoor} />
              <div className="mt-4 flex gap-2">
                <button type="button" onClick={() => setCelebrate(false)} className="flex-1 rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-slate-950">
                  Nice!
                </button>
                <CampaignCtaButton view={view} action="invite" label="Bring a friend along" variant="secondary" className="flex-1" />
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

function CampaignDetail({ view, busy, onJoin }: { view: CampaignView; busy: boolean; onJoin: () => void }) {
  return (
    <div className="space-y-5">
      <CampaignHero art={view.art.inAppHero} palette={view.palette} emoji={view.emoji} title={view.title} className="aspect-[16/9] w-full rounded-3xl ring-1 ring-white/10" size="lg" />
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.2em]" style={{ color: view.accent }}>
          {phaseLine(view)}
        </p>
        <h1 className="mt-1 text-3xl font-extrabold text-white sm:text-4xl">
          {view.title} <span aria-hidden>{view.emoji}</span>
        </h1>
        <p className="mt-2 text-lg text-slate-200">{view.tagline}</p>
        {view.description && <p className="mt-2 text-sm text-slate-400">{view.description}</p>}
      </div>
      {view.circle && (
        <div className="rounded-2xl border border-white/10 bg-slate-900/70 p-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Circle template</p>
          <p className="mt-1 font-semibold text-white">{view.circle.name}</p>
          <p className="mt-1 text-sm text-slate-400">{view.circle.description}</p>
          <p className="mt-2 flex items-center gap-1.5 text-xs text-slate-400">
            <CalendarDays className="h-3.5 w-3.5" /> {dateRange(view.circle.startDate, view.circle.endDate)}
          </p>
        </div>
      )}
      {view.phase !== 'ended' && (
        <div className="flex flex-col gap-2 sm:flex-row">
          <CampaignCtaButton view={view} className="flex-1 py-3" />
          {view.participant.joined ? (
            <span className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl border border-emerald-400/30 bg-emerald-500/10 px-4 py-3 text-sm font-semibold text-emerald-300">
              <Check className="h-4 w-4" /> You&apos;re in
            </span>
          ) : (
            <button
              type="button"
              disabled={busy}
              onClick={onJoin}
              className="flex-1 rounded-xl border border-white/20 bg-white/5 px-4 py-3 text-sm font-semibold text-white hover:bg-white/10 disabled:opacity-50"
            >
              I&apos;m in
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function Unavailable({ fallback, error, onRetry }: { fallback: PublicCampaign | null; error: boolean; onRetry: () => void }) {
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center text-center">
      {fallback ? (
        <CampaignHero art={fallback.art.inAppHero ?? fallback.art.appStoreCard} palette={fallback.palette} emoji={fallback.emoji} className="mb-6 aspect-[16/9] w-full max-w-lg rounded-3xl" />
      ) : (
        <div className="mb-6 text-5xl" aria-hidden>
          🗓️
        </div>
      )}
      <h1 className="text-2xl font-bold text-white">{fallback ? fallback.title : 'Campaign not found'}</h1>
      <p className="mt-2 max-w-md text-slate-400">
        {error
          ? "We couldn't load this right now."
          : fallback
            ? `${dateRange(fallback.startsAt, fallback.endsAt)} · It isn't open yet, or it has wrapped up. Keep an eye on your dashboard.`
            : "This campaign isn't available."}
      </p>
      <div className="mt-6 flex gap-2">
        {error && (
          <button type="button" onClick={onRetry} className="rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-slate-950">
            Try again
          </button>
        )}
        <Link href="/dashboard" className="rounded-xl border border-white/20 px-4 py-2.5 text-sm font-semibold text-white hover:bg-white/10">
          Go to dashboard
        </Link>
      </div>
    </div>
  );
}
