'use client';

import { useCallback, useRef } from 'react';

import { applyViewerReaction, viewerReaction } from '@/components/chat/reaction-state';
import { AnalyticsEvents, analytics } from '@/lib/analytics';
import type { ChatReactionSource } from '@/lib/analytics/events.generated';
import {
  chatClient,
  type ChatMessage,
  type MessageReactionSummary,
} from '@/lib/api/circle-chat-client';
import { reactionAnalyticsValue } from '@/lib/chat/reactions';

export type ReactionSource = ChatReactionSource;

/**
 * One reaction per person per message, applied optimistically: set / replace /
 * clear, then reconcile with the server's summaries (rolled back on failure).
 */
export function useChatReaction(
  message: ChatMessage,
  onReactionsChange: (messageId: string, reactions: MessageReactionSummary[]) => void
) {
  const inFlight = useRef(false);
  const mine = viewerReaction(message.reactions);

  const commit = useCallback(
    async (next: string | null, source: ReactionSource) => {
      if (inFlight.current) return;
      const previous = message.reactions;
      const current = viewerReaction(previous);
      if (next === current) return;
      inFlight.current = true;
      onReactionsChange(message.id, applyViewerReaction(previous, next));
      try {
        const result = next
          ? await chatClient.setReaction(message.id, next)
          : await chatClient.clearReaction(message.id);
        onReactionsChange(message.id, result.reactions);
        if (next) {
          analytics.track(
            AnalyticsEvents.chatReactionSent({
              reaction: reactionAnalyticsValue(next),
              circle_id: message.circleId,
              source,
              replaced: current !== null,
            })
          );
        } else if (current) {
          analytics.track(
            AnalyticsEvents.chatReactionRemoved({
              reaction: reactionAnalyticsValue(current),
              circle_id: message.circleId,
              source,
            })
          );
        }
      } catch (err) {
        console.warn('[chat] reaction failed', err);
        onReactionsChange(message.id, previous);
      } finally {
        inFlight.current = false;
      }
    },
    [message.id, message.circleId, message.reactions, onReactionsChange]
  );

  /** Tapping your current reaction removes it; anything else sets/replaces it. */
  const toggle = useCallback(
    (value: string, source: ReactionSource) => commit(mine === value ? null : value, source),
    [commit, mine]
  );

  const clear = useCallback((source: ReactionSource) => commit(null, source), [commit]);

  return { mine, toggle, clear };
}
