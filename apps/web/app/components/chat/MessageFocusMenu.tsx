'use client';

import { motion, useReducedMotion } from 'framer-motion';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { focusMenuTop } from '@/components/chat/reaction-state';
import { EmojiGrid, QuickReactionBar } from '@/components/chat/ReactionBar';
import { cn } from '@/lib/utils';

export interface FocusMenuAction {
  label: string;
  onSelect: () => void;
  destructive?: boolean;
}

interface MessageFocusMenuProps {
  /** Bounding box of the long-pressed bubble/card (viewport coords). */
  anchor: DOMRect;
  align: 'start' | 'end' | 'center';
  /** The lifted copy of the message. */
  preview: React.ReactNode;
  /** Reactions off for unsent/failed rows (actions only). */
  showReactions: boolean;
  mine: string | null;
  actions: FocusMenuAction[];
  onReact: (value: string, fromPicker: boolean) => void;
  onClose: () => void;
}

const BAR_HEIGHT = 52;
const ACTION_ROW = 44;
const PICKER_HEIGHT = 264;

/**
 * The single long-press / right-click menu (iMessage-style): background dims
 * and blurs, the message lifts in place, the reaction bar sits above it and the
 * actions below. Esc, a click outside, or picking anything dismisses it.
 */
export function MessageFocusMenu({
  anchor,
  align,
  preview,
  showReactions,
  mine,
  actions,
  onReact,
  onClose,
}: MessageFocusMenuProps) {
  const reduceMotion = useReducedMotion();
  const [pickerOpen, setPickerOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const firstReactionRef = useRef<HTMLButtonElement>(null);
  const [viewport, setViewport] = useState(() => ({
    w: typeof window === 'undefined' ? 1024 : window.innerWidth,
    h: typeof window === 'undefined' ? 768 : window.innerHeight,
  }));

  useLayoutEffect(() => {
    const onResize = () => setViewport({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Focus moves into the menu; Esc closes; Tab stays inside (simple trap).
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    (firstReactionRef.current ?? panelRef.current?.querySelector<HTMLElement>('button'))?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== 'Tab' || !panelRef.current) return;
      const focusables = Array.from(panelRef.current.querySelectorAll<HTMLElement>('button:not([disabled])'));
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      previouslyFocused?.focus?.();
    };
  }, [onClose]);

  if (typeof document === 'undefined') return null;

  const below = pickerOpen ? PICKER_HEIGHT : actions.length * ACTION_ROW + 8;
  const top = focusMenuTop({ top: anchor.top, height: anchor.height }, viewport.h, {
    bar: showReactions ? BAR_HEIGHT : 0,
    menu: below,
  });
  const width = Math.min(anchor.width, viewport.w - 24);
  const horizontal =
    align === 'end'
      ? { right: Math.max(12, viewport.w - anchor.right) }
      : align === 'start'
        ? { left: Math.max(12, anchor.left) }
        : { left: Math.max(12, anchor.left + anchor.width / 2 - width / 2) };
  const itemsAlign = align === 'end' ? 'items-end' : align === 'start' ? 'items-start' : 'items-center';

  return createPortal(
    <div className="fixed inset-0 z-50" data-testid="message-focus-menu">
      <motion.div
        aria-hidden
        className="absolute inset-0 bg-black/55 backdrop-blur-sm"
        initial={reduceMotion ? false : { opacity: 0 }}
        animate={{ opacity: 1 }}
        onClick={onClose}
        onContextMenu={(e) => {
          e.preventDefault();
          onClose();
        }}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Message actions"
        className={cn('absolute flex flex-col gap-2', itemsAlign)}
        style={{ top, ...horizontal, maxWidth: viewport.w - 24 }}
      >
        {showReactions && (
          <motion.div
            initial={reduceMotion ? false : { opacity: 0, y: 6, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.16 }}
          >
            <QuickReactionBar
              mine={mine}
              firstButtonRef={firstReactionRef}
              onSelect={(value) => onReact(value, false)}
              onOpenPicker={() => setPickerOpen(true)}
            />
          </motion.div>
        )}

        <motion.div
          className="pointer-events-none"
          style={{ width }}
          initial={reduceMotion ? false : { scale: 1 }}
          animate={reduceMotion ? undefined : { scale: 1.03 }}
          transition={{ duration: 0.16 }}
        >
          {preview}
        </motion.div>

        {pickerOpen ? (
          <EmojiGrid mine={mine} onSelect={(emoji) => onReact(emoji, true)} />
        ) : (
          actions.length > 0 && (
            <motion.ul
              role="menu"
              initial={reduceMotion ? false : { opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.16 }}
              className="min-w-[200px] overflow-hidden rounded-xl border border-slate-700/60 bg-slate-900/95 py-1 shadow-2xl backdrop-blur-xl"
            >
              {actions.map((action) => (
                <li key={action.label} role="none">
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      onClose();
                      action.onSelect();
                    }}
                    className={cn(
                      'flex min-h-[44px] w-full items-center px-4 text-left text-sm hover:bg-slate-800 focus:bg-slate-800 focus:outline-none',
                      action.destructive ? 'text-red-400' : 'text-gray-100'
                    )}
                  >
                    {action.label}
                  </button>
                </li>
              ))}
            </motion.ul>
          )
        )}
      </div>
    </div>,
    document.body
  );
}
