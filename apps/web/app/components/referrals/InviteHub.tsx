'use client';

import { motion } from 'framer-motion';
import {
  Check,
  Gift,
  Hash,
  Link2,
  Loader2,
  Lock,
  Send,
  Share2,
  Sparkles,
  Trophy,
  ArrowRight,
  UserPlus,
} from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import { AnalyticsEvents, analytics } from '@/lib/analytics';
import type {
  ReferralClaimFailedReason,
  ReferralInviteSharedContext,
  ReferralInviteSharedMethod,
} from '@/lib/analytics';
import { useTrackOnce } from '@/lib/analytics/react';
import { copyText } from '@/lib/referrals/clipboard';
import { checkInPhrase, myRewardLine } from '@/lib/referrals/invite-form';
import type { ReferralHub } from '@/lib/referrals/types';
import { useAuthStore } from '@/stores/auth-store';

import { FriendsList } from './FriendsList';
import { InviteByContactForm } from './InviteByContactForm';
import { RewardCelebration } from './RewardCelebration';

/** Fine print; the check-in count comes from program.qualifyingDays (§10.1). */
export function finePrint(qualifyingDays: number): string {
  return `A friend counts when they join with your link and ${checkInPhrase(qualifyingDays)}. Rewards are free Pro time; they're never required for anything you've paid for.`;
}

const ACTIVATED_KEY = (userId: string) => `fc_user_activated:${userId}`;

/** Fires `User Activated` once per user (persisted in localStorage; storage failures are ignored). */
export function trackActivationOnce(userId: string | null | undefined, activated: boolean | undefined): boolean {
  if (!userId || !activated) return false;
  try {
    if (window.localStorage.getItem(ACTIVATED_KEY(userId))) return false;
    window.localStorage.setItem(ACTIVATED_KEY(userId), new Date().toISOString());
  } catch {
    // Private mode / blocked storage: fire anyway; analytics dedupes server-side at worst.
  }
  analytics.track(AnalyticsEvents.userActivated());
  return true;
}

function fmtDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** "Pro until Nov 2 · 3 weeks from friends" / "+14 days banked…" / "Lifetime Pro 🏆" (spec §5.1). */
export function proStatusLine(hub: ReferralHub): string | null {
  const pro = hub.pro;
  const stats = hub.stats;
  if (!pro) return null;
  if (pro.lifetime || stats?.hasLifetime) {
    return pro.source === 'store'
      ? 'Lifetime Pro 🏆 You can cancel your store subscription anytime.'
      : 'Lifetime Pro 🏆';
  }
  if (pro.bankedDays > 0) return `+${pro.bankedDays} days banked for when your plan ends`;
  const weeks = Math.floor((stats?.daysEarned ?? 0) / 7);
  const until = fmtDate(pro.expiresAt);
  if (pro.source === 'referral' && until) {
    return weeks > 0 ? `Pro until ${until} · ${weeks} ${weeks === 1 ? 'week' : 'weeks'} from friends` : `Pro until ${until}`;
  }
  return null;
}

async function shareOrCopy(
  text: string,
  url: string | undefined,
  context: ReferralInviteSharedContext,
  copiedToast: string
): Promise<void> {
  let method: ReferralInviteSharedMethod = 'copy_link';
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      await navigator.share(url ? { text, url } : { text });
      method = 'share_sheet';
      analytics.track(AnalyticsEvents.referralInviteShared({ method, context }));
      return;
    }
  } catch (error) {
    // User dismissed the share sheet — not a share, and not an error to surface.
    if ((error as DOMException)?.name === 'AbortError') return;
  }
  if (await copyText(text)) {
    toast.success(copiedToast);
    analytics.track(AnalyticsEvents.referralInviteShared({ method, context }));
  } else {
    toast.error("Couldn't copy. Long-press the link to copy it.");
  }
}

