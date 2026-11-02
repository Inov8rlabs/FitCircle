'use client';

import { MessagesSquare } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { ChatSwitcherList } from '@/components/chat/ChatSwitcher';
import { LONG_PRESS_MS } from '@/components/chat/useMessageGestures';
import { badgeLabel, useChatInbox } from '@/components/chat/useChatInbox';
import { AnalyticsEvents, analytics } from '@/lib/analytics';
import { cn } from '@/lib/utils';

/** Where a circle's chat lives on web (the circle page's Chat tab). */
export function chatHref(circleId: string): string {
  return `/fitcircles/${circleId}?tab=chat`;
}

/**
 * Top-nav chat button (docs/CHAT_NAV_NOTIFICATIONS_CHEERS.md §1): unread badge
 * (number, or a dot when only muted circles have unread), opens the chat the
 * server picked (newest unread, else most recent). Right-click / long-press
 * opens the circle list. Hidden for viewers in no circle.
 */
export function ChatNavButton({ className }: { className?: string }) {
  const router = useRouter();
  const { inbox } = useChatInbox();
  const [menuOpen, setMenuOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressed = useRef(false);

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMenuOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  useEffect(() => () => {
    if (pressTimer.current) clearTimeout(pressTimer.current);
  }, []);

  if (!inbox || inbox.chats.length === 0 || !inbox.default_circle_id) return null;

  const total = inbox.total_unread;
  const dot = total === 0 && inbox.muted_unread > 0;
  const label = total > 0 ? `Chats, ${total} unread` : dot ? 'Chats, unread in muted circles' : 'Chats';

  const open = (circleId: string, entry: 'top_nav' | 'switcher') => {
    setMenuOpen(false);
    analytics.track(AnalyticsEvents.chatOpened({ entry, circle_id: circleId }));
    void router.push(chatHref(circleId));
  };

  const openMenu = () => {
    analytics.track(AnalyticsEvents.chatSwitcherOpened({ source: 'long_press', circle_count: inbox.chats.length }));
    setMenuOpen(true);
  };

  return (
    <div ref={rootRef} className={cn('relative', className)}>
      <button
        type="button"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={menuOpen}
        data-testid="chat-nav-button"
        onClick={() => {
          if (longPressed.current) {
            longPressed.current = false;
            return;
          }
          open(inbox.default_circle_id!, 'top_nav');
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          if (!menuOpen) openMenu();
        }}
        onPointerDown={(e) => {
          if (e.pointerType === 'mouse') return;
          longPressed.current = false;
          pressTimer.current = setTimeout(() => {
            longPressed.current = true;
            navigator.vibrate?.(10);
            openMenu();
          }, LONG_PRESS_MS);
        }}
        onPointerUp={() => pressTimer.current && clearTimeout(pressTimer.current)}
        onPointerLeave={() => pressTimer.current && clearTimeout(pressTimer.current)}
        className="relative flex h-10 w-10 items-center justify-center rounded-full text-fg-secondary transition-colors hover:bg-white/5 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
      >
        <MessagesSquare className="h-5 w-5" aria-hidden />
        {total > 0 && (
          <span
            data-testid="chat-nav-badge"
            className="absolute -right-0.5 -top-0.5 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-brand-indigo px-1 text-[10px] font-bold leading-none text-white ring-2 ring-canvas"
          >
            {badgeLabel(total)}
          </span>
        )}
        {dot && (
          <span
            data-testid="chat-nav-dot"
            className="absolute right-1 top-1 h-2.5 w-2.5 rounded-full bg-fg-secondary ring-2 ring-canvas"
          />
        )}
      </button>
      {menuOpen && (
        <div className="absolute right-0 top-full z-50 mt-2 w-[min(22rem,calc(100vw-2rem))] rounded-2xl border border-hairline bg-surface p-1 shadow-ios-lg">
          <ChatSwitcherList chats={inbox.chats} onSelect={(id) => open(id, 'switcher')} />
        </div>
      )}
    </div>
  );
}
