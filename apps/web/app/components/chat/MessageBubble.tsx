'use client';

import {
  Activity,
  Award,
  Flame,
  Smile,
  Sparkles,
  Trophy,
  UserPlus,
} from 'lucide-react';
import Image from 'next/image';
import { useCallback, useRef, useState } from 'react';

import { MessageFocusMenu, type FocusMenuAction } from '@/components/chat/MessageFocusMenu';
import { canCheer } from '@/components/chat/reaction-state';
import { CheerChip, ClapBurst, ReactionPills } from '@/components/chat/ReactionBar';
import { ReactorsDialog } from '@/components/chat/ReactorsDialog';
import { useChatReaction, type ReactionSource } from '@/components/chat/useChatReaction';
import { useMessageGestures } from '@/components/chat/useMessageGestures';
import { Avatar } from '@/components/ui/avatar';
import type { ChatMessage, MessageCheer, MessageReactionSummary } from '@/lib/api/circle-chat-client';
import { cn } from '@/lib/utils';

interface MessageBubbleProps {
  message: ChatMessage;
  isMine: boolean;
  /** The signed-in viewer (cheer chip is hidden on posts about them). */
  viewerId?: string | null;
  /** true when the previous message is from the same sender (groups bubbles). */
  groupedWithPrevious: boolean;
  onReactionsChange: (messageId: string, reactions: MessageReactionSummary[]) => void;
  onReport?: (messageId: string) => void;
  onEdit?: (messageId: string) => void;
  onDelete?: (messageId: string) => void;
}

// Edit grace window (mirrors the server-enforced 15-minute contract; the
// affordance is hidden after it, but the API is the source of truth).
const EDIT_WINDOW_MS = 15 * 60 * 1000;

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** "Ani cheered Raveesh" from the viewer's point of view. Pure. */
export function cheerHeadline(
  cheer: Pick<MessageCheer, 'to_user_id' | 'to_display_name'>,
  senderName: string,
  isMine: boolean,
  viewerId: string | null | undefined
): { actor: string; target: string } {
  const toMe = !!viewerId && cheer.to_user_id === viewerId;
  return {
    actor: isMine ? 'You' : senderName || 'Someone',
    target: toMe ? 'you' : cheer.to_display_name || 'a member',
  };
}

/** "2,732 steps · 34%" (null when the snapshot is missing). Pure. */
export function cheerStatChip(cheer: Pick<MessageCheer, 'stat_snapshot'>): string | null {
  const s = cheer.stat_snapshot;
  if (!s) return null;
  const steps = `${s.today_steps.toLocaleString('en-US')} steps`;
  return typeof s.goal_pct_today === 'number' ? `${steps} · ${s.goal_pct_today}%` : steps;
}

function copyText(text: string) {
  void navigator.clipboard?.writeText(text).catch(() => {});
}

/**
 * Message interactions shared by bubbles and system cards (Chat Reactions v2):
 * one focused menu (long-press / right-click / keyboard), double-click = 👏,
 * reactors dialog from the pills.
 */
function useMessageInteractions(
  message: ChatMessage,
  onReactionsChange: MessageBubbleProps['onReactionsChange'],
  canReact: boolean
) {
  const anchorRef = useRef<HTMLDivElement>(null);
  const [menuAnchor, setMenuAnchor] = useState<DOMRect | null>(null);
  const [reactorsOpen, setReactorsOpen] = useState(false);
  const [burst, setBurst] = useState(0);
  const { mine, toggle, clear } = useChatReaction(message, onReactionsChange);

  const openMenu = useCallback(() => {
    const rect = anchorRef.current?.getBoundingClientRect();
    if (rect) setMenuAnchor(rect);
  }, []);
  const closeMenu = useCallback(() => setMenuAnchor(null), []);

  const cheer = useCallback(
    (source: ReactionSource) => {
      if (mine !== 'clap') setBurst((n) => n + 1);
      void toggle('clap', source);
    },
    [mine, toggle]
  );

  const gestures = useMessageGestures({
    enabled: true,
    onOpenMenu: openMenu,
    onDoubleTap: canReact ? () => cheer('double_tap') : undefined,
  });

  const react = useCallback(
    (value: string, fromPicker: boolean) => {
      closeMenu();
      if (value === 'clap' && mine !== 'clap') setBurst((n) => n + 1);
      void toggle(value, fromPicker ? 'emoji_picker' : 'long_press');
    },
    [closeMenu, mine, toggle]
  );

  return {
    anchorRef,
    menuAnchor,
    openMenu,
    closeMenu,
    reactorsOpen,
    setReactorsOpen,
    burst,
    mine,
    cheer,
    clear,
    gestures,
    react,
  };
}

