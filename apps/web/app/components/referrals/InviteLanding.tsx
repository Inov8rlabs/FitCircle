'use client';

import { motion } from 'framer-motion';
import { ArrowRight, Check, Gift, Globe, Heart, LayoutDashboard, Smartphone, Sparkles, Users } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

import { AnalyticsEvents, analytics } from '@/lib/analytics';
import { useTrackOnce } from '@/lib/analytics/react';
import { copyText } from '@/lib/referrals/clipboard';
import { playStoreUrl } from '@/lib/referrals/links';
import type { ReferralPreview } from '@/lib/referrals/types';
import {
  buildPendingInvite,
  canonicalInviteUrl,
  challengeTypeLabel,
  detectPlatform,
  inviterFirstName,
  openInAppUrl,
  pendingInviteCookieString,
  registerUrlFor,
  type InvitePlatform,
} from '@/lib/referrals/web';
import { useAuthStore } from '@/stores/auth-store';

import { JoinCircleFlow } from './JoinCircleFlow';

export interface InviteLandingProps {
  kind: 'personal' | 'circle';
  /** Normalized code from the URL (personal code for /i, circle code for /join). */
  code: string;
  /** `?ref=` on circle links. */
  refCode: string | null;
  preview: ReferralPreview;
  /** The referral backend failed; render generic copy but keep the invite usable. */
  degraded?: boolean;
  /** Server-side guess from the User-Agent; refined on the client. */
  initialPlatform: InvitePlatform;
  /** App Store listing URL ('' → "Coming soon"). */
  appStoreUrl: string;
  /** Whether the Play listing is live (else "Coming soon"). */
  playStoreLive: boolean;
}

const COPY_TOAST = 'Invite copied — paste it when FitCircle asks 💜';

