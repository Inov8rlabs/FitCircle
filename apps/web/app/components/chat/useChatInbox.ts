'use client';

import { useEffect } from 'react';
import { create } from 'zustand';

import { chatClient, type ChatInbox, type InboxChat } from '@/lib/api/circle-chat-client';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/auth-store';

/** Window event any chat surface fires after it marks a chat read. */
export const CHAT_INBOX_REFRESH_EVENT = 'fitcircle:chat-inbox-refresh';

/** Ask every mounted inbox consumer (top-nav badge, switcher) to re-fetch. */
export function requestChatInboxRefresh(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(CHAT_INBOX_REFRESH_EVENT));
}

interface ChatInboxState {
  inbox: ChatInbox | null;
  loading: boolean;
  refresh: () => Promise<void>;
}

let inflight: Promise<void> | null = null;

/** One shared inbox for the whole app (GET /api/mobile/chats); concurrent refreshes coalesce. */
export const useChatInboxStore = create<ChatInboxState>((set) => ({
  inbox: null,
  loading: false,
  refresh: () => {
    if (inflight) return inflight;
    set({ loading: true });
    inflight = chatClient
      .listChats()
      .then((inbox) => set({ inbox }))
      .catch((err) => console.warn('[chat] inbox load failed', err))
      .finally(() => {
        inflight = null;
        set({ loading: false });
      });
    return inflight;
  },
}));

/** Switcher order: unread (non-muted) first, then the server's last-activity order. Pure. */
export function switcherOrder(chats: readonly InboxChat[]): InboxChat[] {
  const unread = chats.filter((c) => !c.muted && c.unread_count > 0);
  const rest = chats.filter((c) => !(!c.muted && c.unread_count > 0));
  return [...unread, ...rest];
}

/** "99+" above 99, else the number. Pure. */
export function badgeLabel(count: number): string {
  return count > 99 ? '99+' : String(count);
}

let liveSubscribers = 0;
let liveTeardown: (() => void) | null = null;

/** One realtime subscription for every consumer: any new circle message nudges a re-fetch. */
function startLive(refresh: () => Promise<void>): () => void {
  liveSubscribers += 1;
  if (liveSubscribers === 1) {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const nudge = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void refresh(), 1200);
    };
    // Unfiltered: RLS scopes delivery to the viewer's circles.
    const channel = supabase
      .channel('chat-inbox')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'circle_messages' }, nudge)
      .subscribe();
    const onFocus = () => void refresh();
    const onVisible = () => document.visibilityState === 'visible' && void refresh();
    window.addEventListener(CHAT_INBOX_REFRESH_EVENT, onFocus);
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisible);
    liveTeardown = () => {
      if (timer) clearTimeout(timer);
      void supabase.removeChannel(channel);
      window.removeEventListener(CHAT_INBOX_REFRESH_EVENT, onFocus);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }
  return () => {
    liveSubscribers -= 1;
    if (liveSubscribers === 0) {
      liveTeardown?.();
      liveTeardown = null;
    }
  };
}

/**
 * The signed-in viewer's chat inbox, kept fresh (mount, focus, realtime
 * inserts, and after any chat is marked read). null until the first load.
 */
export function useChatInbox(): { inbox: ChatInbox | null; refresh: () => Promise<void> } {
  const inbox = useChatInboxStore((s) => s.inbox);
  const refresh = useChatInboxStore((s) => s.refresh);
  const signedIn = useAuthStore((s) => !!s.user);

  useEffect(() => {
    if (!signedIn) return;
    void refresh();
    return startLive(refresh);
  }, [signedIn, refresh]);

  return { inbox: signedIn ? inbox : null, refresh };
}
