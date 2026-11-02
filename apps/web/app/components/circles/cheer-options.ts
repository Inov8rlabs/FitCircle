// Leaderboard cheer sheet rules (docs/CHAT_NAV_NOTIFICATIONS_CHEERS.md §3). Pure.

import { reactionEmoji } from '@/lib/chat/reactions';
import type { ChatReactionValue } from '@/lib/types/circle-chat';

export interface CheerChipOption {
  reaction: ChatReactionValue;
  /** Sent as the cheer's `message`. */
  text: string;
  /** Drawn from the reaction (named kinds via REACTION_EMOJI). */
  emoji: string;
  /** Only when the member hit / hasn't hit today's goal. */
  when?: 'goal_met' | 'below_goal';
}

const CHIPS: Array<Omit<CheerChipOption, 'emoji'>> = [
  { reaction: 'clap', text: 'Great job!' },
  { reaction: 'muscle', text: 'Keep going!', when: 'below_goal' },
  { reaction: 'flame', text: 'On fire!' },
  { reaction: 'same', text: 'High five!' },
  { reaction: '🎉', text: 'You crushed it!', when: 'goal_met' },
];

/**
 * The one-tap chips for a member's progress today: "You crushed it!" only at
 * 100 %+, "Keep going!" only below it; with no stat (private / not a steps
 * board) neither contextual chip shows.
 */
export function cheerChipsFor(goalPct: number | null | undefined): CheerChipOption[] {
  const known = typeof goalPct === 'number' && Number.isFinite(goalPct);
  return CHIPS.filter((c) => {
    if (!c.when) return true;
    if (!known) return false;
    return c.when === 'goal_met' ? goalPct! >= 100 : goalPct! < 100;
  }).map((c) => ({ ...c, emoji: reactionEmoji(c.reaction) }));
}

export type GoalPctBucket = 'unknown' | 'lt_25' | '25_50' | '50_75' | '75_100' | '100_plus';

/** Analytics band for the recipient's % of goal (never the raw number). */
export function goalPctBucket(goalPct: number | null | undefined): GoalPctBucket {
  if (typeof goalPct !== 'number' || !Number.isFinite(goalPct)) return 'unknown';
  if (goalPct >= 100) return '100_plus';
  if (goalPct >= 75) return '75_100';
  if (goalPct >= 50) return '50_75';
  if (goalPct >= 25) return '25_50';
  return 'lt_25';
}

/** "2,732 steps today · 34% of goal" / "34% of goal" / null. */
export function cheerStatLine(stat: { steps?: number | null; goalPct?: number | null }): string | null {
  const parts: string[] = [];
  if (typeof stat.steps === 'number') parts.push(`${stat.steps.toLocaleString('en-US')} steps today`);
  if (typeof stat.goalPct === 'number') parts.push(`${Math.round(stat.goalPct)}% of goal`);
  return parts.length ? parts.join(' · ') : null;
}

/** The first name for copy ("Say something to Raveesh"). */
export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || 'them';
}