export function InviteLanding(props: InviteLandingProps) {
  const { kind, code, refCode, preview, degraded = false, initialPlatform, appStoreUrl, playStoreLive } = props;
  const user = useAuthStore((s) => s.user);
  const [mounted, setMounted] = useState(false);
  const [platform, setPlatform] = useState<InvitePlatform>(initialPlatform);
  const [joining, setJoining] = useState(false);

  const usable = preview.valid || degraded;
  const isCircle = kind === 'circle';
  const circleCode = isCircle ? code : null;
  // Inviter's personal code: the URL code for /i, ?ref= for /join.
  const inviterRef = isCircle ? refCode : code;
  const inviteUrl = canonicalInviteUrl(kind, code, refCode);
  const signedIn = mounted && Boolean(user);
  const playUrl = playStoreUrl({ ref: inviterRef, circle: circleCode });

  useEffect(() => {
    setMounted(true);
    if (typeof navigator !== 'undefined') {
      setPlatform(detectPlatform(navigator.userAgent, { maxTouchPoints: navigator.maxTouchPoints }));
    }
  }, []);

  // First-party attribution cookie for web signup (7 days).
  useEffect(() => {
    if (!usable) return;
    const pending = buildPendingInvite({ code, ref: inviterRef, circle: circleCode });
    if (!pending) return;
    try {
      document.cookie = pendingInviteCookieString(pending, window.location.protocol === 'https:');
    } catch {
      // cookies disabled — the typed-code paths still work
    }
  }, [usable, code, inviterRef, circleCode]);

  useTrackOnce(AnalyticsEvents.inviteLinkOpened({ signed_in: Boolean(user) }), mounted, code);

  if (!usable) return <InvalidInvite />;

  if (joining && circleCode) {
    return (
      <Shell>
        <JoinCircleFlow inviteCode={circleCode} refCode={refCode} onBack={() => setJoining(false)} />
      </Shell>
    );
  }

  const name = degraded ? 'A friend' : inviterFirstName(preview);
  const rewardDays = degraded ? 0 : preview.inviteeRewardDays ?? 0;
  const circle = !degraded && isCircle ? preview.circle ?? null : null;

  const handleAppStore = async () => {
    analytics.track(AnalyticsEvents.appStoreLinkClicked({ store: 'app_store', placement: 'invite_landing' }));
    // The copy must start inside the tap (iOS requires a user gesture for clipboard writes).
    const copied = await copyText(`FitCircle invite: ${inviteUrl}`);
    if (copied) toast.success(COPY_TOAST);
    window.setTimeout(() => window.location.assign(appStoreUrl), copied ? 900 : 0);
  };

  return (
    <Shell>
      <div className="relative mx-auto w-full max-w-xl px-4 pb-16 pt-8 sm:pt-14">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="flex flex-col items-center text-center"
        >
          <InviterAvatar name={name} avatarUrl={degraded ? null : preview.inviter?.avatarUrl ?? null} />

          <h1 data-testid="invite-headline" className="mt-6 text-3xl font-extrabold tracking-tight text-white sm:text-4xl">
            {name} saved you a seat <span aria-hidden>💜</span>
          </h1>
          <p className="mt-3 max-w-md text-base text-gray-300 sm:text-lg">
            {circle ? (
              <>
                Join <span className="font-semibold text-white">{circle.name}</span> on FitCircle and keep each other
                honest.
              </>
            ) : isCircle ? (
              'Join their circle on FitCircle and keep each other honest.'
            ) : (
              'FitCircle keeps friends accountable. Log meals, keep your streak, check in together.'
            )}
          </p>
        </motion.div>

        {circle ? <CircleCard circle={circle} /> : <SeatRow inviterName={name} />}

        {rewardDays > 0 && <RewardCard inviterName={name} days={rewardDays} />}

        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.25 }}
          className="mt-8 space-y-3"
          data-testid="invite-ctas"
        >
          {signedIn ? (
            isCircle ? (
              <PrimaryButton onClick={() => setJoining(true)}>
                <Users className="h-5 w-5" /> Join circle
              </PrimaryButton>
            ) : (
              <div className="rounded-2xl border border-purple-500/30 bg-purple-500/10 p-5 text-center">
                <p className="font-semibold text-white">You&apos;re already on FitCircle</p>
                <p className="mt-1 text-sm text-gray-300">Invites are for new accounts. Bring your own friends instead!</p>
                <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-center">
                  <Link
                    href="/invite"
                    className="inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-purple-600 to-pink-600 px-5 py-3 font-semibold text-white"
                  >
                    <Gift className="h-4 w-4" /> Go to your invite hub
                  </Link>
                  <Link
                    href="/dashboard"
                    className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-700 px-5 py-3 font-medium text-gray-200 hover:bg-slate-800"
                  >
                    <LayoutDashboard className="h-4 w-4" /> Dashboard
                  </Link>
                </div>
              </div>
            )
          ) : (
            <>
              {(platform === 'ios' || platform === 'desktop') && (
                <AppStoreButton url={appStoreUrl} onClick={handleAppStore} primary={platform === 'ios'} />
              )}
              {(platform === 'android' || platform === 'desktop') && (
                <PlayStoreButton url={playUrl} live={playStoreLive} primary={platform === 'android'} />
              )}
              {platform !== 'desktop' && (
                <OpenInAppLink platform={platform} inviteUrl={inviteUrl} fallbackUrl={playUrl} />
              )}
              <Link
                href={registerUrlFor({ code, ref: inviterRef, circle: circleCode })}
                className="flex w-full items-center justify-center gap-2 rounded-2xl border border-slate-700 bg-slate-900/60 px-5 py-4 font-medium text-gray-200 transition-colors hover:border-purple-500/60 hover:bg-slate-900"
              >
                <Globe className="h-5 w-5 text-purple-300" /> Continue on the web
                <ArrowRight className="h-4 w-4" />
              </Link>
              <p className="text-center text-sm text-gray-400">
                Already have an account?{' '}
                <Link
                  href={
                    isCircle
                      ? `/login?returnUrl=${encodeURIComponent(`/join/${code}${refCode ? `?ref=${refCode}` : ''}`)}`
                      : '/login'
                  }
                  className="font-medium text-purple-300 hover:underline"
                >
                  Log in
                </Link>
              </p>
            </>
          )}
        </motion.div>

        <HowItWorks inviterName={name} reward={rewardDays > 0} />

        <p className="mt-10 text-center text-xs text-gray-500">
          Invite code <span className="font-mono text-gray-400">{code}</span> ·{' '}
          <Link href="/" className="hover:text-gray-300 hover:underline">
            What is FitCircle?
          </Link>
        </p>
      </div>
    </Shell>
  );
}

