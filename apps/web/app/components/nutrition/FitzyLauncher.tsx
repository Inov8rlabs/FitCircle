'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { Sparkles, X } from 'lucide-react';
import { useEffect, useState } from 'react';

import { FitzyChat } from './FitzyChat';

interface FitzyLauncherProps {
  /** Style of the trigger: a labelled nav item (desktop) or compact icon (mobile bar). */
  variant?: 'nav' | 'icon' | 'mobile-row';
  onOpen?: () => void;
}

/**
 * Global Fitzy entry point — a header/nav button that opens the multi-turn Fitzy
 * chat in a dismissible right-side drawer. Reachable from every authed page via
 * the Navbar.
 */
export function FitzyLauncher({ variant = 'nav', onOpen }: FitzyLauncherProps) {
  const [open, setOpen] = useState(false);

  // Lock scroll + allow Escape to close while the drawer is open.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const handleOpen = () => {
    onOpen?.();
    setOpen(true);
  };

  const trigger =
    variant === 'icon' ? (
      <button
        type="button"
        onClick={handleOpen}
        aria-label="Open Fitzy"
        className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-fuchsia-400 transition-colors hover:bg-slate-800 hover:text-fuchsia-300"
      >
        <Sparkles className="h-5 w-5" />
      </button>
    ) : variant === 'mobile-row' ? (
      <button
        type="button"
        onClick={handleOpen}
        className="flex w-full items-center gap-3 rounded-lg px-4 py-3 text-sm font-medium text-gray-300 transition-colors hover:bg-slate-800 hover:text-white"
      >
        <Sparkles className="h-5 w-5 text-fuchsia-400" />
        Ask Fitzy
      </button>
    ) : (
      <button
        type="button"
        onClick={handleOpen}
        className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-gray-300 transition-colors hover:bg-slate-800 hover:text-white"
      >
        <Sparkles className="h-4 w-4 text-fuchsia-400" />
        Fitzy
      </button>
    );

  return (
    <>
      {trigger}

      <AnimatePresence>
        {open && (
          <motion.div
            className="fixed inset-0 z-[60] flex justify-end"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
          >
            {/* Backdrop */}
            <button
              type="button"
              aria-label="Close Fitzy"
              onClick={() => setOpen(false)}
              className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            />

            {/* Drawer */}
            <motion.aside
              role="dialog"
              aria-label="Fitzy chat"
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 30, stiffness: 300 }}
              className="relative flex h-full w-full max-w-md flex-col border-l border-slate-800 bg-slate-950 shadow-2xl"
            >
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="absolute right-3 top-3 z-10 rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-slate-800 hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>
              <div className="h-full pt-1">
                <FitzyChat fill />
              </div>
            </motion.aside>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
