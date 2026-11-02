'use client';

import { useCallback, useEffect, useRef } from 'react';

/** Long-press hold time (spec: ≈0.35 s). */
export const LONG_PRESS_MS = 350;
/** Two taps within this window are a double-tap (touch browsers don't all fire dblclick). */
export const DOUBLE_TAP_MS = 300;
const MOVE_TOLERANCE_PX = 10;

/** Double-click / double-tap never cheers on a link (or anything inside one). */
export function isOnLink(target: EventTarget | null): boolean {
  return target instanceof Element && !!target.closest('a[href], [role="link"]');
}

/** True when the page has a non-empty text selection that touches `el`. */
export function hasSelectionWithin(el: Element | null): boolean {
  if (!el || typeof window === 'undefined') return false;
  const sel = window.getSelection?.();
  if (!sel || sel.isCollapsed || sel.rangeCount === 0 || !sel.toString().trim()) return false;
  for (let i = 0; i < sel.rangeCount; i++) {
    if (sel.getRangeAt(i).intersectsNode(el)) return true;
  }
  return false;
}

interface Options {
  enabled: boolean;
  onOpenMenu: () => void;
  onDoubleTap?: () => void;
}

/**
 * Message gestures, one menu for all of them (no competing gestures):
 *  - touch / pen long-press, mouse right-click, and Enter / Space / ContextMenu /
 *    Shift+F10 on the focused message → the focused menu
 *  - double-click / double-tap → onDoubleTap (👏 cheer) — never on a link, and
 *    not when the gesture starts on text that is already selected
 */
export function useMessageGestures({ enabled, onOpenMenu, onDoubleTap }: Options) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const longPressed = useRef(false);
  const lastTap = useRef(0);
  const lastTouchDoubleTap = useRef(0);
  // Whether text in the message was already selected when the click sequence
  // began — then a double-click is about the selection, not a cheer. (The
  // dblclick itself selects a word, so the selection must be read before it.)
  const selectionAtSequenceStart = useRef(false);

  const cancel = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    start.current = null;
  }, []);

  useEffect(() => cancel, [cancel]);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (!enabled || e.pointerType === 'mouse') return;
      longPressed.current = false;
      start.current = { x: e.clientX, y: e.clientY };
      timer.current = setTimeout(() => {
        longPressed.current = true;
        timer.current = null;
        if (typeof navigator !== 'undefined') navigator.vibrate?.(10);
        onOpenMenu();
      }, LONG_PRESS_MS);
    },
    [enabled, onOpenMenu]
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const s = start.current;
      if (!s) return;
      if (Math.abs(e.clientX - s.x) > MOVE_TOLERANCE_PX || Math.abs(e.clientY - s.y) > MOVE_TOLERANCE_PX) cancel();
    },
    [cancel]
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent) => {
      const wasPending = !!timer.current;
      cancel();
      if (!enabled || e.pointerType === 'mouse' || !wasPending || longPressed.current) return;
      if (isOnLink(e.target) || hasSelectionWithin(e.currentTarget as Element)) {
        lastTap.current = 0;
        return;
      }
      const now = Date.now();
      if (now - lastTap.current < DOUBLE_TAP_MS) {
        lastTap.current = 0;
        lastTouchDoubleTap.current = now;
        onDoubleTap?.();
      } else {
        lastTap.current = now;
      }
    },
    [cancel, enabled, onDoubleTap]
  );

  const onContextMenu = useCallback(
    (e: React.MouseEvent) => {
      if (!enabled) return;
      e.preventDefault();
      // A touch long-press already opened the menu; the trailing contextmenu is a duplicate.
      if (longPressed.current) return;
      onOpenMenu();
    },
    [enabled, onOpenMenu]
  );

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.detail <= 1) selectionAtSequenceStart.current = hasSelectionWithin(e.currentTarget as Element);
  }, []);

  const onDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      if (!enabled || !onDoubleTap) return;
      // Touch double-taps are handled in onPointerUp; ignore the browser's
      // synthesized dblclick that can follow them.
      if (Date.now() - lastTouchDoubleTap.current < 600) return;
      // Links keep their own behaviour; a double-click that started on
      // already-selected text is a selection gesture, not a cheer.
      if (isOnLink(e.target) || selectionAtSequenceStart.current) return;
      e.preventDefault();
      window.getSelection?.()?.removeAllRanges();
      onDoubleTap();
    },
    [enabled, onDoubleTap]
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!enabled || e.target !== e.currentTarget) return;
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) {
        e.preventDefault();
        onOpenMenu();
      }
    },
    [enabled, onOpenMenu]
  );

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel: cancel,
    onPointerLeave: cancel,
    onContextMenu,
    onMouseDown,
    onDoubleClick,
    onKeyDown,
  };
}