// ---------------------------------------------------------------------------

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative min-h-screen overflow-x-hidden bg-slate-950">
      <div className="pointer-events-none fixed inset-0 overflow-hidden" aria-hidden>
        <div className="absolute -top-32 left-1/2 h-[520px] w-[520px] -translate-x-1/2 rounded-full bg-purple-600/20 blur-3xl" />
        <div className="absolute bottom-0 right-[-120px] h-[420px] w-[420px] rounded-full bg-pink-600/10 blur-3xl" />
      </div>
      <header className="relative mx-auto flex max-w-xl items-center justify-center px-4 pt-6">
        <Link href="/" className="flex items-center gap-2 text-white">
          <span className="inline-block h-6 w-6 rounded-full border-[5px] border-purple-400" aria-hidden />
          <span className="text-lg font-bold tracking-tight">FitCircle</span>
        </Link>
      </header>
      <div className="relative">{children}</div>
    </div>
  );
}

function InviterAvatar({ name, avatarUrl }: { name: string; avatarUrl: string | null }) {
  const [broken, setBroken] = useState(false);
  const initial = name === 'A friend' ? '💜' : name.charAt(0).toUpperCase();
  return (
    <div className="relative">
      <motion.div
        aria-hidden
        className="absolute -inset-3 rounded-full bg-gradient-to-tr from-purple-500 via-fuchsia-500 to-pink-500 opacity-60 blur-md"
        animate={{ scale: [1, 1.08, 1], opacity: [0.5, 0.8, 0.5] }}
        transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
      />
      <div className="relative flex h-24 w-24 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-purple-500 to-pink-500 text-4xl font-bold text-white ring-4 ring-slate-950">
        {avatarUrl && !broken ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={avatarUrl} alt={name} className="h-full w-full object-cover" onError={() => setBroken(true)} />
        ) : (
          <span>{initial}</span>
        )}
      </div>
    </div>
  );
}

function SeatRow({ inviterName }: { inviterName: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.4, delay: 0.15 }}
      className="mt-8 flex items-center justify-center gap-3"
      aria-label={`${inviterName} and you`}
    >
      <Seat filled label={inviterName === 'A friend' ? 'Friend' : inviterName} />
      <Heart className="h-5 w-5 text-pink-400" aria-hidden />
      <Seat you label="You" />
    </motion.div>
  );
}

function Seat({ filled, you, label, img }: { filled?: boolean; you?: boolean; label: string; img?: string }) {
  return (
    <div className="flex flex-col items-center gap-1.5">
      {you ? (
        <motion.div
          className="flex h-12 w-12 items-center justify-center rounded-full border-2 border-dashed border-pink-400 bg-pink-500/10 text-xs font-semibold text-pink-200"
          animate={{ scale: [1, 1.08, 1] }}
          transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
        >
          You
        </motion.div>
      ) : filled ? (
        <div className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-purple-500 to-pink-500 text-sm font-bold text-white">
          {img ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={img} alt="" className="h-full w-full object-cover" />
          ) : (
            label.charAt(0).toUpperCase()
          )}
        </div>
      ) : (
        <div className="h-12 w-12 rounded-full border-2 border-dashed border-slate-700 bg-slate-900/50" />
      )}
      <span className="max-w-[4.5rem] truncate text-[11px] text-gray-400">{label}</span>
    </div>
  );
}

