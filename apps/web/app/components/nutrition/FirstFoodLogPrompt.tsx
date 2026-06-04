'use client';

import { Activity, Sparkles, Users, X } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

import { FoodSearch } from './FoodSearch';
import { PhotoLog } from './PhotoLog';
import { VoiceLog } from './VoiceLog';

interface FirstFoodLogPromptProps {
  /** Render only when the user has no food logs yet. */
  hasLogs: boolean;
  onLogged?: () => void;
}

/**
 * §6.14 — lightweight first-run nudge (NOT a setup wizard). Goal: <90s to the
 * first nutrition log. Snap a meal / log your usual → then offer to share with a
 * circle and connect a tracker. Dismissible; shown only when the user has zero logs.
 */
export function FirstFoodLogPrompt({ hasLogs, onLogged }: FirstFoodLogPromptProps) {
  const [dismissed, setDismissed] = useState(false);
  const [logged, setLogged] = useState(false);

  if (hasLogs || dismissed) return null;

  const handleLogged = () => {
    setLogged(true);
    onLogged?.();
  };

  return (
    <section
      aria-labelledby="first-log-heading"
      className="relative mb-6 overflow-hidden rounded-2xl border border-indigo-500/30 bg-gradient-to-br from-indigo-500/10 via-slate-900/60 to-fuchsia-500/10 p-5 backdrop-blur-xl"
    >
      <button
        type="button"
        onClick={() => setDismissed(true)}
        aria-label="Dismiss getting-started prompt"
        className="absolute right-3 top-3 rounded-md p-1 text-gray-400 hover:bg-slate-700/60 hover:text-white"
      >
        <X className="h-4 w-4" aria-hidden="true" />
      </button>

      {!logged ? (
        <>
          <div className="mb-3 flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-500/20 text-indigo-300">
              <Sparkles className="h-5 w-5" aria-hidden="true" />
            </span>
            <div>
              <h2 id="first-log-heading" className="text-lg font-semibold text-white">
                Snap your meal or log your usual
              </h2>
              <p className="text-sm text-gray-300">
                Your first food log takes under a minute — no setup needed.
              </p>
            </div>
          </div>

          <div className="space-y-3">
            <PhotoLog onLogged={handleLogged} />
            <VoiceLog onLogged={handleLogged} />
            <FoodSearch />
          </div>
        </>
      ) : (
        <>
          <div className="mb-3 flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-500/20 text-emerald-300">
              <Sparkles className="h-5 w-5" aria-hidden="true" />
            </span>
            <div>
              <h2 id="first-log-heading" className="text-lg font-semibold text-white">
                Nice — that&apos;s your first log!
              </h2>
              <p className="text-sm text-gray-300">A couple of quick ways to get more out of it.</p>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Link
              href="/fitcircles"
              className="flex items-start gap-3 rounded-lg border border-slate-700/60 bg-slate-800/50 p-3 transition-colors hover:bg-slate-700/50"
            >
              <Users className="mt-0.5 h-5 w-5 shrink-0 text-indigo-300" aria-hidden="true" />
              <span>
                <span className="block text-sm font-medium text-white">
                  Share with your circle
                </span>
                <span className="block text-xs text-gray-400">
                  Post meals to a FitCircle for gentle accountability.
                </span>
              </span>
            </Link>

            <Link
              href="/settings/health"
              className="flex items-start gap-3 rounded-lg border border-slate-700/60 bg-slate-800/50 p-3 transition-colors hover:bg-slate-700/50"
            >
              <Activity className="mt-0.5 h-5 w-5 shrink-0 text-emerald-300" aria-hidden="true" />
              <span>
                <span className="block text-sm font-medium text-white">Connect a tracker</span>
                <span className="block text-xs text-gray-400">
                  Sync from Apple Health, Health Connect, or MyFitnessPal.
                </span>
              </span>
            </Link>
          </div>

          <button
            type="button"
            onClick={() => setDismissed(true)}
            className="mt-3 text-xs font-medium text-gray-400 hover:text-white"
          >
            Done for now
          </button>
        </>
      )}
    </section>
  );
}