export function InviteHub() {
  const [hub, setHub] = useState<ReferralHub | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [celebrating, setCelebrating] = useState<NonNullable<ReferralHub['unseenRewards']>>([]);
  const celebrated = useRef(false);
  const [focusInvite, setFocusInvite] = useState(0);
  const [inviteSource, setInviteSource] = useState<'hub' | 'celebration'>('hub');

  const load = useCallback(async () => {
    setLoading(true);
    setFailed(false);
    try {
      const res = await fetch('/api/referrals/me', { credentials: 'same-origin', cache: 'no-store' });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.success) throw new Error(body?.error?.message || 'Failed');
      const data = body.data as ReferralHub;
      setHub(data);
      if (!celebrated.current && data.enabled && data.unseenRewards?.length) {
        celebrated.current = true;
        setCelebrating(data.unseenRewards);
      }
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useTrackOnce(AnalyticsEvents.referralHubViewed({ source: 'web_nav' }), Boolean(hub?.enabled));

  // Activation (§10.6): `activation` is optional until every backend path returns it.
  const userId = useAuthStore((st) => st.user?.id ?? null);
  const activated = (hub as (ReferralHub & { activation?: { activated?: boolean } }) | null)?.activation?.activated;
  useEffect(() => {
    trackActivationOnce(userId, activated);
  }, [userId, activated]);

  const finishCelebration = () => {
    const rewards = celebrating;
    setCelebrating([]);
    if (!rewards.length) return;
    for (const kind of new Set(rewards.map((r) => r.kind))) {
      analytics.track(AnalyticsEvents.referralRewardCelebrated({ kind }));
    }
    void fetch('/api/referrals/me/seen', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ ids: rewards.map((r) => r.id) }),
    }).catch(() => {});
  };

  const inviteFromCelebration = (kind: NonNullable<ReferralHub['unseenRewards']>[number]['kind']) => {
    analytics.track(AnalyticsEvents.referralCelebrationInviteTapped({ kind }));
    analytics.track(AnalyticsEvents.referralInviteSheetOpened({ source: 'celebration' }));
    finishCelebration();
    setInviteSource('celebration');
    setFocusInvite((n) => n + 1);
  };

  if (loading && !hub) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 pb-24 pt-8" data-testid="hub-loading" aria-busy="true">
        <div className="flex flex-col items-center">
          <div className="skeleton h-9 w-64 rounded-lg" />
          <div className="skeleton mt-3 h-4 w-80 max-w-full rounded-lg" />
          <div className="skeleton mt-8 h-[180px] w-[180px] rounded-full" />
          <div className="skeleton mt-5 h-4 w-56 rounded-lg" />
          <div className="skeleton mt-7 h-14 w-full max-w-md rounded-xl" />
          <div className="mt-3 grid w-full max-w-md grid-cols-2 gap-3">
            <div className="skeleton h-12 rounded-xl" />
            <div className="skeleton h-12 rounded-xl" />
          </div>
        </div>
      </div>
    );
  }

  if (failed || !hub) {
    return (
      <div className="mx-auto max-w-md px-4 py-20 text-center">
        <p className="text-white">We couldn&apos;t load your invites.</p>
        <button
          type="button"
          onClick={() => void load()}
          className="mt-4 rounded-xl bg-gradient-brand px-5 py-2.5 font-semibold text-white shadow-glow hover:brightness-110"
        >
          Try again
        </button>
      </div>
    );
  }

  if (!hub.enabled) {
    return (
      <div className="mx-auto max-w-md px-4 py-24 text-center" data-testid="hub-disabled">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-purple-500/15">
          <Gift className="h-8 w-8 text-purple-300" />
        </div>
        <h1 className="mt-5 text-2xl font-bold text-white">Invites are coming soon</h1>
        <p className="mt-2 text-gray-400">Soon you&apos;ll be able to bring friends and earn free Pro together.</p>
      </div>
    );
  }

  const stats = hub.stats ?? { invited: 0, pending: 0, qualified: 0, daysEarned: 0, daysBanked: 0, hasLifetime: false, toLifetime: 100 };
  const program = hub.program;
  const qualifyingDays = program?.qualifyingDays ?? 3;
  const lifetimeThreshold = program?.lifetimeThreshold ?? 100;
  const weeksEarned = Math.floor(stats.daysEarned / 7);
  const target = hub.nextMilestone?.count ?? lifetimeThreshold;
  const progress = Math.min(1, target > 0 ? stats.qualified / target : 1);
  const shareText = hub.shareMessage ?? hub.shareUrl ?? '';
  const proLine = proStatusLine(hub);

  return (
    <div className="relative mx-auto w-full max-w-3xl px-4 pb-24 pt-8">
      <RewardCelebration
        rewards={celebrating}
        weeksEarned={weeksEarned}
        onDone={finishCelebration}
        onInvite={inviteFromCelebration}
      />

      {/* Hero */}
      <section className="text-center">
        <h1 className="text-[30px] font-bold leading-tight text-white sm:text-large-title">
          Better{' '}
          <span className="bg-gradient-brand bg-clip-text text-transparent">together</span>
        </h1>
        <p className="mt-2 text-callout text-fg-secondary">Every friend who joins gets you both a free week of Pro.</p>

        <div className="mt-8 flex justify-center">
          <HeroRing progress={progress}>
            <span className="text-5xl font-extrabold text-white" data-testid="hub-weeks">
              {stats.hasLifetime ? '∞' : weeksEarned}
            </span>
            <span className="mt-1 text-xs font-medium uppercase tracking-wider text-purple-200">free weeks earned</span>
          </HeroRing>
        </div>

        <div className="mt-5 space-y-1 text-sm">
          {hub.nextMilestone ? (
            <p className="text-gray-200">
              <span className="font-semibold text-white">
                {stats.qualified} / {hub.nextMilestone.count}
              </span>{' '}
              friends · {hub.nextMilestone.remaining} more to{' '}
              <span className="font-semibold text-pink-300">{hub.nextMilestone.title}</span>
            </p>
          ) : null}
          {!stats.hasLifetime && (
            <p className="text-gray-400">
              {stats.qualified} / {lifetimeThreshold} friends to Lifetime Pro
            </p>
          )}
          {proLine && <p className="pt-1 font-medium text-purple-200" data-testid="hub-pro-line">{proLine}</p>}
        </div>

        {/* Actions */}
        <div className="mx-auto mt-7 flex max-w-md flex-col gap-3">
          <motion.button
            type="button"
            whileTap={{ scale: 0.98 }}
            onClick={() => void shareOrCopy(shareText, undefined, 'hub', 'Invite copied 💜')}
            className="flex h-14 items-center justify-center gap-2 rounded-xl bg-gradient-brand px-5 text-headline text-white shadow-glow transition hover:brightness-110"
          >
            <Share2 className="h-5 w-5" /> Invite friends
          </motion.button>
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={async () => {
                if (hub.shareUrl && (await copyText(hub.shareUrl))) {
                  toast.success('Link copied');
                  analytics.track(AnalyticsEvents.referralInviteShared({ method: 'copy_link', context: 'hub' }));
                }
              }}
              className="flex items-center justify-center gap-2 rounded-xl border border-hairline bg-white/5 px-4 py-3 text-sm font-semibold text-white transition hover:bg-white/10"
            >
              <Link2 className="h-4 w-4" /> Copy link
            </button>
            <button
              type="button"
              onClick={async () => {
                if (hub.code && (await copyText(hub.code))) {
                  toast.success(`Code ${hub.code} copied`);
                  analytics.track(AnalyticsEvents.referralInviteShared({ method: 'copy_code', context: 'hub' }));
                }
              }}
              className="flex items-center justify-center gap-2 rounded-xl border border-hairline bg-white/5 px-4 py-3 text-sm font-semibold text-white transition hover:bg-white/10"
            >
              <Hash className="h-4 w-4" /> Share code
              <span className="font-mono text-purple-300">{hub.code}</span>
            </button>
          </div>
        </div>
      </section>

      {hub.myReward && <MyRewardCard reward={hub.myReward} />}

      {hub.referredBy && (
        <p className="mt-6 text-center text-sm text-gray-400">
          You joined with {hub.referredBy.firstName}&apos;s invite 💜
        </p>
      )}

      {hub.pendingCircleInvite && (
        <Card className="mt-6 border-pink-500/30">
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <p className="text-xs font-medium uppercase tracking-wider text-pink-300">You were invited</p>
              <p className="mt-1 truncate font-semibold text-white">{hub.pendingCircleInvite.name}</p>
              <p className="text-sm text-gray-400">A seat is waiting for you in this circle.</p>
            </div>
            <Link
              href={`/join/${encodeURIComponent(hub.pendingCircleInvite.inviteCode)}${
                hub.pendingCircleInvite.ref ? `?ref=${encodeURIComponent(hub.pendingCircleInvite.ref)}` : ''
              }`}
              className="inline-flex shrink-0 items-center gap-1 rounded-full bg-gradient-brand px-4 py-2.5 text-sm font-semibold text-white shadow-glow"
            >
              Join <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </Card>
      )}

      <InviteByContactForm
        smsBody={hub.smsBody ?? hub.shareMessage ?? null}
        focusSignal={focusInvite}
        source={inviteSource}
        onSent={() => void load()}
      />

      {hub.starterCircle && hub.starterCircle.memberCount < 5 && (
        <Card className="mt-8">
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <p className="text-xs font-medium uppercase tracking-wider text-purple-300">Fill your seats</p>
              <p className="mt-1 truncate font-semibold text-white">{hub.starterCircle.name}</p>
              <p className="text-sm text-gray-400">
                {hub.starterCircle.memberCount} of 5 seats filled
              </p>
            </div>
            <button
              type="button"
              onClick={() => void shareOrCopy(hub.starterCircle!.shareMessage, undefined, 'circle', 'Circle invite copied 💜')}
              className="shrink-0 rounded-full bg-gradient-brand px-4 py-2.5 text-sm font-semibold text-white shadow-glow hover:brightness-110"
            >
              <UserPlus className="mr-1 inline h-4 w-4" /> Invite
            </button>
          </div>
          <div className="mt-4 flex gap-2" aria-hidden>
            {[0, 1, 2, 3, 4].map((i) => (
              <div
                key={i}
                className={`h-2 flex-1 rounded-full ${
                  i < hub.starterCircle!.memberCount ? 'bg-gradient-brand' : 'bg-white/10'
                }`}
              />
            ))}
          </div>
        </Card>
      )}

      {/* How it works */}
      <section className="mt-10">
        <SectionTitle>How it works</SectionTitle>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          {[
            { icon: Send, title: 'Send your link', body: 'Share it with a friend who should be in your corner.' },
            { icon: Check, title: 'Friend joins & checks in', body: `They sign up with your link and ${checkInPhrase(qualifyingDays)}.` },
            { icon: Gift, title: 'You both get a week of Pro', body: 'Free Pro time for both of you, automatically.' },
          ].map((s, i) => (
            <Card key={s.title}>
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-purple-500/15 text-sm font-bold text-purple-200">
                {i + 1}
              </div>
              <p className="mt-3 flex items-center gap-2 font-semibold text-white">
                <s.icon className="h-4 w-4 text-pink-300" /> {s.title}
              </p>
              <p className="mt-1 text-sm text-gray-400">{s.body}</p>
            </Card>
          ))}
        </div>
      </section>

      {/* Milestones */}
      {hub.milestones && hub.milestones.length > 0 && (
        <section className="mt-10">
          <SectionTitle>Milestones</SectionTitle>
          <ol className="mt-4 space-y-2" data-testid="hub-milestones">
            {hub.milestones.map((m) => {
              const isNext = hub.nextMilestone?.key === m.key;
              return (
                <li
                  key={m.key}
                  className={`flex items-center gap-4 rounded-2xl border p-4 ${
                    m.reached
                      ? 'border-purple-500/40 bg-purple-500/10'
                      : isNext
                        ? 'border-brand-pink/40 bg-surface-raised/60'
                        : 'border-glass bg-surface-raised/40'
                  }`}
                >
                  <div
                    className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full ${
                      m.reached ? 'bg-gradient-brand text-white' : 'bg-white/10 text-fg-tertiary'
                    }`}
                  >
                    {m.reached ? (
                      m.key === 'lifetime' ? <Trophy className="h-5 w-5" /> : <Check className="h-5 w-5" />
                    ) : m.key === 'lifetime' ? (
                      <Sparkles className="h-5 w-5" />
                    ) : (
                      <Lock className="h-4 w-4" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className={`font-semibold ${m.reached ? 'text-white' : 'text-gray-300'}`}>
                      {m.title}{' '}
                      <span className="text-xs font-normal text-gray-500">
                        · {m.count} {m.count === 1 ? 'friend' : 'friends'}
                      </span>
                    </p>
                    <p className="text-sm text-gray-400">{m.blurb}</p>
                  </div>
                  {isNext && hub.nextMilestone && (
                    <span className="shrink-0 rounded-full bg-pink-500/15 px-2.5 py-1 text-xs font-medium text-pink-200">
                      {hub.nextMilestone.remaining} to go
                    </span>
                  )}
                </li>
              );
            })}
          </ol>
        </section>
      )}

      {/* Friends */}
      <section className="mt-10">
        <SectionTitle>
          Your friends{' '}
          {(hub.invites?.length ?? 0) + (hub.invitees?.length ?? 0) > 0 && (
            <span className="text-gray-500">({(hub.invites?.length ?? 0) + (hub.invitees?.length ?? 0)})</span>
          )}
        </SectionTitle>
        <FriendsList invites={hub.invites} invitees={hub.invitees} onChanged={() => void load()} />
      </section>

      {hub.canClaimCode && <ClaimCodeForm onClaimed={() => void load()} />}

      <p className="mt-12 text-center text-xs leading-relaxed text-gray-500">{finePrint(qualifyingDays)}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------

function MyRewardCard({ reward }: { reward: NonNullable<ReferralHub['myReward']> }) {
  const span = reward.rewardDays === 7 ? 'free week' : `${reward.rewardDays} free days`;
  if (reward.status === 'unlocked') {
    return (
      <div
        data-testid="my-reward-unlocked"
        className="mt-8 flex items-center gap-3 rounded-2xl border border-green-500/30 bg-green-500/10 p-4"
      >
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-green-500/20">
          <Check className="h-5 w-5 text-green-300" />
        </div>
        <div>
          <p className="font-semibold text-white">Your {span} of Pro is unlocked ✓</p>
          <p className="text-sm text-gray-300">
            Thanks for showing up{reward.inviterFirstName ? ` with ${reward.inviterFirstName}` : ''}. Enjoy every Pro feature.
          </p>
        </div>
      </div>
    );
  }
  const done = Math.min(Math.max(0, reward.days), reward.required);
  return (
    <div
      data-testid="my-reward-progress"
      className="mt-8 rounded-2xl border border-pink-500/30 bg-gradient-to-br from-purple-600/20 via-fuchsia-600/10 to-pink-600/20 p-5"
    >
      <p className="text-xs font-medium uppercase tracking-wider text-pink-300">Your free week</p>
      <div className="mt-3 flex items-center gap-2" aria-label={`${done} of ${reward.required} check-ins`} role="img">
        {Array.from({ length: reward.required }, (_, i) => (
          <motion.span
            key={i}
            className={`h-4 w-4 rounded-full ${
              i < done ? 'bg-gradient-to-br from-purple-400 to-pink-400' : 'border-2 border-dashed border-slate-600'
            }`}
            initial={{ scale: 0.6, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ delay: i * 0.08 }}
          />
        ))}
        <span className="ml-1 text-sm text-gray-300">
          {done} of {reward.required} check-ins
        </span>
      </div>
      <p className="mt-2 font-semibold text-white">
        {myRewardLine(reward, reward.inviterFirstName, reward.rewardDays)}
      </p>
      {fmtDate(reward.deadline) && (
        <p className="mt-1 text-xs text-gray-400">Check in by {fmtDate(reward.deadline)} to unlock it.</p>
      )}
    </div>
  );
}

function HeroRing({ progress, children }: { progress: number; children: React.ReactNode }) {
  const size = 200;
  const stroke = 14;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <defs>
          <linearGradient id="hub-ring" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#a855f7" />
            <stop offset="100%" stopColor="#ec4899" />
          </linearGradient>
        </defs>
        <circle cx={size / 2} cy={size / 2} r={r} stroke="rgba(148,163,184,0.15)" strokeWidth={stroke} fill="none" />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke="url(#hub-ring)"
          strokeWidth={stroke}
          strokeLinecap="round"
          fill="none"
          strokeDasharray={c}
          initial={{ strokeDashoffset: c }}
          animate={{ strokeDashoffset: c * (1 - progress) }}
          transition={{ duration: 1.2, ease: 'easeOut' }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">{children}</div>
    </div>
  );
}

function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <div className={`rounded-xl border border-glass bg-surface-raised/50 p-4 backdrop-blur-xl ${className}`}>{children}</div>;
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="px-1 text-footnote font-semibold uppercase tracking-wide text-fg-tertiary">{children}</h2>;
}

const CLAIM_MESSAGES: Record<string, string> = {
  INVALID_CODE: "That code doesn't look right. Check it and try again.",
  SELF_REFERRAL: "That's your own code. Share it with a friend instead!",
  ALREADY_ATTRIBUTED: "You're already connected to a friend's invite 💜",
  WINDOW_CLOSED: 'Invite codes can only be added in your first week.',
  DEVICE_INELIGIBLE: "This invite can't be used on this account.",
  PROGRAM_DISABLED: 'Invites are paused right now.',
};

const CLAIM_REASONS: Record<string, ReferralClaimFailedReason> = {
  INVALID_CODE: 'invalid_code',
  SELF_REFERRAL: 'self_referral',
  ALREADY_ATTRIBUTED: 'already_attributed',
  WINDOW_CLOSED: 'window_closed',
  DEVICE_INELIGIBLE: 'device_ineligible',
  PROGRAM_DISABLED: 'disabled',
};

function ClaimCodeForm({ onClaimed }: { onClaimed: () => void }) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!code.trim()) return;
    setBusy(true);
    try {
      const res = await fetch('/api/referrals/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ code: code.trim(), source: 'typed' }),
      });
      const body = await res.json().catch(() => null);
      if (body?.data?.claimed) {
        analytics.track(AnalyticsEvents.referralCodeClaimed({ source: 'typed' }));
        const name = body.data.inviter?.firstName;
        toast.success(name ? `You're in with ${name}'s invite 💜` : "You're in 💜");
        onClaimed();
      } else {
        const reason: string = body?.data?.reason ?? 'ERROR';
        analytics.track(AnalyticsEvents.referralClaimFailed({ reason: CLAIM_REASONS[reason] ?? 'unknown' }));
        toast.error(CLAIM_MESSAGES[reason] ?? 'Something went wrong. Please try again.');
        if (reason === 'ALREADY_ATTRIBUTED' || reason === 'WINDOW_CLOSED') onClaimed();
      }
    } catch {
      analytics.track(AnalyticsEvents.referralClaimFailed({ reason: 'network' }));
      toast.error('Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="mt-10">
      <SectionTitle>Got an invite code?</SectionTitle>
      <form onSubmit={submit} className="mt-4 flex gap-2">
        <input
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          placeholder="e.g. MAYA7K2"
          aria-label="Invite code"
          autoCapitalize="characters"
          className="min-w-0 flex-1 rounded-xl border border-hairline bg-white/5 px-4 py-3 font-mono text-white placeholder:text-fg-tertiary focus:border-brand-purple/60 focus:outline-none"
        />
        <button
          type="submit"
          disabled={busy || !code.trim()}
          className="rounded-xl bg-gradient-brand px-5 py-3 font-semibold text-white shadow-glow hover:brightness-110 disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Add'}
        </button>
      </form>
    </section>
  );
}
