/**
 * Landing page (/): the first page for new web visitors and ad traffic.
 *
 * Server-rendered (fast LCP, no client data fetching). Every visual is a real
 * FitCircle capture (see components/landing/shots.ts). No testimonials,
 * ratings, user counts or invented stats: only product facts.
 *
 * "Get the app" always goes through /get with the landing URL's invite + UTM
 * params, so phones land in the right store with attribution intact.
 */
import {
  BellRing,
  Camera,
  Check,
  ChevronDown,
  Droplet,
  Flame,
  HeartPulse,
  LifeBuoy,
  Mic,
  Search,
  Shield,
  Smartphone,
  Sparkles,
  Users,
  Watch,
} from 'lucide-react';
import type { Metadata } from 'next';
import { headers } from 'next/headers';
import Image from 'next/image';
import Link from 'next/link';

import { AppBanner } from '@/components/app-links/AppBanner';
import { GetAppButton } from '@/components/app-links/GetAppButton';
import { QrCode } from '@/components/app-links/QrCode';
import { StoreBadge } from '@/components/app-links/StoreBadge';
import { FAQ_GROUPS, faqJsonLd } from '@/components/landing/faq';
import { HeroPhones } from '@/components/landing/HeroPhones';
import styles from '@/components/landing/landing.module.css';
import { LandingNav, WebCta } from '@/components/landing/LandingNav';
import { Phone, Tile } from '@/components/landing/Phone';
import { PricingViewTracker } from '@/components/landing/PricingViewTracker';
import { Reveal } from '@/components/landing/Reveal';
import { SHOTS } from '@/components/landing/shots';
import { Logo } from '@/components/ui/logo';
import {
  absoluteGetAppUrl,
  appStoreUrl,
  detectPlatform,
  parseGetAppParams,
  playStoreUrl,
  type GetAppParams,
} from '@/lib/app-links';
import { cn } from '@/lib/utils';

export const dynamic = 'force-dynamic';

const TITLE = 'FitCircle: snap a meal, keep the streak, bring your circle';
const DESCRIPTION =
  'Take a photo of your meal and FitCircle counts the calories and macros. Check in daily with a small circle of friends, and ask Fitzy, a coach that knows your logs. Free on iPhone and Android.';

