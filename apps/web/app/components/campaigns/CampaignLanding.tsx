'use client';

import { motion } from 'framer-motion';
import { ArrowRight, CalendarDays, Check, Globe, Users } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';

import { AnalyticsEvents, analytics } from '@/lib/analytics';
import { dateRange, spanDays } from '@/lib/campaigns/campaign-utils';
import type { PublicCampaign } from '@/lib/campaigns/server';
import { playStoreUrl } from '@/lib/referrals/links';
import { detectPlatform, openInAppUrl, type InvitePlatform } from '@/lib/referrals/web';

import { CampaignHero, paletteBackdrop } from './CampaignHero';

interface CampaignLandingProps {
  campaign: PublicCampaign;
  initialPlatform: InvitePlatform;
  appStoreUrl: string;
  playStoreLive: boolean;
}

/** Signed-out marketing landing for /c/{slug}. */
export function CampaignLanding({ campaign: c, initialPlatform, appStoreUrl, playStoreLive }: CampaignLandingProps) {
  const [platform, setPlatform] = useState<InvitePlatform>(initialPlatform);
  useEffect(() => {
    setPlatform(detectPlatform(navigator.userAgent, { maxTouchPoints: navigator.maxTouchPoints }));
  }, []);

  const pageUrl = `https://www.fitcircle.ai/c/${c.slug}`;
  const playUrl = playStoreUrl({});
  const openApp = platform === 'desktop' ? null : openInAppUrl(platform, pageUrl, playUrl);
  const days = spanDays(c.startsAt, c.endsAt);
  const isCalendar = c.template === 'daily_calendar';
  const returnUrl = encodeURIComponent(`/c/${c.slug}`);

  const steps = isCalendar
    ? [
        { icon: CalendarDays, title: `${days} doors, one a day`, body: 'Each door hides a small, doable healthy challenge.' },
        { icon: Check, title: 'Check in to open it', body: 'Log a meal or keep your streak and today’s door opens.' },
        { icon: Users, title: 'Do it with friends', body: 'See who opened today’s door and cheer each other on.' },
      ]
    : [
        { icon: Users, title: 'Start a circle', body: 'Invite friends and set off together.' },
        { icon: Check, title: 'Check in every day', body: 'A meal, a workout or your steps. Anything counts.' },
        { icon: CalendarDays, title: `${days} days, together`, body: 'Keep each other honest all the way to the finish.' },
      ];

  return (
    <div className="relative min-h-screen overflow-x-hidden bg-slate-950" style={{ background: paletteBackdrop(c.palette) }}>
      <header className="relative mx-auto flex max-w-3xl items-center justify-between px-4 pt-6">
        <Link href="/" className="flex items-center gap-2 text-white">
          <span className="inline-block h-6 w-6 rounded-full border-[5px] border-purple-400" aria-hidden />
          <span className="text-lg font-bold tracking-tight">FitCircle</span>
        </Link>
        <Link href={`/login?returnUrl=${returnUrl}`} className="text-sm font-medium text-slate-300 hover:text-white">
          Log in
        </Link>
      </header>

      <main className="relative mx-auto max-w-3xl px-4 pb-16 pt-6 sm:pt-10">
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
          <CampaignHero
            art={c.art.appStoreCard ?? c.art.inAppHero}
            palette={c.palette}
            emoji={c.emoji}
            title={c.title}
            className="aspect-[16/9] w-full rounded-3xl shadow-2xl shadow-black/40 ring-1 ring-white/10"
            size="lg"
          />
          <div className="mt-8 text-center">
            <p className="text-xs font-semibold uppercase tracking-[0.22em]" style={{ color: c.accent }}>
              {dateRange(c.startsAt, c.endsAt)}
            </p>
            <h1 className="mt-2 text-4xl font-extrabold tracking-tight text-white sm:text-5xl">
              {c.title} <span aria-hidden>{c.emoji}</span>
            </h1>
            <p className="mx-auto mt-3 max-w-xl text-lg text-slate-200">{c.tagline}</p>
            {c.description && <p className="mx-auto mt-3 max-w-xl text-sm text-slate-400">{c.description}</p>}
          </div>
        </motion.div>

        <div className="mx-auto mt-8 max-w-md space-y-3">
          {(platform === 'ios' || platform === 'desktop') && (
            <StoreButton
              href={appStoreUrl}
              eyebrow="Get FitCircle on the"
              label="App Store"
              glyph={<AppleGlyph />}
              primary={platform === 'ios'}
              onClick={() => analytics.track(AnalyticsEvents.appStoreLinkClicked({ store: 'app_store', placement: 'campaign_landing' }))}
            />
          )}
          {(platform === 'android' || platform === 'desktop') && (
            <StoreButton
              href={playStoreLive ? playUrl : ''}
              eyebrow="Get FitCircle on"
              label="Google Play"
              glyph={<PlayGlyph />}
              primary={platform === 'android'}
              onClick={() => analytics.track(AnalyticsEvents.appStoreLinkClicked({ store: 'play_store', placement: 'campaign_landing' }))}
            />
          )}
          {openApp && (
            <p className="text-center text-sm text-slate-400">
              Already have the app?{' '}
              <a href={openApp} className="font-medium text-purple-300 hover:underline">
                Open in FitCircle
              </a>
            </p>
          )}
          <Link
            href={`/register?returnUrl=${returnUrl}`}
            className="flex w-full items-center justify-center gap-2 rounded-2xl border border-white/15 bg-slate-950/60 px-5 py-4 font-medium text-slate-100 transition-colors hover:border-purple-400/60"
          >
            <Globe className="h-5 w-5 text-purple-300" /> Join on the web <ArrowRight className="h-4 w-4" />
          </Link>
        </div>

        <section className="mt-12" aria-labelledby="how">
          <h2 id="how" className="text-center text-sm font-semibold uppercase tracking-wider text-slate-400">
            How it works
          </h2>
          <ol className="mt-5 grid gap-3 sm:grid-cols-3">
            {steps.map((s, i) => (
              <li key={s.title} className="rounded-2xl border border-white/10 bg-slate-950/50 p-4 backdrop-blur">
                <div className="flex items-center gap-2 text-white">
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-white/10 text-xs font-bold">{i + 1}</span>
                  <s.icon className="h-4 w-4" style={{ color: c.accent }} aria-hidden />
                </div>
                <p className="mt-3 font-semibold text-white">{s.title}</p>
                <p className="mt-1 text-sm text-slate-400">{s.body}</p>
              </li>
            ))}
          </ol>
        </section>
      </main>
    </div>
  );
}