function CircleCard({ circle }: { circle: NonNullable<ReferralPreview['circle']> }) {
  const typeLabel = challengeTypeLabel(circle.challengeType);
  const members = Math.max(0, circle.memberCount);
  const avatars = circle.memberAvatars.slice(0, 4);
  return (
    <motion.div
      data-testid="invite-circle-card"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, delay: 0.15 }}
      className="mt-8 overflow-hidden rounded-3xl border border-white/10 bg-slate-900/70 backdrop-blur-xl"
    >
      <div className="h-1.5 bg-gradient-to-r from-purple-500 via-fuchsia-500 to-pink-500" />
      <div className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-wider text-purple-300">Circle</p>
            <h2 className="mt-1 break-words text-xl font-bold text-white">{circle.name}</h2>
          </div>
          {typeLabel && (
            <span className="shrink-0 rounded-full bg-purple-500/15 px-3 py-1 text-xs font-medium text-purple-200">
              {typeLabel}
            </span>
          )}
        </div>
        <div className="mt-4 flex items-center gap-3">
          <div className="flex -space-x-2">
            {avatars.map((src, i) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={`${src}-${i}`}
                src={src}
                alt=""
                className="h-8 w-8 rounded-full object-cover ring-2 ring-slate-900"
              />
            ))}
          </div>
          <span className="text-sm text-gray-300">
            {members} {members === 1 ? 'member' : 'members'}
          </span>
        </div>
        <div className="mt-5 flex items-center justify-between gap-2" aria-label="Circle seats">
          {[0, 1, 2, 3, 4].map((i) =>
            i < Math.min(members, 4) ? (
              <Seat key={i} filled label={i === 0 ? 'Host' : 'Member'} img={circle.memberAvatars[i]} />
            ) : i === Math.min(members, 4) ? (
              <Seat key={i} you label="Your seat" />
            ) : (
              <Seat key={i} label="Open" />
            )
          )}
        </div>
      </div>
    </motion.div>
  );
}

function RewardCard({ inviterName, days }: { inviterName: string; days: number }) {
  const span = days === 7 ? 'a free week' : `${days} free days`;
  const who = inviterName === 'A friend' ? 'your friend' : inviterName;
  return (
    <motion.div
      data-testid="invite-reward"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, delay: 0.2 }}
      className="mt-6 rounded-3xl border border-pink-500/30 bg-gradient-to-br from-purple-600/20 via-fuchsia-600/10 to-pink-600/20 p-5"
    >
      <div className="flex items-start gap-4">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-purple-500 to-pink-500">
          <Gift className="h-6 w-6 text-white" />
        </div>
        <div>
          <p className="font-semibold text-white">
            You and {who} both get {span} of Pro
          </p>
          <p className="mt-1 text-sm text-gray-300">
            It unlocks when you log your first check-in. That&apos;s it. Show up once and you&apos;re both rewarded.
          </p>
        </div>
      </div>
    </motion.div>
  );
}

function HowItWorks({ inviterName, reward }: { inviterName: string; reward: boolean }) {
  const who = inviterName === 'A friend' ? 'your friend' : inviterName;
  const steps = [
    { icon: Smartphone, title: 'Join with this invite', body: `Get FitCircle and sign up. We'll seat you next to ${who}.` },
    { icon: Check, title: 'Log your first check-in', body: 'A meal, a workout or your steps. Anything counts.' },
    reward
      ? { icon: Sparkles, title: 'You both get a week of Pro', body: 'Free Pro time for both of you. Then keep each other honest.' }
      : { icon: Users, title: 'Keep each other honest', body: 'See each other show up, every day.' },
  ];
  return (
    <section className="mt-12" aria-labelledby="how-it-works">
      <h2 id="how-it-works" className="text-center text-sm font-semibold uppercase tracking-wider text-gray-400">
        How it works
      </h2>
      <ol className="mt-5 space-y-3">
        {steps.map((s, i) => (
          <motion.li
            key={s.title}
            initial={{ opacity: 0, x: -8 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ delay: i * 0.08 }}
            className="flex items-start gap-4 rounded-2xl border border-slate-800 bg-slate-900/50 p-4"
          >
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-purple-500/15 text-sm font-bold text-purple-200">
              {i + 1}
            </div>
            <div>
              <p className="flex items-center gap-2 font-medium text-white">
                <s.icon className="h-4 w-4 text-pink-300" aria-hidden /> {s.title}
              </p>
              <p className="mt-0.5 text-sm text-gray-400">{s.body}</p>
            </div>
          </motion.li>
        ))}
      </ol>
    </section>
  );
}

