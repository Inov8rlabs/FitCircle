'use client';

import { motion } from 'framer-motion';
import { ArrowRight, Loader2, MailX } from 'lucide-react';
import Link from 'next/link';

export type UnsubscribeState = 'confirm' | 'loading' | 'done' | 'invalid' | 'error';

export function UnsubscribeView({ state, onConfirm }: { state: UnsubscribeState; onConfirm?: () => void }) {
  const copy = {
    confirm: {
      title: 'Stop FitCircle invite emails?',
      body: "Friends won't be able to invite this address by email anymore. You can still join FitCircle yourself any time.",
    },
    loading: { title: 'One sec…', body: 'Updating your email preferences.' },
    done: {
      title: "Done — you won't get FitCircle invites anymore",
      body: "We've removed this address from invite emails. Friends won't be able to invite it again. If you change your mind, you can always join FitCircle yourself.",
    },
    invalid: {
      title: 'This unsubscribe link is invalid or expired',
      body: 'Try the link in your most recent FitCircle invite email. If it keeps happening, reach out to support and we will sort it out.',
    },
    error: { title: 'Something went wrong', body: "We couldn't update your preferences right now. Please try the link again in a minute." },
  }[state];

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-slate-950 px-4">
      <div className="pointer-events-none absolute -top-32 left-1/2 h-[480px] w-[480px] -translate-x-1/2 rounded-full bg-purple-600/15 blur-3xl" aria-hidden />
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="relative w-full max-w-md rounded-3xl border border-slate-800 bg-slate-900/60 p-8 text-center backdrop-blur-xl"
        data-testid={`unsubscribe-${state}`}
      >
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-purple-500/25 to-pink-500/25">
          {state === 'loading' ? (
            <Loader2 className="h-8 w-8 animate-spin text-purple-300" />
          ) : (
            <MailX className="h-8 w-8 text-purple-200" />
          )}
        </div>
        <h1 className="mt-5 text-2xl font-bold text-white" role={state === 'loading' ? undefined : 'status'}>
          {copy.title}
        </h1>
        <p className="mt-3 text-gray-400">{copy.body}</p>
        {state === 'confirm' && (
          <div className="mt-7 flex flex-col gap-2">
            <button
              type="button"
              onClick={onConfirm}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-purple-600 to-pink-600 px-5 py-3 font-semibold text-white"
            >
              Stop invite emails
            </button>
            <Link href="/" className="text-sm text-purple-300 hover:underline">
              Never mind
            </Link>
          </div>
        )}
        {state !== 'loading' && state !== 'confirm' && (
          <div className="mt-7 flex flex-col gap-2">
            <Link
              href="/"
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-purple-600 to-pink-600 px-5 py-3 font-semibold text-white"
            >
              Visit FitCircle <ArrowRight className="h-4 w-4" />
            </Link>
            {state === 'invalid' && (
              <Link href="/support" className="text-sm text-purple-300 hover:underline">
                Contact support
              </Link>
            )}
          </div>
        )}
      </motion.div>
    </div>
  );
}

