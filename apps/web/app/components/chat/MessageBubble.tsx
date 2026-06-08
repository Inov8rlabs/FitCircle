'use client';

import {
  Activity,
  Award,
  Flame,
  Sparkles,
  Trophy,
  UserPlus,
} from 'lucide-react';
import Image from 'next/image';
import { useState } from 'react';

import { ReactionBar } from '@/components/chat/ReactionBar';
import { Avatar } from '@/components/ui/avatar';
import type { ChatMessage, MessageReactionSummary } from '@/lib/api/circle-chat-client';
import { cn } from '@/lib/utils';

interface MessageBubbleProps {
  message: ChatMessage;
  isMine: boolean;
  /** true when the previous message is from the same sender (groups bubbles). */
  groupedWithPrevious: boolean;
  onReactionsChange: (messageId: string, reactions: MessageReactionSummary[]) => void;
  onReport?: (messageId: string) => void;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  });
}

/**
 * Renders a single timeline entry: a user_text/user_photo bubble, or a system
 * post via SystemPost. System posts always render the server-provided friendly
 * `body` — copy is never re-derived client-side.
 */
export function MessageBubble({
  message,
  isMine,
  groupedWithPrevious,
  onReactionsChange,
  onReport,
}: MessageBubbleProps) {
  if (message.kind === 'system_event') {
    return <SystemPost message={message} onReactionsChange={onReactionsChange} />;
  }

  return (
    <div className={cn('flex w-full gap-2', isMine ? 'flex-row-reverse' : 'flex-row')}>
      {/* Avatar (only on the first message of a group) */}
      <div className="w-8 flex-shrink-0">
        {!isMine && !groupedWithPrevious && (
          <Avatar
            src={message.sender?.avatarUrl ?? undefined}
            fallback={message.sender?.name ?? '?'}
            size="sm"
          />
        )}
      </div>

      <div className={cn('flex max-w-[78%] flex-col', isMine ? 'items-end' : 'items-start')}>
        {!isMine && !groupedWithPrevious && (
          <span className="mb-1 px-1 text-xs font-medium text-gray-400">
            {message.sender?.name ?? 'Member'}
          </span>
        )}

        <div
          className={cn(
            'rounded-2xl px-3.5 py-2 text-sm shadow-sm',
            isMine
              ? 'rounded-br-md bg-gradient-to-br from-indigo-600 to-purple-600 text-white'
              : 'rounded-bl-md border border-slate-700/50 bg-slate-800/70 text-gray-100'
          )}
        >
          {message.kind === 'user_photo' && message.photoUrl && (
            <div className="relative mb-1 h-48 w-48 max-w-full overflow-hidden rounded-lg">
              <Image
                src={message.photoUrl}
                alt="Shared photo"
                fill
                className="object-cover"
                sizes="192px"
              />
            </div>
          )}
          {message.body && <p className="whitespace-pre-wrap break-words">{message.body}</p>}
        </div>

        <div className="flex items-center gap-2 px-1">
          <ReactionBar
            messageId={message.id}
            reactions={message.reactions}
            onChange={(reactions) => onReactionsChange(message.id, reactions)}
          />
          <time className="mt-1 text-[10px] text-gray-500">{formatTime(message.createdAt)}</time>
          {!isMine && onReport && (
            <button
              type="button"
              onClick={() => onReport(message.id)}
              className="mt-1 text-[10px] text-gray-600 transition-colors hover:text-gray-400"
            >
              Report
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

const SYSTEM_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  workout_done: Activity,
  notable_meal: Sparkles,
  streak_milestone: Flame,
  circle_streak: Flame,
  quest_done: Trophy,
  challenge_milestone: Award,
  challenge_resolved: Trophy,
  daily_summary: Sparkles,
  member_joined: UserPlus,
  new_challenge: Award,
};

/**
 * System post renderer. Switches presentation on system.renderHint
 * (text/stat_card/completion_card/summary_card) but always displays the
 * server-provided `body` text — never re-derives copy. `body` is the fallback
 * for any card whose payload is missing or for the plain text hint.
 */
function SystemPost({
  message,
  onReactionsChange,
}: {
  message: ChatMessage;
  onReactionsChange: (messageId: string, reactions: MessageReactionSummary[]) => void;
}) {
  const system = message.system;
  const Icon = (system && SYSTEM_ICON[system.eventType]) || Sparkles;
  const hint = system?.renderHint ?? 'text';
  const body = message.body ?? '';

  // Plain text system events render as a slim centered chip.
  if (hint === 'text') {
    return (
      <div className="flex flex-col items-center gap-1 py-1.5">
        <div className="inline-flex items-center gap-1.5 rounded-full border border-slate-700/50 bg-slate-800/50 px-3 py-1 text-xs text-gray-400">
          <Icon className="h-3 w-3 text-indigo-400" />
          <span>{body}</span>
        </div>
        {message.reactions.some((r) => r.count > 0) && (
          <ReactionBar
            messageId={message.id}
            reactions={message.reactions}
            onChange={(reactions) => onReactionsChange(message.id, reactions)}
          />
        )}
      </div>
    );
  }

  const accent =
    hint === 'completion_card'
      ? 'from-green-500/15 to-emerald-500/10 border-green-500/30'
      : hint === 'summary_card'
        ? 'from-purple-500/15 to-indigo-500/10 border-purple-500/30'
        : 'from-orange-500/15 to-amber-500/10 border-orange-500/30';

  return (
    <div className="flex flex-col items-center py-1.5">
      <div
        className={cn(
          'w-full max-w-md rounded-xl border bg-gradient-to-br p-3.5 backdrop-blur-sm',
          accent
        )}
      >
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-slate-900/40">
            <Icon className="h-5 w-5 text-white" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="whitespace-pre-wrap break-words text-sm font-medium text-white">{body}</p>
            {system && system.actors.length > 0 && (
              <p className="mt-1 text-xs text-gray-400">
                {system.actors.map((a) => a.name).join(', ')}
              </p>
            )}
          </div>
        </div>
      </div>
      <ReactionBar
        messageId={message.id}
        reactions={message.reactions}
        onChange={(reactions) => onReactionsChange(message.id, reactions)}
      />
    </div>
  );
}