function PrimaryButton({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <motion.button
      type="button"
      whileTap={{ scale: 0.98 }}
      onClick={onClick}
      className="flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-purple-600 to-pink-600 px-5 py-4 text-lg font-semibold text-white shadow-lg shadow-purple-900/40"
    >
      {children}
    </motion.button>
  );
}

const storeBase =
  'relative flex w-full items-center justify-center gap-3 rounded-2xl px-5 py-4 text-left transition-colors';

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

function StoreLabel({ eyebrow, label }: { eyebrow: string; label: string }) {
  return (
    <span className="flex flex-col leading-tight">
      <span className="text-xs text-white/70">{eyebrow}</span>
      <span className="text-lg font-semibold text-white">{label}</span>
    </span>
  );
}

function ComingSoon({ glyph, label }: { glyph: React.ReactNode; label: string }) {
  return (
    <div aria-disabled className={`${storeBase} border border-slate-800 bg-slate-900/40 opacity-70`}>
      {glyph}
      <StoreLabel eyebrow="Coming soon to" label={label} />
      <span className="absolute -top-2 right-3 rounded-full bg-purple-600 px-2 py-0.5 text-[10px] font-semibold text-white">
        Coming soon
      </span>
    </div>
  );
}

function AppStoreButton({ url, onClick, primary }: { url: string; onClick: () => void; primary: boolean }) {
  if (!url) return <ComingSoon glyph={<AppleGlyph />} label="the App Store" />;
  return (
    <motion.button
      type="button"
      whileTap={{ scale: 0.98 }}
      onClick={onClick}
      className={`${storeBase} ${
        primary
          ? 'bg-gradient-to-r from-purple-600 to-pink-600 shadow-lg shadow-purple-900/40'
          : 'border border-slate-700 bg-black hover:border-purple-500'
      }`}
    >
      <AppleGlyph />
      <StoreLabel eyebrow="Get FitCircle on the" label="App Store" />
    </motion.button>
  );
}

function PlayStoreButton({ url, live, primary }: { url: string; live: boolean; primary: boolean }) {
  if (!live) return <ComingSoon glyph={<PlayGlyph />} label="Google Play" />;
  return (
    <a
      href={url}
      onClick={() =>
        analytics.track(AnalyticsEvents.appStoreLinkClicked({ store: 'play_store', placement: 'invite_landing' }))
      }
      className={`${storeBase} ${
        primary
          ? 'bg-gradient-to-r from-purple-600 to-pink-600 shadow-lg shadow-purple-900/40'
          : 'border border-slate-700 bg-black hover:border-purple-500'
      }`}
    >
      <PlayGlyph />
      <StoreLabel eyebrow="Get FitCircle on" label="Google Play" />
    </a>
  );
}

function OpenInAppLink({
  platform,
  inviteUrl,
  fallbackUrl,
}: {
  platform: InvitePlatform;
  inviteUrl: string;
  fallbackUrl: string;
}) {
  const href = useMemo(() => openInAppUrl(platform, inviteUrl, fallbackUrl), [platform, inviteUrl, fallbackUrl]);
  if (!href) return null;
  return (
    <p className="text-center text-sm text-gray-400">
      Already have the app?{' '}
      <a href={href} className="font-medium text-purple-300 hover:underline">
        Open this invite in FitCircle
      </a>
    </p>
  );
}

function InvalidInvite() {
  return (
    <Shell>
      <div data-testid="invite-invalid" className="mx-auto flex min-h-[70vh] max-w-md flex-col items-center justify-center px-4 text-center">
        <div className="flex h-20 w-20 items-center justify-center rounded-full bg-slate-900 ring-1 ring-slate-800">
          <span className="text-4xl" aria-hidden>
            🔍
          </span>
        </div>
        <h1 className="mt-6 text-2xl font-bold text-white">This invite has expired or the code is wrong</h1>
        <p className="mt-2 text-gray-400">
          Double-check the link with whoever sent it. You can still join FitCircle and add a code later.
        </p>
        <Link
          href="/"
          className="mt-6 inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-purple-600 to-pink-600 px-5 py-3 font-semibold text-white"
        >
          Go to FitCircle <ArrowRight className="h-4 w-4" />
        </Link>
      </div>
    </Shell>
  );
}
