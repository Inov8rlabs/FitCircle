'use client';

import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Plus } from 'lucide-react';
import { useRef } from 'react';

import {
  pillSummary,
  pillsAccessibleLabel,
  reactionName,
} from '@/components/chat/reaction-state';
import {
  CHAT_REACTION_BAR,
  REACTION_EMOJI,
  type MessageReactionSummary,
} from '@/lib/api/circle-chat-client';
import { cn } from '@/lib/utils';

// Chat Reactions v2 building blocks (docs/CHAT_REACTIONS_V2.md):
//  - QuickReactionBar: 👏 🙌 💪 🔥 ❤️ 😂 ＋ inside the focused long-press menu
//  - EmojiGrid: the ＋ picker (curated grid, no extra dependency)
//  - ReactionPills: max 3 emoji + total on the bubble; opens the reactors dialog
//  - CheerChip: "👏 Cheer" / "👏 Cheered" on other members' activity posts (no count)
//  - ClapBurst: the brief 👏 burst for double-click / cheer (off under reduced motion)

interface QuickReactionBarProps {
  /** The viewer's current reaction (highlighted). */
  mine: string | null;
  onSelect: (value: string) => void;
  onOpenPicker: () => void;
  /** Lets the focus menu move focus into the bar on open. */
  firstButtonRef?: React.Ref<HTMLButtonElement>;
}

export function QuickReactionBar({ mine, onSelect, onOpenPicker, firstButtonRef }: QuickReactionBarProps) {
  const customMine = mine && !(CHAT_REACTION_BAR as string[]).includes(mine) ? mine : null;

  return (
    <div
      role="toolbar"
      aria-label="Reactions"
      className="inline-flex items-center gap-0.5 rounded-full border border-slate-700/60 bg-slate-900/95 px-1.5 py-1 shadow-2xl backdrop-blur-xl"
    >
      {CHAT_REACTION_BAR.map((kind, i) => {
        const selected = mine === kind;
        return (
          <button
            key={kind}
            ref={i === 0 ? firstButtonRef : undefined}
            type="button"
            aria-pressed={selected}
            aria-label={selected ? `Remove ${reactionName(kind)}` : `React ${reactionName(kind)}`}
            onClick={() => onSelect(kind)}
            className={cn(
              'flex h-11 w-11 items-center justify-center rounded-full text-[22px] transition-transform focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 motion-safe:hover:scale-110 motion-safe:active:scale-125',
              selected && 'bg-indigo-500/30'
            )}
          >
            {REACTION_EMOJI[kind]}
          </button>
        );
      })}
      {customMine && (
        <button
          type="button"
          aria-pressed
          aria-label={`Remove ${customMine}`}
          onClick={() => onSelect(customMine)}
          className="flex h-11 w-11 items-center justify-center rounded-full bg-indigo-500/30 text-[22px] focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
        >
          {customMine}
        </button>
      )}
      <button
        type="button"
        aria-label="More reactions"
        onClick={onOpenPicker}
        className="flex h-11 w-11 items-center justify-center rounded-full text-gray-300 hover:bg-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
      >
        <Plus className="h-5 w-5" />
      </button>
    </div>
  );
}

