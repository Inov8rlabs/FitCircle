'use client';

import { Flame, HeartHandshake, Loader2, Trophy } from 'lucide-react';
import { useEffect, useState } from 'react';

import {
  nutritionClient,
  type CircleStreak,
} from '@/lib/api/nutrition-client';

import type { CircleMember } from './GroupMealComposer';

interface CircleStreakCardProps {
  circleId: string;
  /** Members the user can cover for (excluding themselves). */
  members?: CircleMember[];
  currentUserId?: string;
}

/**
 * §6.13 — collective circle streak (current / longest) plus a forgiveness-first
 * "cover for a member" action that counts a lapsed member as logged for the day.
 */
export function CircleStreakCard({
  circleId,
  members = [],
  currentUserId,
}: CircleStreakCardProps) {
  const [streak, setStreak] = useState<CircleStreak | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [coverOpen, setCoverOpen] = useState(false);
  const [coverUserId, setCoverUserId] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    nutritionClient
      .getCircleStreak(circleId)
      .then((s) => {
        setStreak(s);
        setError(null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoading(false));
  }, [circleId]);

  const coverable = members.filter((m) => m.user_id !== currentUserId);

  const cover = async () => {
    if (!coverUserId) return;
    setSaving(true);
    setSaveMsg(null);
    try {
      const result = await nutritionClient.useStreakSave(circleId, coverUserId);
      setStreak(result.streak);
      setSaveMsg(
        result.created
          ? "Covered — they're logged for today."
          : 'They were already covered for today.'
      );
      setCoverUserId('');
      setCoverOpen(false);
    } catch (err) {
      setSaveMsg(err instanceof Error ? err.message : 'Could not cover');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex h-28 items-center justify-center rounded-xl border border-slate-800/60 bg-slate-900/60 backdrop-blur-xl">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent" />
      </div>
    );
  }

  if (error || !streak) {
    return (
      <div className="rounded-xl border border-slate-800/60 bg-slate-900/60 p-4 text-center text-sm text-amber-300 backdrop-blur-xl">
        {error ?? 'No streak data yet.'}
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-slate-800/60 bg-slate-900/60 p-4 backdrop-blur-xl">
      <h3 className="mb-3 flex items-center gap-2 text-base font-semibold text-white">
        <Flame className="h-4 w-4 text-orange-400" aria-hidden="true" />
        Circle streak
      </h3>

      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-lg border border-orange-500/30 bg-orange-500/10 p-3 text-center">
          <div className="flex items-center justify-center gap-1.5 text-2xl font-bold text-orange-300 tabular-nums">
            <Flame className="h-5 w-5" aria-hidden="true" />
            {streak.currentStreak}
          </div>
          <p className="mt-0.5 text-[11px] uppercase tracking-wide text-gray-400">
            Current
          </p>
        </div>
        <div className="rounded-lg border border-slate-700/50 bg-slate-800/40 p-3 text-center">
          <div className="flex items-center justify-center gap-1.5 text-2xl font-bold text-gray-100 tabular-nums">
            <Trophy className="h-5 w-5 text-yellow-400" aria-hidden="true" />
            {streak.longestStreak}
          </div>
          <p className="mt-0.5 text-[11px] uppercase tracking-wide text-gray-400">
            Longest
          </p>
        </div>
      </div>

      {streak.lastActiveDate && (
        <p className="mt-2 text-center text-xs text-gray-400">
          Last active{' '}
          {new Date(`${streak.lastActiveDate}T00:00:00`).toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
          })}
        </p>
      )}

      {coverable.length > 0 && (
        <div className="mt-3 border-t border-slate-800/60 pt-3">
          {!coverOpen ? (
            <button
              type="button"
              onClick={() => setCoverOpen(true)}
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-slate-700/60 bg-slate-800/60 px-3 py-2 text-sm text-gray-100 hover:bg-slate-700/60"
            >
              <HeartHandshake className="h-4 w-4 text-emerald-400" aria-hidden="true" />
              Cover for a member
            </button>
          ) : (
            <div className="space-y-2">
              <label className="block">
                <span className="mb-1 block text-xs text-gray-300">
                  Keep the streak alive for…
                </span>
                <select
                  value={coverUserId}
                  onChange={(e) => setCoverUserId(e.target.value)}
                  className="w-full rounded-md border border-slate-600 bg-slate-900/60 px-2.5 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="">Select a member…</option>
                  {coverable.map((m) => (
                    <option key={m.user_id} value={m.user_id}>
                      {m.display_name}
                    </option>
                  ))}
                </select>
              </label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={cover}
                  disabled={saving || !coverUserId}
                  className="inline-flex flex-1 items-center justify-center gap-2 rounded-md bg-gradient-to-r from-emerald-600 to-emerald-700 px-3 py-1.5 text-sm font-semibold text-white hover:from-emerald-700 hover:to-emerald-800 disabled:opacity-50"
                >
                  {saving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                  Cover today
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setCoverOpen(false);
                    setCoverUserId('');
                  }}
                  className="rounded-md border border-slate-700/60 bg-slate-800/60 px-3 py-1.5 text-sm text-gray-200 hover:bg-slate-700/60"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {saveMsg && <p className="mt-2 text-center text-xs text-emerald-300">{saveMsg}</p>}
    </div>
  );
}
