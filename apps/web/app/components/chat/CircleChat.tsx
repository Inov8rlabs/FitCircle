'use client';

import { Loader2, MessageCircle, Send } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { MessageBubble } from '@/components/chat/MessageBubble';
import { Button } from '@/components/ui/button';
import {
  chatClient,
  type ChatMessage,
  type MessageReactionSummary,
} from '@/lib/api/circle-chat-client';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/auth-store';

interface CircleChatProps {
  circleId: string;
}

const PAGE_SIZE = 30;

/** Generate a client id for optimistic de-dupe (uuid v4 where available). */
function newClientId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Circle chat: paginated timeline + realtime inserts + optimistic send.
 *
 * Timeline state is held oldest-first (so it renders top-to-bottom). The list
 * API returns newest-first, so we reverse on ingest. Realtime INSERTs on
 * circle_messages append; our own optimistic echoes are de-duped by clientId.
 */
export function CircleChat({ circleId }: CircleChatProps) {
  const { user } = useAuthStore();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [nextBefore, setNextBefore] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  // clientIds we've sent optimistically — used to de-dupe the realtime echo.
  const pendingClientIds = useRef<Set<string>>(new Set());
  // Ids currently in the timeline — lets the (unfiltered) reaction subscription
  // ignore reactions on messages we aren't displaying.
  const messageIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    messageIdsRef.current = new Set(messages.map((m) => m.id));
  }, [messages]);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'auto') => {
    bottomRef.current?.scrollIntoView({ behavior });
  }, []);

  // Insert/replace a message keeping the list ordered oldest-first and unique
  // by id, collapsing optimistic rows that share a clientId.
  const upsertMessage = useCallback((incoming: ChatMessage) => {
    setMessages((prev) => {
      // Replace an optimistic row with the same clientId (the server echo).
      if (incoming.clientId) {
        const optimisticIdx = prev.findIndex(
          (m) => m.clientId === incoming.clientId && m.id !== incoming.id
        );
        if (optimisticIdx !== -1) {
          const next = [...prev];
          next[optimisticIdx] = incoming;
          return next;
        }
      }
      // De-dupe by id (realtime can fire after the POST response already landed).
      const existingIdx = prev.findIndex((m) => m.id === incoming.id);
      if (existingIdx !== -1) {
        const next = [...prev];
        next[existingIdx] = incoming;
        return next;
      }
      return [...prev, incoming];
    });
  }, []);

  // Initial load (newest page).
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    chatClient
      .listMessages(circleId, { limit: PAGE_SIZE })
      .then((result) => {
        if (cancelled) return;
        setMessages([...result.messages].reverse()); // newest-first -> oldest-first
        setHasMore(result.hasMore);
        setNextBefore(result.nextBefore);
      })
      .catch((err) => {
        if (cancelled) return;
        console.warn('[chat] initial load failed', err);
        setError('Could not load chat. Pull to retry.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [circleId]);

  // Mark read once the timeline is loaded.
  useEffect(() => {
    if (!loading && messages.length >= 0) {
      void chatClient.markRead(circleId).catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, circleId]);

  // Scroll to bottom after the first load.
  useEffect(() => {
    if (!loading) scrollToBottom('auto');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);

  // Realtime: subscribe to inserts on circle_messages for this circle.
  useEffect(() => {
    const channel = supabase
      .channel(`circle-chat:${circleId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'circle_messages',
          filter: `fitcircle_id=eq.${circleId}`,
        },
        (payload) => {
          const row = payload.new as Record<string, any>;
          // Skip our own optimistic echo (handled by the POST response).
          if (row.client_id && pendingClientIds.current.has(row.client_id)) {
            return;
          }
          // The realtime payload is the snake_case DB row; refetch the latest
          // page to pick up the fully-mapped DTO (sender, reactions, system block).
          chatClient
            .listMessages(circleId, { limit: PAGE_SIZE })
            .then((result) => {
              for (const m of [...result.messages].reverse()) upsertMessage(m);
              scrollToBottom('smooth');
            })
            .catch((err) => console.warn('[chat] realtime refetch failed', err));
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'circle_message_reactions',
        },
        (payload) => {
          const row = (payload.new ?? payload.old) as Record<string, any>;
          const messageId = row?.message_id;
          if (!messageId) return;
          // The reactions row isn't scoped by circle, so only react when the
          // change touches a message currently in our timeline. Summaries are
          // user-scoped (reactedByMe), so refetch to stay accurate.
          if (!messageIdsRef.current.has(messageId)) return;
          chatClient
            .listMessages(circleId, { limit: PAGE_SIZE })
            .then((result) => {
              for (const m of [...result.messages].reverse()) upsertMessage(m);
            })
            .catch(() => {});
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [circleId, upsertMessage, scrollToBottom]);

  const loadOlder = useCallback(async () => {
    if (!hasMore || loadingMore || !nextBefore) return;
    setLoadingMore(true);
    const el = scrollRef.current;
    const prevHeight = el?.scrollHeight ?? 0;
    try {
      const result = await chatClient.listMessages(circleId, {
        before: nextBefore,
        limit: PAGE_SIZE,
      });
      setMessages((prev) => [...[...result.messages].reverse(), ...prev]);
      setHasMore(result.hasMore);
      setNextBefore(result.nextBefore);
      // Preserve scroll position after prepending.
      requestAnimationFrame(() => {
        if (el) el.scrollTop = el.scrollHeight - prevHeight;
      });
    } catch (err) {
      console.warn('[chat] load older failed', err);
    } finally {
      setLoadingMore(false);
    }
  }, [circleId, hasMore, loadingMore, nextBefore]);

  const handleReactionsChange = useCallback(
    (messageId: string, reactions: MessageReactionSummary[]) => {
      setMessages((prev) =>
        prev.map((m) => (m.id === messageId ? { ...m, reactions } : m))
      );
    },
    []
  );

  const handleReport = useCallback(async (messageId: string) => {
    const reason = window.prompt('Report this message — optional reason:');
    if (reason === null) return; // cancelled
    try {
      await chatClient.reportMessage(messageId, reason || null);
      window.alert('Thanks — this message has been reported.');
    } catch (err) {
      console.warn('[chat] report failed', err);
    }
  }, []);

  const handleSend = useCallback(async () => {
    const text = draft.trim();
    if (!text || sending || !user) return;

    const clientId = newClientId();
    pendingClientIds.current.add(clientId);

    const optimistic: ChatMessage = {
      id: `optimistic-${clientId}`,
      circleId,
      kind: 'user_text',
      sender: { id: user.id, name: user.name, avatarUrl: user.avatar ?? null },
      body: text,
      photoUrl: null,
      system: null,
      reactions: [],
      clientId,
      createdAt: new Date().toISOString(),
    };

    setDraft('');
    upsertMessage(optimistic);
    setSending(true);
    requestAnimationFrame(() => scrollToBottom('smooth'));

    try {
      const saved = await chatClient.sendMessage(circleId, {
        kind: 'user_text',
        body: text,
        clientId,
      });
      upsertMessage(saved); // replaces optimistic row via clientId match
    } catch (err) {
      console.warn('[chat] send failed', err);
      // Roll back the optimistic row and restore the draft.
      setMessages((prev) => prev.filter((m) => m.clientId !== clientId));
      setDraft(text);
      setError('Message failed to send.');
    } finally {
      pendingClientIds.current.delete(clientId);
      setSending(false);
    }
  }, [draft, sending, user, circleId, upsertMessage, scrollToBottom]);

  return (
    <div className="flex h-[70vh] min-h-[420px] flex-col">
      {/* Message timeline */}
      <div ref={scrollRef} className="flex-1 space-y-2 overflow-y-auto px-1 py-2">
        {loading ? (
          <div className="flex h-full items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-gray-500" />
          </div>
        ) : error && messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-center text-sm text-gray-400">
            <MessageCircle className="mb-2 h-8 w-8 text-gray-600" />
            {error}
          </div>
        ) : messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <MessageCircle className="mb-3 h-10 w-10 text-gray-600" />
            <p className="text-sm text-gray-400">No messages yet</p>
            <p className="mt-1 text-xs text-gray-500">Say hi to your circle!</p>
          </div>
        ) : (
          <>
            {hasMore && (
              <div className="flex justify-center pb-1">
                <button
                  type="button"
                  onClick={() => void loadOlder()}
                  disabled={loadingMore}
                  className="rounded-full border border-slate-700/50 bg-slate-800/50 px-3 py-1 text-xs text-gray-400 transition-colors hover:bg-slate-700/50 disabled:opacity-50"
                >
                  {loadingMore ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    'Load earlier messages'
                  )}
                </button>
              </div>
            )}
            {messages.map((m, i) => {
              const prev = messages[i - 1];
              const isMine = !!user && m.sender?.id === user.id;
              const groupedWithPrevious =
                !!prev &&
                prev.kind !== 'system_event' &&
                m.kind !== 'system_event' &&
                prev.sender?.id === m.sender?.id;
              return (
                <MessageBubble
                  key={m.id}
                  message={m}
                  isMine={isMine}
                  groupedWithPrevious={groupedWithPrevious}
                  onReactionsChange={handleReactionsChange}
                  onReport={handleReport}
                />
              );
            })}
            <div ref={bottomRef} />
          </>
        )}
      </div>

      {/* Composer */}
      <div className="mt-2 flex items-end gap-2 border-t border-slate-800/60 pt-3">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void handleSend();
            }
          }}
          rows={1}
          placeholder="Message your circle…"
          className="max-h-32 min-h-[40px] flex-1 resize-none rounded-xl border border-slate-700/60 bg-slate-800/60 px-3 py-2 text-sm text-gray-100 placeholder:text-gray-500 focus:border-indigo-500/60 focus:outline-none focus:ring-1 focus:ring-indigo-500/40"
        />
        <Button
          type="button"
          size="icon"
          onClick={() => void handleSend()}
          disabled={!draft.trim() || sending}
          className="h-10 w-10 flex-shrink-0 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700"
        >
          {sending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Send className="h-4 w-4" />
          )}
        </Button>
      </div>
    </div>
  );
}

export default CircleChat;
