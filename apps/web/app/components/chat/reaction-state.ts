// Pure helpers for the web chat's reaction UI (Chat Reactions v2,
// docs/CHAT_REACTIONS_V2.md). No React, no I/O — unit-tested directly.

import type { ChatMessage, MessageReactionSummary } from '@/lib/api/circle-chat-client';
import { isNamedReactionKind, reactionEmoji } from '@/lib/chat/reactions';

const SPOKEN_NAME: Record<string, string> = {
  clap: 'clap',
  same: 'high five',
  muscle: 'strong',
  flame: 'fire',
  heart: 'heart',
  laugh: 'laugh',
  thumbs_up: 'thumbs up',
  eyes: 'eyes',
};

/** Spoken / visible name for a reaction value (custom emoji speak as themselves). */
export function reactionName(value: string): string {
  return isNamedReactionKind(value) ? SPOKEN_NAME[value] ?? value : value;
}

/** The emoji to draw — the server's `emoji` when present, else derived. */
export function summaryEmoji(summary: Pick<MessageReactionSummary, 'reaction' | 'emoji'>): string {
  return summary.emoji || reactionEmoji(summary.reaction);
}

/** The viewer's current reaction on a message (one per person), or null. */
export function viewerReaction(summaries: readonly MessageReactionSummary[]): string | null {
  return summaries.find((s) => s.reactedByMe && s.count > 0)?.reaction ?? null;
}

/**
 * Optimistically apply the viewer's new reaction (`next`, or null to clear):
 * their previous one loses a count (dropped at zero), the new one gains one.
 */
export function applyViewerReaction(
  summaries: readonly MessageReactionSummary[],
  next: string | null
): MessageReactionSummary[] {
  const out: MessageReactionSummary[] = [];
  for (const s of summaries) {
    if (s.reactedByMe) {
      if (s.reaction === next) return summaries.slice();
      const count = s.count - 1;
      if (count > 0) out.push({ ...s, count, reactedByMe: false });
    } else {
      out.push({ ...s });
    }
  }
  if (next) {
    const idx = out.findIndex((s) => s.reaction === next);
    if (idx === -1) {
      out.push({ reaction: next, emoji: reactionEmoji(next), count: 1, reactedByMe: true });
    } else {
      out[idx] = { ...out[idx], count: out[idx].count + 1, reactedByMe: true };
    }
  }
  return out;
}

/** Pills: at most 3 distinct emoji (most popular first) + the total count. */
export function pillSummary(summaries: readonly MessageReactionSummary[]): {
  emojis: string[];
  total: number;
} {
  const visible = summaries.filter((s) => s.count > 0);
  const sorted = [...visible].sort((a, b) => b.count - a.count);
  return {
    emojis: sorted.slice(0, 3).map(summaryEmoji),
    total: visible.reduce((n, s) => n + s.count, 0),
  };
}

/** "3 reactions: clap 2, heart 1. Activate to see who reacted." */
export function pillsAccessibleLabel(summaries: readonly MessageReactionSummary[]): string {
  const visible = summaries.filter((s) => s.count > 0).sort((a, b) => b.count - a.count);
  const total = visible.reduce((n, s) => n + s.count, 0);
  const parts = visible.map((s) => `${reactionName(s.reaction)} ${s.count}`).join(', ');
  return `${total} ${total === 1 ? 'reaction' : 'reactions'}: ${parts}. Activate to see who reacted.`;
}

/**
 * The inline "👏 Cheer" chip shows on activity posts about another member
 * (workouts, meals, streaks, goals…), never on your own and never on posts
 * with no person behind them (the daily summary).
 */
export function canCheer(message: ChatMessage, viewerId: string | null | undefined): boolean {
  if (message.kind !== 'system_event' || message.deletedAt || !message.system) return false;
  if (message.system.eventType === 'daily_summary') return false;
  const actorIds = message.system.actors.map((a) => a.id).filter(Boolean);
  if (actorIds.length === 0) return false;
  return !viewerId || !actorIds.includes(viewerId);
}

/**
 * Where the focused long-press menu sits: the reaction bar just above the
 * lifted message, the action list below, shifted to stay on screen.
 */
export function focusMenuTop(
  anchor: { top: number; height: number },
  viewportHeight: number,
  sizes: { bar: number; menu: number; gap?: number; margin?: number }
): number {
  const gap = sizes.gap ?? 8;
  const margin = sizes.margin ?? 12;
  const total = sizes.bar + gap + anchor.height + gap + sizes.menu;
  const preferred = anchor.top - sizes.bar - gap;
  const max = viewportHeight - margin - total;
  return Math.max(margin, Math.min(preferred, max));
}
