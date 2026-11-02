'use client';

import { Loader2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { reactionName } from '@/components/chat/reaction-state';
import { Avatar } from '@/components/ui/avatar';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { chatClient, type MessageReactor } from '@/lib/api/circle-chat-client';
import { cn } from '@/lib/utils';

interface ReactorsDialogProps {
  messageId: string | null;
  viewerId: string | null | undefined;
  /** Bumps when the message's summaries change so an open dialog refreshes. */
  reactionsVersion: string;
  onOpenChange: (open: boolean) => void;
  /** "Tap to remove" on the viewer's own row. */
  onRemoveMine: () => void;
}

/** "Reactions" — who reacted with what, filter chips per emoji, your row first. */
export function ReactorsDialog({
  messageId,
  viewerId,
  reactionsVersion,
  onOpenChange,
  onRemoveMine,
}: ReactorsDialogProps) {
  const [reactors, setReactors] = useState<MessageReactor[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [filter, setFilter] = useState<string | null>(null);

  useEffect(() => {
    if (!messageId) {
      setReactors(null);
      setFilter(null);
      return;
    }
    let cancelled = false;
    setFailed(false);
    chatClient
      .listReactors(messageId)
      .then((data) => {
        if (!cancelled) setReactors(data.reactors);
      })
      .catch((err) => {
        console.warn('[chat] reactors load failed', err);
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [messageId, reactionsVersion]);

  const chips = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of reactors ?? []) counts.set(r.emoji, (counts.get(r.emoji) ?? 0) + 1);
    return Array.from(counts, ([emoji, count]) => ({ emoji, count })).sort((a, b) => b.count - a.count);
  }, [reactors]);

  const visible = (reactors ?? []).filter((r) => !filter || r.emoji === filter);

  return (
    <Dialog open={!!messageId} onOpenChange={onOpenChange}>
      <DialogContent className="bottom-0 top-auto max-h-[80vh] translate-y-0 gap-3 p-5 sm:bottom-auto sm:top-[50%] sm:translate-y-[-50%]">
        <DialogTitle className="text-base">Reactions</DialogTitle>
        <DialogDescription className="sr-only">Who reacted to this message</DialogDescription>

        {reactors && reactors.length > 0 && (
          <div role="tablist" aria-label="Filter by reaction" className="flex flex-wrap gap-1.5">
            <FilterChip selected={filter === null} onClick={() => setFilter(null)} label={`All ${reactors.length}`}>
              All {reactors.length}
            </FilterChip>
            {chips.map((c) => (
              <FilterChip
                key={c.emoji}
                selected={filter === c.emoji}
                onClick={() => setFilter(c.emoji)}
                label={`${c.emoji} ${c.count}`}
              >
                <span aria-hidden>{c.emoji}</span> {c.count}
              </FilterChip>
            ))}
          </div>
        )}

        <div className="min-h-[120px] overflow-y-auto">
          {failed ? (
            <p className="py-6 text-center text-sm text-gray-400">Could not load reactions.</p>
          ) : !reactors ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-gray-500" aria-label="Loading" />
            </div>
          ) : visible.length === 0 ? (
            <p className="py-6 text-center text-sm text-gray-400">No reactions yet.</p>
          ) : (
            <ul className="divide-y divide-slate-800/70">
              {visible.map((r) => {
                const isMe = !!viewerId && r.user_id === viewerId;
                const name = isMe ? 'You' : r.display_name || 'Member';
                const row = (
                  <>
                    <Avatar src={r.avatar_url ?? undefined} fallback={r.display_name || '?'} size="sm" />
                    <span className="min-w-0 flex-1 truncate text-left">
                      <span className="block truncate text-sm text-gray-100">{name}</span>
                      {isMe && <span className="block text-xs text-gray-400">Tap to remove</span>}
                    </span>
                    <span className="text-xl" aria-hidden>
                      {r.emoji}
                    </span>
                  </>
                );
                return (
                  <li key={r.user_id}>
                    {isMe ? (
                      <button
                        type="button"
                        onClick={onRemoveMine}
                        aria-label={`You reacted ${reactionName(r.reaction)}. Activate to remove`}
                        className="flex min-h-[48px] w-full items-center gap-3 rounded-lg px-1 py-2 hover:bg-slate-800/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
                      >
                        {row}
                      </button>
                    ) : (
                      <div
                        className="flex min-h-[48px] items-center gap-3 px-1 py-2"
                        aria-label={`${name} reacted ${reactionName(r.reaction)}`}
                      >
                        {row}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function FilterChip({
  selected,
  onClick,
  label,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      aria-label={label}
      onClick={onClick}
      className={cn(
        'min-h-[32px] rounded-full border px-3 text-xs focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400',
        selected
          ? 'border-indigo-500/60 bg-indigo-500/25 text-indigo-100'
          : 'border-slate-700 bg-slate-800/60 text-gray-300 hover:bg-slate-700/60'
      )}
    >
      {children}
    </button>
  );
}