export const metadata: Metadata = {
  title: { absolute: TITLE },
  description: DESCRIPTION,
  alternates: { canonical: '/' },
  openGraph: {
    type: 'website',
    url: 'https://www.fitcircle.ai/',
    siteName: 'FitCircle',
    title: TITLE,
    description: DESCRIPTION,
    images: [{ url: '/landing/og.jpg', width: 1200, height: 630, alt: 'FitCircle on iPhone: food log, home screen and a circle' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: TITLE,
    description: DESCRIPTION,
    images: ['/landing/og.jpg'],
  },
};

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

// ------------------------------------------------------------------- pieces

function Eyebrow({ icon: Icon, children, tone = 'purple' }: { icon: typeof Camera; children: React.ReactNode; tone?: 'purple' | 'orange' | 'pink' | 'cyan' | 'indigo' | 'green' }) {
  const tones = {
    purple: 'text-brand-purple bg-brand-purple/10 border-brand-purple/25',
    orange: 'text-brand-orange bg-brand-orange/10 border-brand-orange/25',
    pink: 'text-brand-pink bg-brand-pink/10 border-brand-pink/25',
    cyan: 'text-brand-cyan bg-brand-cyan/10 border-brand-cyan/25',
    indigo: 'text-brand-indigo bg-brand-indigo/10 border-brand-indigo/25',
    green: 'text-brand-green bg-brand-green/10 border-brand-green/25',
  };
  return (
    <p className={cn('mb-4 inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-footnote font-semibold', tones[tone])}>
      <Icon className="h-3.5 w-3.5" aria-hidden />
      {children}
    </p>
  );
}

function H2({ children, className }: { children: React.ReactNode; className?: string }) {
  return <h2 className={cn('text-balance text-[32px] font-bold leading-[1.1] tracking-tight text-white sm:text-[44px]', className)}>{children}</h2>;
}

function Lead({ children }: { children: React.ReactNode }) {
  return <p className="mt-4 max-w-xl text-pretty text-body text-fg-secondary sm:text-[19px] sm:leading-[1.5]">{children}</p>;
}

function Points({ items }: { items: { icon: typeof Camera; text: React.ReactNode }[] }) {
  return (
    <ul className="mt-7 space-y-3.5">
      {items.map((it, i) => (
        <li key={i} className="flex items-start gap-3 text-callout text-white/90">
          <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/[0.07] text-white">
            <it.icon className="h-4 w-4" aria-hidden />
          </span>
          <span className="pt-0.5">{it.text}</span>
        </li>
      ))}
    </ul>
  );
}

/** Two-column feature row; visual first on phones, alternating sides on desktop. */
function Feature({
  id,
  flip = false,
  copy,
  visual,
}: {
  id?: string;
  flip?: boolean;
  copy: React.ReactNode;
  visual: React.ReactNode;
}) {
  return (
    <section id={id} className="relative scroll-mt-20 px-4 py-16 sm:px-6 sm:py-24">
      <div className="mx-auto grid max-w-6xl items-center gap-10 md:grid-cols-2 md:gap-16">
        <Reveal className={cn('order-2', flip ? 'md:order-2' : 'md:order-1')}>{copy}</Reveal>
        <Reveal delay={120} className={cn('order-1 flex justify-center', flip ? 'md:order-1' : 'md:order-2')}>
          {visual}
        </Reveal>
      </div>
    </section>
  );
}

function StoreRow({ params, placement, center = false }: { params: Omit<GetAppParams, 'placement'>; placement: string; center?: boolean }) {
  const pt = process.env.NEXT_PUBLIC_ASC_PROVIDER_TOKEN;
  return (
    <div className={cn('flex flex-wrap gap-3', center && 'justify-center')}>
      <StoreBadge store="app_store" placement={placement} href={appStoreUrl({ ...params, placement }, pt)} />
      <StoreBadge store="play_store" placement={placement} href={playStoreUrl({ ...params, placement })} />
    </div>
  );
}


/** lib/config/tier-limits.ts (free) and the live premium feature gates. */
const FREE_PLAN = [
  '5 AI-analyzed meals a day, unlimited manual logging',
  'Daily streaks and streak shields',
  'Create up to 2 circles, join as many as you like',
  'Circle chat and challenges',
  'Fitzy’s daily focus and 5 messages a day',
  'Apple Health and Health Connect sync',
  '14 days of history in trends and insights',
  'Includes ads in the app',
];
const PRO_PLAN = [
  'AI meal logging and Fitzy chat (fair-use limits apply)',
  'Your full history in trends and insights',
  'Create unlimited circles',
  'Unlimited streak shields',
  'Fitzy’s weekly plan and memory',
  'Body composition photo scan, trends and coaching',
  'No ads',
];

// --------------------------------------------------------------------- page

export default async function LandingPage({ searchParams }: Props) {
  const [sp, h] = await Promise.all([searchParams, headers()]);
  const parsed = parseGetAppParams(sp);
  const params: Omit<GetAppParams, 'placement'> = { ref: parsed.ref, circle: parsed.circle, utm: parsed.utm };
  const platform = detectPlatform(h.get('user-agent'));
  const qrValue = absoluteGetAppUrl({ ...params, placement: 'landing_qr' });
  const year = new Date().getFullYear();

  return (
    <div className="min-h-screen overflow-x-clip bg-canvas text-white">
      <script
        type="application/ld+json"
        // Static FAQ copy from components/landing/faq.ts (no user input).
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd()).replace(/</g, '\\u003c') }}
      />
      <AppBanner placement="landing_banner" params={params} initialPlatform={platform} />
      <LandingNav params={params} initialPlatform={platform} />

      <main>
        {/* ------------------------------------------------------------ hero */}
        <section className="relative overflow-hidden px-4 pb-8 pt-7 sm:px-6 sm:pb-20 sm:pt-16" aria-labelledby="hero-title">
          <div aria-hidden className="pointer-events-none absolute inset-0 bg-hero-glow" />
          <div className="relative mx-auto grid max-w-6xl items-center gap-8 lg:grid-cols-[1.05fr_1fr] lg:gap-12">
            <div className="text-center lg:text-left">
              <p className="mb-4 inline-flex items-center gap-2 rounded-full border border-hairline bg-white/5 px-3 py-1.5 text-footnote font-semibold text-fg-secondary sm:mb-5">
                <Smartphone className="h-3.5 w-3.5" aria-hidden /> Free on iPhone &amp; Android
              </p>
              <h1 id="hero-title" className="text-balance text-[40px] font-bold leading-[1.04] tracking-tight sm:text-6xl lg:text-[68px]">
                Snap a meal.
                <br />
                Keep the streak.
                <br />
                <span className="bg-gradient-sunset bg-clip-text text-transparent">Bring your circle.</span>
              </h1>
              <p className="mx-auto mt-4 max-w-xl text-pretty text-[17px] leading-[1.5] text-fg-secondary sm:mt-5 sm:text-[18px] lg:mx-0 lg:text-[20px]">
                Take a photo and FitCircle counts the calories and macros. Check in every day with a few friends who keep you honest, and ask
                Fitzy, a coach that knows your logs.
              </p>

              <div className="mx-auto mt-6 flex max-w-md flex-col gap-3 sm:mt-8 sm:flex-row lg:mx-0">
                <GetAppButton placement="landing_hero" params={params} initialPlatform={platform} label="Get the app" fullWidth className="sm:flex-1" />
                <WebCta />
              </div>

              {/* Desktop: both badges + a QR to send it to the phone. */}
              <div className="mt-8 hidden items-center gap-5 lg:flex">
                <QrCode value={qrValue} size={104} label="QR code: scan with your phone camera to get FitCircle" />
                <div>
                  <p className="mb-3 text-subhead text-fg-secondary">Scan with your phone, or pick your store:</p>
                  <StoreRow params={params} placement="landing_hero" />
                </div>
              </div>

              <ul className="mx-auto mt-5 flex max-w-md flex-wrap justify-center gap-x-5 gap-y-2 text-footnote text-fg-tertiary sm:mt-7 lg:mx-0 lg:justify-start">
                <li className="inline-flex items-center gap-1.5">
                  <HeartPulse className="h-3.5 w-3.5 text-brand-pink" aria-hidden /> Works with Apple Health &amp; Health Connect
                </li>
                <li className="inline-flex items-center gap-1.5">
                  <Check className="h-3.5 w-3.5 text-brand-green" aria-hidden /> No credit card to start
                </li>
              </ul>
            </div>

            <HeroPhones front={SHOTS.streak} left={SHOTS.food} right={SHOTS.circle} />
          </div>
        </section>

        {/* ------------------------------------------------------ value strip */}
        <section aria-label="What FitCircle does" className="border-y border-hairline bg-surface/40 px-4 py-6 sm:px-6">
          <ul className="mx-auto grid max-w-6xl grid-cols-2 gap-4 text-center sm:grid-cols-4">
            {[
              { icon: Camera, label: 'Photo → calories & macros', tone: 'text-brand-pink' },
              { icon: Flame, label: 'Daily streaks with shields', tone: 'text-brand-orange' },
              { icon: Users, label: 'Circles that keep you honest', tone: 'text-brand-indigo' },
              { icon: Sparkles, label: 'Fitzy, your AI coach', tone: 'text-brand-purple' },
            ].map((v) => (
              <li key={v.label} className="flex flex-col items-center gap-2 text-subhead font-medium text-white/90 sm:flex-row sm:justify-center sm:text-left">
                <v.icon className={cn('h-5 w-5 shrink-0', v.tone)} aria-hidden />
                {v.label}
              </li>
            ))}
          </ul>
        </section>

        <div id="features" className="scroll-mt-16" />

        {/* ------------------------------------------------------ food logging */}
        <Feature
          copy={
            <>
              <Eyebrow icon={Camera} tone="pink">
                Photo food logging
              </Eyebrow>
              <H2>Point, shoot, logged.</H2>
              <Lead>
                Snap your plate and FitCircle works out the foods, portions, calories, protein, carbs and fat. Fix anything in a tap, then get on
                with your meal.
              </Lead>
              <Points
                items={[
                  { icon: Camera, text: 'AI nutrition from a single photo' },
                  { icon: Mic, text: 'Or just say what you ate, or type it in' },
                  { icon: Search, text: 'Calories and macros add up through the day' },
                ]}
              />
            </>
          }
          visual={<Phone shot={SHOTS.food} width="clamp(230px, 66vw, 300px)" sizes="(max-width: 768px) 66vw, 300px" />}
        />

        {/* ------------------------------------------------------------ circle */}
        <Feature
          flip
          copy={
            <>
              <Eyebrow icon={Users} tone="indigo">
                Your circle
              </Eyebrow>
              <H2>Friends who notice when you skip.</H2>
              <Lead>
                Start a circle with a few people. Every day it closes when everyone has checked in. Meals, workouts and milestones post to the
                circle chat on their own, so nobody has to ask.
              </Lead>
              <Points
                items={[
                  { icon: Flame, text: 'A shared circle streak, plus your own daily streak' },
                  { icon: BellRing, text: 'Nudge a friend who hasn’t checked in yet' },
                  { icon: LifeBuoy, text: 'Save a friend’s day so the circle streak survives' },
                ]}
              />
            </>
          }
          visual={
            <div className="relative pb-16 sm:pb-10">
              <Phone shot={SHOTS.circle} width="clamp(230px, 66vw, 300px)" sizes="(max-width: 768px) 66vw, 300px" />
              <Tile
                shot={SHOTS.notifNudge}
                sizes="(max-width: 768px) 72vw, 330px"
                className="absolute -right-8 bottom-0 w-[min(72vw,330px)] rounded-[28px] sm:-right-24"
              />
            </div>
          }
        />

        {/* ----------------------------------------------------------- streaks */}
        <Feature
          copy={
            <>
              <Eyebrow icon={Flame} tone="orange">
                Streaks that forgive
              </Eyebrow>
              <H2>One bad day doesn’t erase a good month.</H2>
              <Lead>
                Log a meal, a workout or your weight and today counts. Streak shields cover the day that gets away from you, and your best streak
                is always there to beat. Hit a milestone and your circle hears about it in the chat.
              </Lead>
            </>
          }
          visual={<Phone shot={SHOTS.chat} width="clamp(230px, 66vw, 300px)" sizes="(max-width: 768px) 66vw, 300px" />}
        />

        {/* ------------------------------------------------------------- fitzy */}
        <section className="relative overflow-hidden px-4 py-16 sm:px-6 sm:py-24">
          <div aria-hidden className={cn('pointer-events-none absolute inset-0 opacity-70', styles.glow)} />
          <div className="relative mx-auto max-w-4xl text-center">
            <Reveal>
              <Eyebrow icon={Sparkles} tone="purple">
                Fitzy, your coach
              </Eyebrow>
              <H2 className="mx-auto max-w-3xl">A coach that has actually read your food log.</H2>
              <p className="mx-auto mt-4 max-w-2xl text-pretty text-body text-fg-secondary sm:text-[19px]">
                Ask about last week, tonight’s dinner or a stubborn plateau. Fitzy answers from your own meals and workouts and gives you one
                small focus for today. Pro adds a weekly plan built around you.
              </p>
            </Reveal>
            <Reveal delay={120} className="mx-auto mt-10 max-w-xl text-left">
              <div className="rounded-2xl border border-brand-purple/25 bg-gradient-to-br from-brand-purple/15 via-surface-raised/60 to-brand-pink/10 p-5 shadow-ios-lg backdrop-blur-xl sm:p-6">
                <div className="flex gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-brand shadow-glow-pink">
                    <Sparkles className="h-5 w-5" aria-hidden />
                  </span>
                  <div>
                    <p className="text-caption font-semibold uppercase tracking-wide text-brand-pink">Fitzy · Today&apos;s focus</p>
                    <p className="mt-0.5 text-headline text-white">A 10-minute walk counts</p>
                    <p className="mt-1 text-subhead text-fg-secondary">
                      Short walks add up and lift your mood. Pick a time today, maybe after a meal, and enjoy the fresh air.
                    </p>
                  </div>
                </div>
                <div className="mt-5 flex flex-wrap gap-2" aria-label="Things you can ask Fitzy">
                  {['What should I eat for dinner?', 'How was my week?', 'Help me break a plateau'].map((q) => (
                    <span key={q} className="rounded-full border border-hairline bg-white/5 px-3 py-1.5 text-footnote text-white/85">
                      {q}
                    </span>
                  ))}
                </div>
              </div>
            </Reveal>
          </div>
        </section>

        {/* ---------------------------------------------------------- hydration */}
        <Feature
          flip
          copy={
            <>
              <Eyebrow icon={Droplet} tone="cyan">
                Hydration &amp; vitals
              </Eyebrow>
              <H2>Your whole day at a glance.</H2>
              <Lead>
                Water in one tap, your week as a row of drops, and steps, weight and BMI right beside it, synced from Apple Health or Health
                Connect.
              </Lead>
              <Points
                items={[
                  { icon: Droplet, text: '+Glass, +Bottle, +Large or any amount' },
                  { icon: HeartPulse, text: 'Steps, workouts and weight sync automatically' },
                  { icon: Shield, text: 'Health data is never used for ads, never sold' },
                ]}
              />
            </>
          }
          visual={
            <div className="relative w-full max-w-[420px]">
              <Tile shot={SHOTS.hydration} sizes="(max-width: 768px) 92vw, 420px" className="w-full rounded-[28px]" />
            </div>
          }
        />

        {/* --------------------------------------------------------- everywhere */}
        <section id="everywhere" className="relative scroll-mt-16 overflow-hidden py-16 sm:py-24" aria-labelledby="everywhere-title">
          <div className="mx-auto max-w-3xl px-4 text-center sm:px-6">
            <Reveal>
              <Eyebrow icon={Watch} tone="green">
                Widgets · Lock Screen · Watch
              </Eyebrow>
              <H2 className="mx-auto">
                <span id="everywhere-title">It’s everywhere you are.</span>
              </H2>
              <p className="mx-auto mt-4 max-w-2xl text-pretty text-body text-fg-secondary sm:text-[19px]">
                See who’s left to close the circle and log a glass of water without opening the app: Home Screen and Lock Screen widgets, Live
                Activities, StandBy, Apple Watch and Wear OS.
              </p>
            </Reveal>
          </div>

          <div className={cn('mt-12', styles.marquee)} tabIndex={0} aria-label="FitCircle widgets, Live Activity and watch apps" role="region">
            <div className={cn('items-center px-4', styles.track)}>
              {[0, 1].map((dup) => (
                <div key={dup} className="flex items-center gap-5" aria-hidden={dup === 1}>
                  <Phone shot={SHOTS.widgets} width="220px" sizes="220px" fade={false} />
                  <div className="flex w-[360px] flex-col gap-5">
                    <Tile shot={SHOTS.liveActivity} sizes="360px" className="w-full rounded-[22px]" />
                    <Tile shot={SHOTS.standby} sizes="360px" className="w-full rounded-[20px]" />
                  </div>
                  <Tile shot={SHOTS.watchToday} sizes="190px" className="w-[190px] rounded-[44px]" />
                  <Tile shot={SHOTS.wearCircle} sizes="210px" round className="w-[210px]" />
                  <Phone shot={SHOTS.lock} width="220px" sizes="220px" fade={false} />
                  <div className="flex flex-col gap-5">
                    <Tile shot={SHOTS.watchCircle} sizes="170px" className="w-[170px] rounded-[40px]" />
                    <Tile shot={SHOTS.watchWater} sizes="170px" className="w-[170px] rounded-[40px]" />
                  </div>
                  <Tile shot={SHOTS.androidBoard} sizes="230px" className="w-[230px] rounded-[30px]" />
                  <Tile shot={SHOTS.wearToday} sizes="210px" round className="w-[210px]" />
                  <Tile shot={SHOTS.watchFuel} sizes="190px" className="w-[190px] rounded-[44px]" />
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ------------------------------------------------------ notifications */}
        <Feature
          copy={
            <>
              <Eyebrow icon={BellRing} tone="orange">
                Smart reminders
              </Eyebrow>
              <H2>A tap on the shoulder, right on time.</H2>
              <Lead>
                A heads-up before your streak ends at midnight, a reminder to drink when you’re behind, and a ping when a friend needs a save.
                Set quiet hours in settings so they never land at the wrong time.
              </Lead>
            </>
          }
          visual={
            <div className="flex w-full max-w-[400px] flex-col gap-4">
              <Tile shot={SHOTS.notifStreak} sizes="(max-width: 768px) 92vw, 400px" className="w-full rounded-[28px]" />
              <Tile shot={SHOTS.notifWater} sizes="(max-width: 768px) 92vw, 400px" className="w-[88%] self-end rounded-[28px]" />
            </div>
          }
        />

        {/* ---------------------------------------------------------------- web */}
        <section className="px-4 py-16 sm:px-6 sm:py-24">
          <div className="mx-auto max-w-6xl">
            <Reveal className="mx-auto max-w-2xl text-center">
              <H2>On your laptop, too.</H2>
              <p className="mx-auto mt-4 max-w-xl text-pretty text-body text-fg-secondary sm:text-[19px]">
                Sign in at fitcircle.ai to review your log, your circles and your progress on a big screen. Same account, always in sync.
              </p>
            </Reveal>
            <Reveal delay={120} className="mx-auto mt-10 max-w-5xl">
              <div className="overflow-hidden rounded-2xl border border-white/15 bg-[#0b0d16] shadow-[0_40px_100px_-30px_rgba(0,0,0,0.9)]">
                <div className="flex h-8 items-center gap-1.5 border-b border-white/10 px-4" aria-hidden>
                  <span className="h-2.5 w-2.5 rounded-full bg-white/20" />
                  <span className="h-2.5 w-2.5 rounded-full bg-white/20" />
                  <span className="h-2.5 w-2.5 rounded-full bg-white/20" />
                </div>
                <Image
                  src={SHOTS.web.src}
                  alt={SHOTS.web.alt}
                  width={SHOTS.web.w}
                  height={SHOTS.web.h}
                  sizes="(max-width: 1100px) 92vw, 1024px"
                  className="h-auto w-full"
                />
              </div>
            </Reveal>
          </div>
        </section>

        {/* ------------------------------------------------------- how it works */}
        <section className="border-y border-hairline bg-surface/40 px-4 py-16 sm:px-6 sm:py-24" aria-labelledby="how-title">
          <div className="mx-auto max-w-6xl">
            <Reveal className="text-center">
              <H2>
                <span id="how-title">Three steps. Then it’s a habit.</span>
              </H2>
            </Reveal>
            <ol className="mt-12 grid gap-5 md:grid-cols-3">
              {[
                { n: 1, title: 'Get the app', body: 'Free on iPhone and Android. Connect Apple Health or Health Connect if you like.', icon: Smartphone },
                { n: 2, title: 'Log your day', body: 'Snap a meal, log a workout or step on the scale. Any one of them keeps your streak going.', icon: Camera },
                { n: 3, title: 'Bring your circle', body: 'Invite a few friends with a link. Close the circle together every day.', icon: Users },
              ].map((s, i) => (
                <Reveal key={s.n} as="li" delay={i * 100} className="rounded-2xl border border-glass bg-surface-raised/50 p-6">
                  <span className="flex h-11 w-11 items-center justify-center rounded-full bg-gradient-brand text-headline font-bold shadow-glow">{s.n}</span>
                  <h3 className="mt-5 text-title3 text-white">{s.title}</h3>
                  <p className="mt-2 text-callout text-fg-secondary">{s.body}</p>
                </Reveal>
              ))}
            </ol>
          </div>
        </section>

        {/* ------------------------------------------------------------ pricing */}
        <section id="pricing" className="scroll-mt-16 px-4 py-16 sm:px-6 sm:py-24" aria-labelledby="pricing-title">
          <PricingViewTracker>
            <div className="mx-auto max-w-5xl">
              <Reveal className="text-center">
                <H2>
                  <span id="pricing-title">Free to start. Pro when you want more.</span>
                </H2>
                <p className="mx-auto mt-4 max-w-xl text-body text-fg-secondary">Your circles stay free for everyone in them.</p>
              </Reveal>
              <div className="mt-10 grid gap-5 md:grid-cols-2">
                <Reveal className="rounded-2xl border border-glass bg-surface-raised/50 p-6 sm:p-8">
                  <h3 className="text-title3 text-white">Free</h3>
                  <p className="mt-1 text-subhead text-fg-secondary">Everything you need to build the habit.</p>
                  <p className="mt-5 text-[40px] font-bold leading-none">$0</p>
                  <ul className="mt-6 space-y-3 text-callout text-white/90">
                    {FREE_PLAN.map((t) => (
                      <li key={t} className="flex gap-2.5">
                        <Check className="mt-0.5 h-4 w-4 shrink-0 text-brand-green" aria-hidden />
                        {t}
                      </li>
                    ))}
                  </ul>
                </Reveal>
                <Reveal delay={100} className="relative overflow-hidden rounded-2xl border border-brand-purple/40 bg-gradient-to-br from-brand-purple/20 via-surface-raised/60 to-brand-pink/10 p-6 sm:p-8">
                  <h3 className="text-title3 text-white">FitCircle Pro</h3>
                  <p className="mt-1 text-subhead text-fg-secondary">Everything FitCircle has to offer, in one plan.</p>
                  <p className="mt-5 flex items-baseline gap-2">
                    <span className="text-[40px] font-bold leading-none">$29.99</span>
                    <span className="text-subhead text-fg-secondary">/ year</span>
                  </p>
                  <p className="mt-1 text-footnote text-fg-secondary">or $9.99 / month</p>
                  <ul className="mt-6 space-y-3 text-callout text-white/90">
                    {PRO_PLAN.map((t) => (
                      <li key={t} className="flex gap-2.5">
                        <Check className="mt-0.5 h-4 w-4 shrink-0 text-brand-purple" aria-hidden />
                        {t}
                      </li>
                    ))}
                  </ul>
                  <p className="mt-6 text-footnote text-fg-tertiary">Renews automatically. Cancel any time to stop the next renewal; you keep Pro until the end of the period you&apos;ve paid for.</p>
                </Reveal>
              </div>
            </div>
          </PricingViewTracker>
        </section>

        {/* ---------------------------------------------------------------- faq */}
        <section id="faq" className="scroll-mt-16 px-4 pb-16 sm:px-6 sm:pb-24" aria-labelledby="faq-title">
          <div className="mx-auto max-w-3xl">
            <Reveal className="text-center">
              <H2>
                <span id="faq-title">Questions, answered.</span>
              </H2>
            </Reveal>
            <div className="mt-10 space-y-8">
              {FAQ_GROUPS.map((g) => (
                <div key={g.title}>
                  <h3 className="mb-3 px-1 text-footnote font-semibold uppercase tracking-wide text-fg-tertiary">{g.title}</h3>
                  <div className="divide-y divide-white/[0.07] overflow-hidden rounded-2xl border border-glass bg-surface-raised/40">
                    {g.items.map((f) => (
                      <details key={f.q} className="group px-5 sm:px-6">
                        <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-5 text-headline text-white [&::-webkit-details-marker]:hidden">
                          {f.q}
                          <ChevronDown className="h-5 w-5 shrink-0 text-fg-tertiary transition-transform duration-200 group-open:rotate-180" aria-hidden />
                        </summary>
                        <div className="pb-5 text-callout leading-relaxed text-fg-secondary">
                          {f.a}
                          {f.link && (
                            <>
                              {' '}
                              <Link href={f.link.href} className="font-semibold text-white underline-offset-4 hover:underline">
                                {f.link.label}
                              </Link>
                            </>
                          )}
                        </div>
                      </details>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ------------------------------------------------------- final CTA */}
        <section className="relative overflow-hidden px-4 py-20 sm:px-6 sm:py-28" aria-labelledby="final-cta-title">
          <div aria-hidden className={cn('pointer-events-none absolute inset-0', styles.glow)} />
          <div className="relative mx-auto max-w-3xl text-center">
            <Reveal>
              <Image src="/brand/fitcircle-icon-512.png" alt="" width={88} height={88} className="mx-auto h-[88px] w-[88px] rounded-[22px] shadow-glow" />
              <h2 id="final-cta-title" className="mt-7 text-balance text-[36px] font-bold leading-[1.08] tracking-tight sm:text-[52px]">
                Your circle is waiting.
              </h2>
              <p className="mx-auto mt-4 max-w-lg text-body text-fg-secondary sm:text-[19px]">Free on iPhone and Android. Start today, invite a friend tonight.</p>
              <div className="mx-auto mt-8 flex max-w-md flex-col gap-3 sm:flex-row">
                <GetAppButton placement="landing_final" params={params} initialPlatform={platform} label="Get the app" fullWidth className="sm:flex-1" />
                <WebCta />
              </div>
              <div className="mt-10 hidden justify-center lg:flex">
                <StoreRow params={params} placement="landing_final" center />
              </div>
            </Reveal>
          </div>
        </section>
      </main>

      <footer className="border-t border-hairline px-4 py-12 sm:px-6">
        <div className="mx-auto grid max-w-6xl gap-8 md:grid-cols-4">
          <div>
            <Logo size="sm" />
            <p className="mt-4 text-subhead text-fg-secondary">Nutrition, streaks and workouts, shared with the people who keep you going.</p>
          </div>
          <nav aria-label="Product">
            <h3 className="mb-3 text-subhead font-semibold text-white">Product</h3>
            <ul className="space-y-2 text-subhead text-fg-secondary">
              <li><Link href="/get?placement=landing_footer" className="hover:text-white">Get the app</Link></li>
              <li><Link href="/login" className="hover:text-white">Sign in on the web</Link></li>
              <li><Link href="/upgrade?source=landing_footer" className="hover:text-white">FitCircle Pro</Link></li>
            </ul>
          </nav>
          <nav aria-label="Company">
            <h3 className="mb-3 text-subhead font-semibold text-white">Company</h3>
            <ul className="space-y-2 text-subhead text-fg-secondary">
              <li><Link href="/support" className="hover:text-white">Support</Link></li>
              <li><a href="mailto:support@fitcircle.ai" className="hover:text-white">Contact</a></li>
            </ul>
          </nav>
          <nav aria-label="Legal">
            <h3 className="mb-3 text-subhead font-semibold text-white">Legal</h3>
            <ul className="space-y-2 text-subhead text-fg-secondary">
              <li><Link href="/terms" className="hover:text-white">Terms</Link></li>
              <li><Link href="/privacy" className="hover:text-white">Privacy</Link></li>
            </ul>
          </nav>
        </div>
        <p className="mx-auto mt-10 max-w-6xl border-t border-hairline pt-8 text-center text-footnote text-fg-tertiary">
          © {year} Inov8r Labs. FitCircle is a product of Inov8r Labs. Apple Watch, iPhone and App Store are trademarks of Apple Inc. Google Play
          and Wear OS are trademarks of Google LLC.
        </p>
      </footer>
    </div>
  );
}
