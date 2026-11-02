'use client';

import { Loader2, Plus, Send } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { chatHref } from '@/components/chat/ChatNavButton';
import { EmojiGrid } from '@/components/chat/ReactionBar';
import { requestChatInboxRefresh } from '@/components/chat/useChatInbox';
import { cheerChipsFor, cheerStatLine, firstName, goalPctBucket } from '@/components/circles/cheer-options';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AvatarCircle } from '@/components/ui/ios';
import { AnalyticsEvents, analytics } from '@/lib/analytics';
import { ChatApiError, chatClient, type CheerSource } from '@/lib/api/circle-chat-client';
import { reactionAnalyticsValue } from '@/lib/chat/reactions';
import type { ChatReactionValue } from '@/lib/types/circle-chat';
import { cn } from '@/lib/utils';

export interface CheerTarget {
  user_id: string;
  display_name: string;
  avatar_url?: string | null;
  /** Today's steps on the board the sender saw (null when private / not a steps board). */
  steps?: number | null;
  /** % of today's goal (steps board) or of the circle goal (legacy board). */
  goalPct?: number | null;
}

/**
 * Leaderboard cheer sheet: one-tap chips (sent immediately), ＋ any emoji, or a
 * short message. The server posts it into the circle chat and pushes the
 * member; numbers in the chat come from the server, never from here.
 */
export function CheerSheet({
  circleId,
  target,
  source,
  onClose,
  onSent,
}: {
  circleId: string;
  target: CheerTarget | null;
  source: CheerSource;
  onClose: () => void;
  onSent?: (userId: string) => void;
}) {
  const router = useRouter();
  const [text, setText] = useState('');
  const [picker, setPicker] = useState(false);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    setText('');
    setPicker(false);
    setSending(false);
  }, [target?.user_id]);

  if (!target) return null;
  const name = firstName(target.display_name);
  const stat = cheerStatLine({ steps: target.steps, goalPct: target.goalPct });
  const chips = cheerChipsFor(target.goalPct);

  const send = async (reaction: ChatReactionValue, message: string | null) => {
    if (sending) return;
    setSending(true);
    try {
      await chatClient.sendCheer(circleId, {
        to_user_id: target.user_id,
        reaction,
        ...(message ? { message } : {}),
        source,
      });
      analytics.track(
        AnalyticsEvents.memberCheerSent({
          circle_id: circleId,
          reaction: reactionAnalyticsValue(reaction),
          has_message: !!message,
          source,
          recipient_goal_pct_bucket: goalPctBucket(target.goalPct),
        })
      );
      requestChatInboxRefresh();
      onSent?.(target.user_id);
      toast.success(`Cheer sent to ${name}`, {
        action: {
          label: 'View in chat',
          onClick: () => {
            analytics.track(AnalyticsEvents.chatOpened({ entry: 'cheer_toast', circle_id: circleId }));
            void router.push(chatHref(circleId));
          },
        },
      });
      onClose();
    } catch (err) {
      if (err instanceof ChatApiError && err.status === 429) {
        toast(err.message || `You just cheered ${name} — give it a minute`);
        onClose();
      } else {
        toast.error(err instanceof ChatApiError && err.message ? err.message : "Couldn't send your cheer. Try again.");
        setSending(false);
      }
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent data-testid="cheer-sheet" className="max-w-sm">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <AvatarCircle name={target.display_name} src={target.avatar_url} size={44} />
            <div className="min-w-0 text-left">
              <DialogTitle className="truncate">Cheer {target.display_name}</DialogTitle>
              <DialogDescription>{stat ?? 'Send some encouragement'}</DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {picker ? (
          <EmojiGrid mine={null} onSelect={(emoji) => void send(emoji, text.trim() || null)} />
        ) : (
          <div className="flex flex-wrap gap-2" role="group" aria-label="Quick cheers">
            {chips.map((chip) => (
              <button
                key={chip.text}
                type="button"
                disabled={sending}
                onClick={() => void send(chip.reaction, chip.text)}
                data-testid="cheer-chip"
                className="inline-flex min-h-[44px] items-center gap-1.5 rounded-full border border-glass bg-surface-raised/60 px-3.5 text-sm font-medium text-white transition hover:border-white/20 hover:bg-surface-raised active:scale-95 disabled:opacity-50"
              >
                <span aria-hidden>{chip.emoji}</span>
                {chip.text}
              </button>
            ))}
            <button
              type="button"
              disabled={sending}
              onClick={() => setPicker(true)}
              aria-label="Choose another emoji"
              className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-glass bg-surface-raised/60 text-fg-secondary transition hover:text-white disabled:opacity-50"
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>
        )}

        <form
          className="mt-2 flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const message = text.trim();
            if (message) void send('clap', message);
          }}
        >
          <input
            value={text}
            onChange={(e) => setText(e.target.value.slice(0, 280))}
            placeholder={`Say something to ${name}`}
            aria-label={`Message to ${name}`}
            maxLength={280}
            className="h-11 min-w-0 flex-1 rounded-xl border border-slate-700/60 bg-slate-800/60 px-3 text-sm text-gray-100 placeholder:text-gray-500 focus:border-indigo-500/60 focus:outline-none focus:ring-1 focus:ring-indigo-500/40"
          />
          <button
            type="submit"
            disabled={!text.trim() || sending}
            aria-label="Send cheer"
            className={cn(
              'flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 text-white transition disabled:opacity-40'
            )}
          >
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
