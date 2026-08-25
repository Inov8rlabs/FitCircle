/**
 * Client-side plumbing for SERVER-SIDE streak auto-claims.
 *
 * Every manual log (meal, drink, workout) is claimed for the streak by the
 * create endpoint, which reports the outcome in the response's `meta.streak`
 * (AutoClaimResult). Pages that create logs call `announceStreakAutoClaim`
 * with it; the dashboard / EngagementStreakCard listen for the resulting
 * `streak-auto-claimed` window event and refetch, and the user gets a toast
 * — including "you earned a shield" — so logging never feels like it
 * silently did or didn't count.
 */
'use client';

import { toast } from 'sonner';

export const STREAK_AUTO_CLAIMED_EVENT = 'streak-auto-claimed';

export interface StreakAutoClaimMeta {
  claimed: boolean;
  alreadyClaimed: boolean;
  day: string | null;
  streakCount: number | null;
  milestone?: {
    milestone: number;
    type: 'shield_earned' | 'achievement_unlocked';
    reward?: string;
    shieldsGranted?: number;
    shieldsCapped?: boolean;
  };
  skipped?: string;
  source: string;
}

/** Pull `meta.streak` out of an API envelope, tolerating any shape. */
export function extractStreakMeta(envelope: unknown): StreakAutoClaimMeta | null {
  const meta = (envelope as { meta?: { streak?: unknown } } | null)?.meta;
  const streak = meta?.streak as StreakAutoClaimMeta | undefined;
  return streak && typeof streak === 'object' ? streak : null;
}

/** The browser's IANA timezone, sent so the server anchors on the user's local day. */
export function clientTimezone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Broadcast an auto-claim outcome to the rest of the page and toast it.
 * Safe to call with null (nothing happens).
 */
export function announceStreakAutoClaim(meta: StreakAutoClaimMeta | null | undefined): void {
  if (!meta || !(meta.claimed || meta.alreadyClaimed)) return;

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(STREAK_AUTO_CLAIMED_EVENT, { detail: meta }));
  }

  if (!meta.claimed) return; // already covered today — no need to re-announce

  const granted = meta.milestone?.shieldsGranted ?? 0;
  if (granted > 0) {
    toast.success(`Shield earned 🛡️`, {
      description: `${meta.streakCount ?? meta.milestone?.milestone} days strong — you earned ${
        granted === 1 ? 'a streak shield' : `${granted} streak shields`
      }. It auto-protects your next missed day.`,
    });
  } else if (meta.milestone) {
    toast.success(`${meta.milestone.reward ?? `${meta.milestone.milestone}-day streak`} 🏅`, {
      description: meta.milestone.shieldsCapped
        ? 'You earned a shield, but your bank is already full.'
        : `${meta.milestone.milestone} days in a row — keep it going!`,
    });
  } else if (meta.streakCount != null) {
    toast.success(`🔥 Day ${meta.streakCount} — your streak is counted`);
  }
}