/**
 * Renders a single timeline entry: a user_text/user_photo bubble, or a system
 * post via SystemPost. System posts always render the server-provided friendly
 * `body` — copy is never re-derived client-side.
 */
export function MessageBubble(props: MessageBubbleProps) {
  const { message, isMine } = props;

  if (message.kind === 'system_event') {
    return (
      <SystemPost
        message={message}
        viewerId={props.viewerId}
        onReactionsChange={props.onReactionsChange}
      />
    );
  }

  // Tombstone: an italic placeholder — no reactions, no menu.
  if (message.deletedAt) {
    return (
      <div className={cn('flex w-full gap-2', isMine ? 'flex-row-reverse' : 'flex-row')}>
        <div className="w-8 flex-shrink-0" />
        <div className={cn('flex max-w-[78%] flex-col', isMine ? 'items-end' : 'items-start')}>
          <div className="rounded-2xl border border-slate-800/60 bg-slate-900/40 px-3.5 py-2 text-sm italic text-gray-500">
            Message deleted
          </div>
          <time className="mt-1 px-1 text-[10px] text-gray-500">
            {formatTime(message.createdAt)}
          </time>
        </div>
      </div>
    );
  }

  return <UserBubble {...props} />;
}

function UserBubble({
  message,
  isMine,
  viewerId,
  groupedWithPrevious,
  onReactionsChange,
  onReport,
  onEdit,
  onDelete,
}: MessageBubbleProps) {
  // Optimistic (unsent) rows have a synthetic id the server doesn't know.
  const isPending = message.id.startsWith('optimistic-');
  const ui = useMessageInteractions(message, onReactionsChange, !isPending);

  const canEdit =
    isMine &&
    !!onEdit &&
    message.kind === 'user_text' &&
    !message.cheer && // a cheer's text is generated from its data; the server refuses edits
    Date.now() - new Date(message.createdAt).getTime() < EDIT_WINDOW_MS;

  const actions: FocusMenuAction[] = [];
  if (message.body) actions.push({ label: 'Copy', onSelect: () => copyText(message.body ?? '') });
  if (canEdit) actions.push({ label: 'Edit', onSelect: () => onEdit?.(message.id) });
  if (isMine && onDelete) actions.push({ label: 'Delete', onSelect: () => onDelete(message.id), destructive: true });
  if (!isMine && onReport) actions.push({ label: 'Report', onSelect: () => onReport(message.id), destructive: true });

  const hasPills = message.reactions.some((r) => r.count > 0);
  const senderName = isMine ? 'You' : message.sender?.name || 'Member';
  const cheer = message.cheer ?? null;

  const bubble = cheer ? (
    <CheerBubbleBody cheer={cheer} isMine={isMine} senderName={message.sender?.name ?? ''} viewerId={viewerId} />
  ) : (
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
          <Image src={message.photoUrl} alt="Shared photo" fill className="object-cover" sizes="192px" />
        </div>
      )}
      {message.body && <p className="whitespace-pre-wrap break-words">{message.body}</p>}
    </div>
  );

  return (
    <div className={cn('group flex w-full gap-2', isMine ? 'flex-row-reverse' : 'flex-row')}>
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

        <div className={cn('flex items-center gap-1', isMine ? 'flex-row-reverse' : 'flex-row')}>
          <div
            ref={ui.anchorRef}
            tabIndex={0}
            role="group"
            aria-label={`${senderName}: ${message.body ?? 'photo'}. Press Enter for reactions and actions${isPending ? '' : ', double-click to cheer'}.`}
            className={cn(
              'relative touch-manipulation select-text rounded-2xl focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400',
              hasPills && 'mb-3',
              ui.menuAnchor && 'invisible'
            )}
            {...ui.gestures}
          >
            {bubble}
            <ClapBurst burstKey={ui.burst} />
            {hasPills && (
              <ReactionPills
                reactions={message.reactions}
                onOpen={() => ui.setReactorsOpen(true)}
                className={cn('absolute -bottom-4', isMine ? 'left-2' : 'right-2')}
              />
            )}
          </div>

          {/* Desktop hover / keyboard affordance for the same focused menu. */}
          <button
            type="button"
            aria-label="React or more actions"
            onClick={ui.openMenu}
            className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-gray-500 opacity-0 transition-opacity hover:bg-slate-800 hover:text-gray-300 focus:opacity-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 group-hover:opacity-100"
          >
            <Smile className="h-4 w-4" />
          </button>
        </div>

        <div className="flex items-center gap-2 px-1">
          <time className="mt-1 text-[10px] text-gray-500">{formatTime(message.createdAt)}</time>
          {message.editedAt && <span className="mt-1 text-[10px] text-gray-600">(edited)</span>}
        </div>
      </div>

      {ui.menuAnchor && (
        <MessageFocusMenu
          anchor={ui.menuAnchor}
          align={isMine ? 'end' : 'start'}
          preview={bubble}
          showReactions={!isPending}
          mine={ui.mine}
          actions={actions}
          onReact={ui.react}
          onClose={ui.closeMenu}
        />
      )}

      <ReactorsDialog
        messageId={ui.reactorsOpen ? message.id : null}
        viewerId={viewerId}
        reactionsVersion={reactionsVersion(message.reactions)}
        onOpenChange={ui.setReactorsOpen}
        onRemoveMine={() => {
          ui.setReactorsOpen(false);
          void ui.clear('pills_sheet');
        }}
      />
    </div>
  );
}

