'use client';

import { useCallback, useEffect, useRef } from 'react';

import { LONG_PRESS_MS } from '@/components/chat/useMessageGestures';

const MOVE_TOLERANCE_PX = 10;

/**
 * Leaderboard row gestures that open the cheer sheet: touch / pen long-press
 * and mouse right-click (desktop has no long-press; rows also show a visible
 * Cheer button on hover / focus). A long-press swallows the click that
 * follows it, so the row's own tap action (day breakdown) doesn't also fire.
 * `enabled = false` (your own row) → plain handlers that do nothing.
 */
export function useCheerGesture(enabled: boolean, onCheer: () => void) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const fired = useRef(false);

  const cancel = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    start.current = null;
  }, []);
  useEffect(() => cancel, [cancel]);

  return {
    onPointerDown: (e: React.PointerEvent) => {
      fired.current = false;
      if (!enabled || e.pointerType === 'mouse') return;
      start.current = { x: e.clientX, y: e.clientY };
      timer.current = setTimeout(() => {
        fired.current = true;
        timer.current = null;
        if (typeof navigator !== 'undefined') navigator.vibrate?.(10);
        onCheer();
      }, LONG_PRESS_MS);
    },
    onPointerMove: (e: React.PointerEvent) => {
      const s = start.current;
      if (s && (Math.abs(e.clientX - s.x) > MOVE_TOLERANCE_PX || Math.abs(e.clientY - s.y) > MOVE_TOLERANCE_PX)) cancel();
    },
    onPointerUp: cancel,
    onPointerCancel: cancel,
    onPointerLeave: cancel,
    onContextMenu: (e: React.MouseEvent) => {
      if (!enabled) return;
      e.preventDefault();
      if (fired.current) return; // the touch long-press already opened it
      onCheer();
    },
    /** Wrap the row's click: false when the click is the tail of a long-press. */
    shouldHandleClick: () => {
      if (fired.current) {
        fired.current = false;
        return false;
      }
      return true;
    },
  };
}
