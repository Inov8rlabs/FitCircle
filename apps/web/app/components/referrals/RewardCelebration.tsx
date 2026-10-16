'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { Gift, Trophy } from 'lucide-react';
import { useMemo } from 'react';

import type { ReferralHub } from '@/lib/referrals/types';

type Reward = NonNullable<ReferralHub['unseenRewards']>[number];

const COLORS = ['#a855f7', '#ec4899', '#f97316', '#22d3ee', '#facc15', '#10b981'];

/** Lightweight confetti burst — framer-motion only, no extra dependency. */
function Confetti({ count }: { count: number }) {
  const pieces = useMemo(
    () =>
      Array.from({ length: count }, (_, i) => ({
        id: i,
        x: (Math.random() - 0.5) * 900,
        y: -(200 + Math.random() * 400),
        fall: 300 + Math.random() * 500,
        rotate: Math.random() * 720 - 360,
        delay: Math.random() * 0.25,
        size: 6 + Math.random() * 8,
        color: COLORS[i % COLORS.length],
        round: Math.random() > 0.6,
      })),
    [count]
  );
  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center overflow-hidden" aria-hidden>
      {pieces.map((p) => (
        <motion.span
          key={p.id}
          className="absolute block"
          style={{
            width: p.size,
            height: p.round ? p.size : p.size * 0.45,
            background: p.color,
            borderRadius: p.round ? 999 : 2,
          }}
          initial={{ x: 0, y: 0, opacity: 1, rotate: 0, scale: 0.6 }}
          animate={{ x: p.x, y: [0, p.y, p.y + p.fall], opacity: [1, 1, 0], rotate: p.rotate, scale: 1 }}
          transition={{ duration: 2.4, delay: p.delay, ease: 'easeOut', times: [0, 0.35, 1] }}
        />
      ))}
    </div>
  );
}

function describe(reward: Reward): { title: string; body: string } {
  if (reward.kind === 'lifetime') {
    return { title: 'Lifetime Pro unlocked 🏆', body: '100 friends moving because of you. Pro is yours, forever.' };
  }
  const days = reward.days ?? 7;
  const amount = days === 7 ? 'a free week' : `${days} free days`;
  if (reward.kind === 'invitee_welcome') {
    return {
      title: `+${days} days of Pro ✨`,
      body: reward.friendName
        ? `A gift from ${reward.friendName} for showing up. Enjoy every Pro feature, on us.`
        : 'A gift for showing up. Enjoy every Pro feature, on us.',
    };
  }
  return {
    title: `+${days} days of Pro 🎁`,
    body: reward.friendName
      ? `${reward.friendName} checked in for the third day. That's ${amount} of Pro for you.`
      : `A friend checked in for the third day. That's ${amount} of Pro for you.`,
  };
}

/**
 * Full-screen reward moment for `unseenRewards`. Shows the newest reward (with a
 * count of any others) and calls `onDone` once dismissed; the caller marks them seen.
 */
export function RewardCelebration({
  rewards,
  weeksEarned,
  onDone,
  onInvite,
}: {
  rewards: Reward[];
  weeksEarned: number;
  onDone: () => void;
  /** Primary CTA (§9.1): "Invite friends — earn a week for each". */
  onInvite?: (kind: Reward['kind']) => void;
}) {
  const open = rewards.length > 0;
  const lifetime = rewards.find((r) => r.kind === 'lifetime');
  const headline = lifetime ?? rewards[0];
  const copy = headline ? describe(headline) : null;
  const others = rewards.length - 1;

  return (
    <AnimatePresence>
      {open && copy && headline && (
        <motion.div
          role="dialog"
          aria-modal="true"
          aria-label={copy.title}
          data-testid="reward-celebration"
          className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/85 p-4 backdrop-blur-md"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onDone}
        >
          <Confetti count={lifetime ? 140 : 80} />
          <motion.div
            className="relative w-full max-w-sm rounded-3xl border border-white/10 bg-gradient-to-br from-purple-700/60 via-fuchsia-700/40 to-pink-700/50 p-8 text-center shadow-2xl"
            initial={{ scale: 0.7, y: 40, opacity: 0 }}
            animate={{ scale: 1, y: 0, opacity: 1 }}
            exit={{ scale: 0.9, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 260, damping: 18 }}
            onClick={(e) => e.stopPropagation()}
          >
            <motion.div
              className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-white/15"
              animate={{ rotate: [0, -8, 8, -4, 0], scale: [1, 1.1, 1] }}
              transition={{ duration: 1.2, delay: 0.3 }}
            >
              {lifetime ? <Trophy className="h-10 w-10 text-yellow-300" /> : <Gift className="h-10 w-10 text-white" />}
            </motion.div>
            <h2 className="mt-5 text-2xl font-extrabold text-white">{copy.title}</h2>
            <p className="mt-2 text-sm text-purple-100">{copy.body}</p>
            {others > 0 && (
              <p className="mt-2 text-xs text-purple-200">
                + {others} more {others === 1 ? 'reward' : 'rewards'}
              </p>
            )}
            {!lifetime && weeksEarned > 0 && (
              <p className="mt-4 text-sm font-medium text-white">
                {weeksEarned} free {weeksEarned === 1 ? 'week' : 'weeks'} earned so far
              </p>
            )}
            {headline.kind === 'invitee_welcome' && (
              <p className="mt-3 text-xs text-purple-100">
                Bring your own friends: every one who checks in earns you another free week.
              </p>
            )}
            {onInvite ? (
              <>
                <button
                  type="button"
                  onClick={() => onInvite(headline.kind)}
                  className="mt-6 w-full rounded-2xl bg-white px-5 py-3 font-semibold text-purple-700 hover:bg-purple-50"
                >
                  Invite friends — earn a week for each
                </button>
                <button
                  type="button"
                  onClick={onDone}
                  className="mt-2 w-full rounded-2xl px-5 py-2.5 text-sm font-medium text-white/80 hover:text-white"
                >
                  Done
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={onDone}
                className="mt-6 w-full rounded-2xl bg-white px-5 py-3 font-semibold text-purple-700 hover:bg-purple-50"
              >
                Done
              </button>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