function reactionsVersion(reactions: MessageReactionSummary[]): string {
  return reactions.map((r) => `${r.reaction}:${r.count}`).join(',');
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
 * (text/stat_card/completion_card/summary_card/meal_card) but always displays
 * the server-provided `body` text — never re-derives copy. Activity posts about
 * another member get the inline "👏 Cheer" chip.
 */
function SystemPost({
  message,
  viewerId,
  onReactionsChange,
}: {
  message: ChatMessage;
  viewerId?: string | null;
  onReactionsChange: MessageBubbleProps['onReactionsChange'];
}) {
  const ui = useMessageInteractions(message, onReactionsChange, true);
  const system = message.system;
  const Icon = (system && SYSTEM_ICON[system.eventType]) || Sparkles;
  const hint = system?.renderHint ?? 'text';
  const body = message.body ?? '';
  const hasPills = message.reactions.some((r) => r.count > 0);
  const showCheer = canCheer(message, viewerId);

  const actions: FocusMenuAction[] = body ? [{ label: 'Copy', onSelect: () => copyText(body) }] : [];

  const accent =
    hint === 'completion_card'
      ? 'from-green-500/15 to-emerald-500/10 border-green-500/30'
      : hint === 'summary_card'
        ? 'from-purple-500/15 to-indigo-500/10 border-purple-500/30'
        : 'from-orange-500/15 to-amber-500/10 border-orange-500/30';

  // Plain text system events render as a slim centered chip.
  const card =
    hint === 'text' ? (
      <div className="inline-flex items-center gap-1.5 rounded-full border border-slate-700/50 bg-slate-800/50 px-3 py-1 text-xs text-gray-400">
        <Icon className="h-3 w-3 text-indigo-400" />
        <span>{body}</span>
      </div>
    ) : (
      <div className={cn('w-full rounded-xl border bg-gradient-to-br p-3.5 backdrop-blur-sm', accent)}>
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-slate-900/40">
            <Icon className="h-5 w-5 text-white" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="whitespace-pre-wrap break-words text-sm font-medium text-white">{body}</p>
            {system && system.actors.length > 0 && (
              <p className="mt-1 text-xs text-gray-400">{system.actors.map((a) => a.name).join(', ')}</p>
            )}
          </div>
        </div>
      </div>
    );

  return (
    <div className="flex flex-col items-center gap-1 py-1.5">
      <div
        ref={ui.anchorRef}
        tabIndex={0}
        role="group"
        aria-label={`${body}. Press Enter for reactions, double-click to cheer.`}
        className={cn(
          'relative touch-manipulation rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400',
          hint === 'text' ? 'max-w-full' : 'w-full max-w-md',
          hasPills && 'mb-3',
          ui.menuAnchor && 'invisible'
        )}
        {...ui.gestures}
      >
        {card}
        <ClapBurst burstKey={ui.burst} />
        {hasPills && (
          <ReactionPills
            reactions={message.reactions}
            onOpen={() => ui.setReactorsOpen(true)}
            className="absolute -bottom-4 right-3"
          />
        )}
      </div>

      {showCheer && (
        <CheerChip cheered={ui.mine === 'clap'} onCheer={() => ui.cheer('cheer_button')} />
      )}

      {ui.menuAnchor && (
        <MessageFocusMenu
          anchor={ui.menuAnchor}
          align="center"
          preview={card}
          showReactions
          mine={ui.mine}
          actions={actions}
          onReact={ui.react}
          onClose={ui.closeMenu}
        />
      )}

      <ReactorsDialog
        messageId={ui.reactorsOpen ? message.id : null}
        viewerId={viewerId}
        reactionsVersion={reactionsVersion(message.reactions)}
        onOpenChange={ui.setReactorsOpen}
        onRemoveMine={() => {
          ui.setReactorsOpen(false);
          void ui.clear('pills_sheet');
        }}
      />
    </div>
  );
}

/**
 * A leaderboard cheer in the timeline: "👏 Ani cheered Raveesh", the optional
 * message, and the server's stat snapshot chip. Highlighted for the member
 * cheered. (Shipped clients show the plain `body` instead.)
 */
function CheerBubbleBody({
  cheer,
  isMine,
  senderName,
  viewerId,
}: {
  cheer: MessageCheer;
  isMine: boolean;
  senderName: string;
  viewerId?: string | null;
}) {
  const { actor, target } = cheerHeadline(cheer, senderName, isMine, viewerId);
  const toMe = !!viewerId && cheer.to_user_id === viewerId;
  const stat = cheerStatChip(cheer);
  return (
    <div
      data-testid="cheer-bubble"
      className={cn(
        'rounded-2xl border px-3.5 py-2.5 text-sm shadow-sm',
        isMine ? 'rounded-br-md' : 'rounded-bl-md',
        toMe
          ? 'border-amber-400/50 bg-gradient-to-br from-amber-500/25 to-orange-500/15 text-white ring-1 ring-amber-400/40'
          : 'border-indigo-400/30 bg-gradient-to-br from-indigo-600/30 to-purple-600/20 text-white'
      )}
    >
      <p className="flex items-center gap-1.5 font-medium">
        <span aria-hidden className="text-lg leading-none">{cheer.emoji}</span>
        <span>
          {actor} cheered <strong className="font-semibold">{target}</strong>
        </span>
      </p>
      {cheer.message && <p className="mt-1 whitespace-pre-wrap break-words text-gray-100">{cheer.message}</p>}
      {stat && (
        <span className="mt-2 inline-flex items-center rounded-full bg-white/10 px-2 py-0.5 text-[11px] font-medium tabular-nums text-gray-200">
          {stat}
        </span>
      )}
    </div>
  );
}