function StoreButton(props: { href: string; eyebrow: string; label: string; glyph: React.ReactNode; primary: boolean; onClick: () => void }) {
  const cls = `relative flex w-full items-center justify-center gap-3 rounded-2xl px-5 py-4 transition-colors ${
    props.primary ? 'bg-gradient-to-r from-purple-600 to-pink-600 shadow-lg shadow-purple-900/40' : 'border border-white/15 bg-black hover:border-purple-400'
  }`;
  const text = (
    <span className="flex flex-col text-left leading-tight">
      <span className="text-xs text-white/70">{props.href ? props.eyebrow : 'Coming soon to'}</span>
      <span className="text-lg font-semibold text-white">{props.label}</span>
    </span>
  );
  if (!props.href) {
    return (
      <div aria-disabled className={`${cls} opacity-60`}>
        {props.glyph}
        {text}
      </div>
    );
  }
  return (
    <a href={props.href} onClick={props.onClick} className={cls}>
      {props.glyph}
      {text}
    </a>
  );
}

function AppleGlyph() {
  return (
    <svg className="h-7 w-7 text-white" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z" />
    </svg>
  );
}

function PlayGlyph() {
  return (
    <svg className="h-7 w-7" viewBox="0 0 24 24" aria-hidden>
      <path fill="#34A853" d="M3.6 2.4 13.2 12l-9.6 9.6c-.37-.2-.6-.6-.6-1.05V3.45c0-.45.23-.85.6-1.05z" />
      <path fill="#4285F4" d="M16.4 8.8 13.2 12l-9.6-9.6c.14-.08.3-.13.46-.15L16.4 8.8z" />
      <path fill="#FBBC04" d="M20.4 10.9c.6.35.6 1.85 0 2.2l-4 2.3-3.2-3.4 3.2-3.2 4 2.1z" />
      <path fill="#EA4335" d="m16.4 15.4-12.34 6.55c-.16-.02-.32-.07-.46-.15l9.6-9.6 3.2 3.2z" />
    </svg>
  );
}
