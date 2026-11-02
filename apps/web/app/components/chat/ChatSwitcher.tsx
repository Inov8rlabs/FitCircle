'use client';

import { BellOff, ChevronDown } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { badgeLabel, switcherOrder } from '@/components/chat/useChatInbox';
import { AvatarCircle } from '@/components/ui/ios';
import type { InboxChat } from '@/lib/api/circle-chat-client';
import { cn } from '@/lib/utils';

/** "2:05 PM" today, "Mon" this week, else "Oct 30". Pure. */
export function inboxTime(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  if (now.getTime() - d.getTime() < 6 * 86_400_000) return d.toLocaleDateString('en-US', { weekday: 'short' });
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/** "Raveesh: Let's go!" / "Let's go!" / "No messages yet". Pure. */
export function inboxPreview(chat: InboxChat): string {
  const m = chat.last_message;
  if (!m) return 'No messages yet';
  return m.sender_display_name && m.kind !== 'system_event' ? `${m.sender_display_name}: ${m.preview}` : m.preview;
}

/**
 * The circle list shared by the chat header switcher and the top-nav chat
 * button's menu: avatar, name, last message + time, unread count; unread
 * first, then most recent activity.
 */
export function ChatSwitcherList({
  chats,
  currentCircleId,
  onSelect,
}: {
  chats: readonly InboxChat[];
  currentCircleId?: string | null;
  onSelect: (circleId: string) => void;
}) {
  return (
    <ul role="listbox" aria-label="Your circle chats" className="max-h-[60vh] overflow-y-auto py-1" data-testid="chat-switcher-list">
      {switcherOrder(chats).map((chat) => {
        const current = chat.circle_id === currentCircleId;
        const unread = chat.unread_count > 0;
        return (
          <li key={chat.circle_id} role="option" aria-selected={current}>
            <button
              type="button"
              onClick={() => onSelect(chat.circle_id)}
              data-testid="chat-switcher-row"
              className={cn(
                'flex min-h-[56px] w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition-colors hover:bg-white/5 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400',
                current && 'bg-white/10'
              )}
            >
              <AvatarCircle name={chat.circle_name} src={chat.circle_avatar_url} size={36} />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5">
                  <span className={cn('truncate text-sm text-white', unread ? 'font-semibold' : 'font-medium')}>
                    {chat.circle_name}
                  </span>
                  {chat.muted && <BellOff className="h-3 w-3 shrink-0 text-fg-tertiary" aria-label="Muted" />}
                  <span className="ml-auto shrink-0 text-[11px] text-fg-tertiary">
                    {inboxTime(chat.last_message?.created_at ?? chat.last_activity_at)}
                  </span>
                </span>
                <span className="flex items-center gap-2">
                  <span className={cn('block flex-1 truncate text-xs', unread ? 'text-gray-200' : 'text-fg-secondary')}>
                    {inboxPreview(chat)}
                  </span>
                  {unread && (
                    <span
                      className={cn(
                        'inline-flex h-5 min-w-[20px] shrink-0 items-center justify-center rounded-full px-1.5 text-[11px] font-bold leading-none',
                        chat.muted ? 'bg-white/15 text-fg-secondary' : 'bg-brand-indigo text-white'
                      )}
                      aria-label={`${chat.unread_count} unread`}
                    >
                      {badgeLabel(chat.unread_count)}
                    </span>
                  )}
                </span>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Chat header title: the circle name, with a chevron that opens the circle
 * switcher when the viewer has more than one chat. Picking a circle calls
 * onSwitch (the page swaps the chat in place).
 */
export function ChatCircleSwitcher({
  circleId,
  circleName,
  chats,
  onOpen,
  onSwitch,
}: {
  circleId: string;
  circleName: string;
  chats: readonly InboxChat[];
  onOpen?: () => void;
  onSwitch: (toCircleId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const otherUnread = chats.filter((c) => c.circle_id !== circleId && !c.muted && c.unread_count > 0).length;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (chats.length < 2) {
    return <h3 className="truncate text-headline font-semibold text-white">{circleName}</h3>;
  }

  return (
    <div ref={rootRef} className="relative min-w-0">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        data-testid="chat-switcher-toggle"
        onClick={() => {
          if (!open) onOpen?.();
          setOpen((v) => !v);
        }}
        className="flex min-h-[44px] max-w-full items-center gap-1.5 rounded-xl px-2 text-left transition-colors hover:bg-white/5 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
      >
        <span className="truncate text-headline font-semibold text-white">{circleName}</span>
        <ChevronDown className={cn('h-4 w-4 shrink-0 text-fg-secondary transition-transform', open && 'rotate-180')} aria-hidden />
        {otherUnread > 0 && (
          <span className="h-2 w-2 shrink-0 rounded-full bg-brand-indigo" aria-label="Unread in other circles" />
        )}
      </button>
      {open && (
        <div className="absolute left-0 top-full z-40 mt-1 w-[min(22rem,calc(100vw-2rem))] rounded-2xl border border-hairline bg-surface p-1 shadow-ios-lg">
          <ChatSwitcherList
            chats={chats}
            currentCircleId={circleId}
            onSelect={(id) => {
              setOpen(false);
              if (id !== circleId) onSwitch(id);
            }}
          />
        </div>
      )}
    </div>
  );
}
