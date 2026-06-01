'use client';

import { useState } from 'react';

import {
  REACTION_KINDS,
  chatClient,
  type MessageReactionSummary,
  type ReactionKind,
} from '@/lib/api/circle-chat-client';
import { cn } from '@/lib/utils';

const REACTION_EMOJI: Record<ReactionKind, string> = {
  flame: '🔥',
  clap: '👏',
  eyes: '👀',
  same: '🙌',
  heart: '❤️',
  laugh: '😂',
};

interface ReactionBarProps {
  messageId: string;
  reactions: MessageReactionSummary[];
  /** Notifies the parent of the authoritative summaries returned by the server. */
  onChange?: (reactions: MessageReactionSummary[]) => void;
}

/**
 * Six-emoji tapback. Shows existing reaction chips (count + reactedByMe state)
 * and a "+" picker to add any of the six reactions. Toggling hits the
 * reaction endpoints and reports the server-authoritative summaries back up.
 */
export function ReactionBar({ messageId, reactions, onChange }: ReactionBarProps) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pending, setPending] = useState(false);

  const reactionsByKind = new Map<ReactionKind, MessageReactionSummary>();
  for (const r of reactions) reactionsByKind.set(r.reaction, r);

  const active = reactions.filter((r) => r.count > 0);

  const toggle = async (reaction: ReactionKind) => {
    if (pending) return;
    setPickerOpen(false);
    setPending(true);
    try {
      const existing = reactionsByKind.get(reaction);
      const result =
        existing?.reactedByMe
          ? await chatClient.removeReaction(messageId, reaction)
          : await chatClient.addReaction(messageId, reaction);
      onChange?.(result.reactions);
    } catch (err) {
      console.warn('[chat] reaction toggle failed', err);
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="mt-1 flex flex-wrap items-center gap-1.5">
      {active.map((r) => (
        <button
          key={r.reaction}
          type="button"
          disabled={pending}
          onClick={() => toggle(r.reaction)}
          className={cn(
            'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs transition-colors disabled:opacity-50',
            r.reactedByMe
              ? 'border-indigo-500/50 bg-indigo-500/20 text-indigo-200'
              : 'border-slate-700/60 bg-slate-800/60 text-gray-300 hover:bg-slate-700/60'
          )}
        >
          <span>{REACTION_EMOJI[r.reaction]}</span>
          <span className="tabular-nums">{r.count}</span>
        </button>
      ))}

      <div className="relative">
        <button
          type="button"
          disabled={pending}
          onClick={() => setPickerOpen((o) => !o)}
          aria-label="Add reaction"
          className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-slate-700/60 bg-slate-800/60 text-xs text-gray-400 transition-colors hover:bg-slate-700/60 disabled:opacity-50"
        >
          +
        </button>

        {pickerOpen && (
          <div className="absolute bottom-full left-0 z-20 mb-1 flex gap-0.5 rounded-full border border-slate-700/60 bg-slate-900/95 px-1.5 py-1 shadow-xl backdrop-blur-xl">
            {REACTION_KINDS.map((reaction) => (
              <button
                key={reaction}
                type="button"
                onClick={() => toggle(reaction)}
                aria-label={reaction}
                className={cn(
                  'flex h-7 w-7 items-center justify-center rounded-full text-base transition-transform hover:scale-125',
                  reactionsByKind.get(reaction)?.reactedByMe && 'bg-indigo-500/20'
                )}
              >
                {REACTION_EMOJI[reaction]}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