// Curated, dependency-free emoji set for the ＋ picker. Fitness-leaning first.
export const EMOJI_GRID: Array<{ label: string; emojis: string[] }> = [
  {
    label: 'Cheer',
    emojis: ['👏', '🙌', '💪', '🔥', '🎉', '🥳', '🏆', '🥇', '⭐', '🌟', '✨', '💯', '🚀', '⚡', '👊', '🤜', '✊', '🫶', '👍', '🙏'],
  },
  {
    label: 'Feelings',
    emojis: ['😂', '🤣', '😊', '😁', '😍', '🥰', '😎', '🤩', '😮', '😅', '🥲', '😢', '😭', '😤', '🤯', '🫡', '🤔', '😴', '🥵', '😬'],
  },
  {
    label: 'Hearts',
    emojis: ['❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '💖', '💗'],
  },
  {
    label: 'Active',
    emojis: ['🏃', '🚴', '🏋️', '🧘', '🏊', '⛹️', '🤸', '🥾', '⚽', '🏀', '🎾', '🏓', '👟', '⏱️', '🎯', '🧗'],
  },
  {
    label: 'Food',
    emojis: ['🥗', '🥑', '🍎', '🍌', '🥦', '🍳', '🥩', '🍣', '🍕', '🍔', '🍩', '☕', '💧', '🥤', '🍵', '🫐'],
  },
];

interface EmojiGridProps {
  mine: string | null;
  onSelect: (emoji: string) => void;
}

/** Lightweight emoji grid popover body. Arrow keys move between cells. */
export function EmojiGrid({ mine, onSelect }: EmojiGridProps) {
  const gridRef = useRef<HTMLDivElement>(null);

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const keys: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 8, ArrowUp: -8 };
    const delta = keys[e.key];
    if (!delta || !gridRef.current) return;
    const cells = Array.from(gridRef.current.querySelectorAll<HTMLButtonElement>('button[data-emoji]'));
    const idx = cells.indexOf(document.activeElement as HTMLButtonElement);
    if (idx === -1) return;
    e.preventDefault();
    cells[Math.max(0, Math.min(cells.length - 1, idx + delta))]?.focus();
  };

  return (
    <div
      ref={gridRef}
      onKeyDown={onKeyDown}
      role="dialog"
      aria-label="Choose an emoji"
      className="max-h-64 w-[min(22rem,calc(100vw-2rem))] overflow-y-auto rounded-2xl border border-slate-700/60 bg-slate-900/95 p-2 shadow-2xl backdrop-blur-xl"
    >
      {EMOJI_GRID.map((group) => (
        <div key={group.label} role="group" aria-label={group.label} className="mb-1.5 last:mb-0">
          <p className="px-1 pb-1 text-[11px] font-medium uppercase tracking-wide text-gray-500">{group.label}</p>
          <div className="grid grid-cols-8 gap-0.5">
            {group.emojis.map((emoji) => (
              <button
                key={emoji}
                type="button"
                data-emoji={emoji}
                aria-label={emoji}
                aria-pressed={mine === emoji}
                onClick={() => onSelect(emoji)}
                className={cn(
                  'flex h-10 w-10 items-center justify-center rounded-lg text-xl hover:bg-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400',
                  mine === emoji && 'bg-indigo-500/30'
                )}
              >
                {emoji}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

interface ReactionPillsProps {
  reactions: MessageReactionSummary[];
  /** Opens the "Reactions" dialog (who reacted with what). */
  onOpen: () => void;
  className?: string;
}

/** "👏🔥❤️ 7" on the bubble's inner bottom corner. Click / long-press / context → reactors. */
export function ReactionPills({ reactions, onOpen, className }: ReactionPillsProps) {
  const { emojis, total } = pillSummary(reactions);
  if (total === 0) return null;
  const mine = reactions.some((r) => r.reactedByMe && r.count > 0);

  return (
    <button
      type="button"
      data-testid="reaction-pills"
      aria-label={pillsAccessibleLabel(reactions)}
      onClick={(e) => {
        e.stopPropagation();
        onOpen();
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onOpen();
      }}
      onDoubleClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      className={cn(
        'inline-flex min-h-[28px] items-center gap-1 rounded-full border px-2 py-0.5 text-xs shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400',
        mine
          ? 'border-indigo-500/60 bg-indigo-950 text-indigo-100'
          : 'border-slate-700 bg-slate-900 text-gray-200',
        className
      )}
    >
      <span aria-hidden className="tracking-tight">
        {emojis.join('')}
      </span>
      {total > 1 && (
        <span aria-hidden className="tabular-nums">
          {total}
        </span>
      )}
    </button>
  );
}

interface CheerChipProps {
  cheered: boolean;
  onCheer: () => void;
}

/**
 * Peloton-style high five on an activity post: "👏 Cheer" / "👏 Cheered" (tap
 * again to undo). No count here — counts live in the pills, which open the
 * reactors dialog.
 */
export function CheerChip({ cheered, onCheer }: CheerChipProps) {
  return (
    <button
      type="button"
      aria-pressed={cheered}
      aria-label={cheered ? 'Cheered. Activate to undo' : 'Cheer'}
      onClick={(e) => {
        e.stopPropagation();
        onCheer();
      }}
      onDoubleClick={(e) => e.stopPropagation()}
      className={cn(
        'inline-flex min-h-[36px] items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400',
        cheered
          ? 'border-amber-400/60 bg-amber-400/20 text-amber-100'
          : 'border-slate-600/70 bg-slate-900/60 text-gray-200 hover:bg-slate-800'
      )}
    >
      <span aria-hidden>👏</span>
      <span>{cheered ? 'Cheered' : 'Cheer'}</span>
    </button>
  );
}

/** A brief 👏 burst over the bubble. Renders nothing under prefers-reduced-motion. */
export function ClapBurst({ burstKey }: { burstKey: number }) {
  const reduceMotion = useReducedMotion();
  if (reduceMotion) return null;
  return (
    <AnimatePresence>
      {burstKey > 0 && (
        <motion.span
          key={burstKey}
          aria-hidden
          initial={{ opacity: 0, scale: 0.4, y: 0 }}
          animate={{ opacity: [0, 1, 1, 0], scale: [0.4, 1.4, 1.2, 1], y: -28 }}
          transition={{ duration: 0.7, ease: 'easeOut' }}
          className="pointer-events-none absolute left-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-1/2 text-3xl"
        >
          👏
        </motion.span>
      )}
    </AnimatePresence>
  );
}
