'use client';

import { Crown, Loader2, Send, Sparkles, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { useEntitlements } from '@/hooks/useEntitlements';
import { useWebTrial } from '@/hooks/useWebTrial';
import { AnalyticsEvents, analytics, isUpgradeRequired } from '@/lib/analytics';
import { nutritionClient, type FitzyMessage } from '@/lib/api/nutrition-client';
import { useAuthStore } from '@/stores/auth-store';

interface FitzyChatProps {
  /** Optionally ground encouragement in a specific circle's active challenge. */
  circleId?: string;
  /** Render to fill its parent (drawer) vs. a bounded embedded card. */
  fill?: boolean;
}

/** Last ~20 turns are sent on each request; we persist a bit more for restore. */
const MAX_TURNS_SENT = 20;
const MAX_TURNS_STORED = 50;

/**
 * Trial-first gate copy (docs/TRIAL_FIRST_SPEC.md §7). Web shows the trial headline only when a
 * Stripe checkout would really carry the trial (GET /api/billing/trial).
 */
export function fitzyGateCopy(trialDays: number): { headline: string; sub: string | null; cta: string } {
  return trialDays > 0
    ? { headline: `Try Pro free for ${trialDays} days`, sub: 'Cancel anytime. Start your free trial to chat with Fitzy.', cta: 'Start free trial' }
    : { headline: 'Unlock Fitzy Pro', sub: 'Upgrade to Pro to chat with Fitzy.', cta: 'Continue with Pro' };
}

/** Free users can open Fitzy but not send: the gate is live and their daily allowance is 0. */
export function isFitzyChatLocked(e: { features?: Record<string, { allowed: boolean }>; limits?: { fitzyMessagesPerDay: number | null } } | null): boolean {
  return !!e && e.features?.fitzy_unlimited?.allowed === false && e.limits?.fitzyMessagesPerDay === 0;
}

function storageKey(userId: string | undefined): string {
  return `fitzy.history.${userId ?? 'anon'}`;
}

function loadHistory(userId: string | undefined): FitzyMessage[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(storageKey(userId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (m): m is FitzyMessage =>
        !!m &&
        typeof m === 'object' &&
        (m as FitzyMessage).role !== undefined &&
        typeof (m as FitzyMessage).content === 'string'
    );
  } catch {
    return [];
  }
}

/**
 * Fitzy — the FitCircle AI coach. Multi-turn chat: history is held client-side
 * (localStorage, keyed by user id) and the recent turns are sent on each request.
 * Assistant replies are Markdown. Always shows the server-provided disclaimer.
 */
export function FitzyChat({ circleId, fill }: FitzyChatProps) {
  const userId = useAuthStore((s) => s.user?.id);
  const [messages, setMessages] = useState<FitzyMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [disclaimer, setDisclaimer] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const { entitlements } = useEntitlements();
  const { trialDays } = useWebTrial(entitlements?.tier !== 'premium');
  // Pre-send gate: shown instead of sending (or after the server's UPGRADE_REQUIRED).
  const [gateOpen, setGateOpen] = useState(false);
  const subscriptionsEnabled = entitlements?.subscriptionsEnabled === true;

  // Restore persisted history when the user is known.
  useEffect(() => {
    setMessages(loadHistory(userId));
  }, [userId]);

  // Persist (capped) whenever history changes.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(
        storageKey(userId),
        JSON.stringify(messages.slice(-MAX_TURNS_STORED))
      );
    } catch {
      /* quota / private mode — non-fatal */
    }
  }, [messages, userId]);

  // Keep the latest message in view.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, loading]);

  const send = async () => {
    const text = input.trim();
    if (!text || loading) return;
    // Trial-first: decide BEFORE sending (no request, no AI spend); the typed text stays in the box.
    if (isFitzyChatLocked(entitlements)) {
      analytics.track(AnalyticsEvents.aiLimitReached({ feature: 'fitzy', source: circleId ? 'circle_fitzy' : 'fitzy' }));
      setGateOpen(true);
      return;
    }

    const userMessage: FitzyMessage = { role: 'user', content: text };
    const next = [...messages, userMessage];
    setMessages(next);
    setInput('');
    setLoading(true);
    setError(null);
    analytics.track(AnalyticsEvents.fitzyMessageSent({ is_suggestion: false }));

    try {
      const res = await nutritionClient.fitzyChat(next.slice(-MAX_TURNS_SENT), circleId);
      setMessages((prev) => [...prev, { role: 'assistant', content: res.answer }]);
      setDisclaimer(res.disclaimer);
    } catch (err) {
      if (isUpgradeRequired(err)) {
        analytics.track(AnalyticsEvents.aiLimitReached({ feature: 'fitzy', source: circleId ? 'circle_fitzy' : 'fitzy' }));
        setGateOpen(true);
      } else {
        setError(err instanceof Error ? err.message : 'Fitzy could not respond. Try again.');
      }
      // Roll back the optimistic user turn so the input isn't lost.
      setMessages((prev) => prev.slice(0, -1));
      setInput(text);
    } finally {
      setLoading(false);
    }
  };

  const clear = () => {
    setMessages([]);
    setDisclaimer(null);
    setError(null);
  };

  return (
    <div
      className={
        fill
          ? 'flex h-full flex-col'
          : 'flex max-h-[32rem] min-h-[24rem] flex-col rounded-xl border border-slate-800/60 bg-slate-900/60 backdrop-blur-xl'
      }
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-2 border-b border-slate-800/60 px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500/30 to-fuchsia-500/30">
            <Sparkles className="h-4 w-4 text-fuchsia-400" />
          </span>
          <div>
            <h3 className="text-sm font-semibold text-white">Fitzy</h3>
            <p className="text-[11px] text-gray-400">Your AI fitness &amp; nutrition coach</p>
          </div>
        </div>
        {messages.length > 0 && (
          <button
            type="button"
            onClick={clear}
            aria-label="Clear conversation"
            className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-slate-800 hover:text-gray-200"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {messages.length === 0 && !loading && (
          <div className="flex h-full flex-col items-center justify-center gap-2 py-8 text-center">
            <Sparkles className="h-8 w-8 text-fuchsia-400/70" />
            <p className="text-sm font-medium text-gray-200">
              Ask Fitzy anything about fitness &amp; nutrition.
            </p>
            <p className="max-w-xs text-xs text-gray-500">
              Meal ideas, macros, workout tips, staying on streak — Fitzy knows your circles and
              progress.
            </p>
          </div>
        )}

        {messages.map((m, i) => (
          <div
            key={`${m.role}-${i}`}
            className={m.role === 'user' ? 'flex justify-end' : 'flex justify-start'}
          >
            {m.role === 'user' ? (
              <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-gradient-to-r from-indigo-600 to-fuchsia-600 px-3.5 py-2 text-sm text-white">
                {m.content}
              </div>
            ) : (
              <div className="fitzy-markdown max-w-[90%] rounded-2xl rounded-bl-sm border border-slate-700/50 bg-slate-800/60 px-3.5 py-2.5 text-sm leading-relaxed text-gray-100">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content}</ReactMarkdown>
              </div>
            )}
          </div>
        ))}

        {loading && (
          <div className="flex justify-start">
            <div className="flex items-center gap-2 rounded-2xl rounded-bl-sm border border-slate-700/50 bg-slate-800/60 px-3.5 py-2.5 text-sm text-gray-400">
              <Loader2 className="h-4 w-4 animate-spin" />
              Fitzy is thinking…
            </div>
          </div>
        )}

        {error && <p className="text-center text-sm text-amber-300">{error}</p>}

        {gateOpen && (() => {
          const copy = fitzyGateCopy(trialDays);
          return (
            <div data-testid="fitzy-paywall" className="rounded-xl border border-fuchsia-500/30 bg-gradient-to-br from-indigo-600/20 to-fuchsia-600/20 p-4 text-center">
              <Crown className="mx-auto h-6 w-6 text-brand-yellow" aria-hidden />
              <p className="mt-2 text-sm font-semibold text-white">{copy.headline}</p>
              {copy.sub && <p className="mt-1 text-xs text-gray-300">{copy.sub}</p>}
              {subscriptionsEnabled ? (
                <Link
                  href="/upgrade?source=fitzy_send"
                  className="mt-3 inline-flex items-center justify-center rounded-lg bg-gradient-to-r from-indigo-600 to-fuchsia-600 px-4 py-2 text-sm font-semibold text-white hover:from-indigo-700 hover:to-fuchsia-700"
                >
                  {copy.cta}
                </Link>
              ) : null}
            </div>
          );
        })()}
      </div>

      {/* Disclaimer */}
      {disclaimer && (
        <p className="border-t border-slate-800/40 px-4 py-2 text-[11px] italic leading-snug text-gray-500">
          {disclaimer}
        </p>
      )}

      {/* Composer */}
      <div className="flex items-end gap-2 border-t border-slate-800/60 p-3">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          rows={1}
          placeholder="Message Fitzy…"
          className="max-h-32 flex-1 resize-none rounded-lg border border-slate-700/60 bg-slate-800/60 px-3 py-2.5 text-sm text-white placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
        <button
          type="button"
          onClick={() => void send()}
          disabled={loading || !input.trim()}
          aria-label="Send"
          className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-gradient-to-r from-indigo-600 to-fuchsia-600 text-white transition-colors hover:from-indigo-700 hover:to-fuchsia-700 disabled:opacity-50"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </button>
      </div>
    </div>
  );
}
