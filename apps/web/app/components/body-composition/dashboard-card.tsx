'use client';

import { PersonStanding } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';

import { Card, CardContent } from '@/components/ui/card';
import { bodyCompClient } from '@/lib/api/body-comp-client';
import type { BodyCompLog, BodyCompTrendState } from '@/lib/types/body-composition';
import { useAuthStore } from '@/stores/auth-store';

import { StateChip } from './state-chip';

// ---------------------------------------------------------------------------
// Dashboard entry point (BODY_COMP_BUILD_CONTRACT §3): latest BF% + the
// server trend-state chip, linking to /body-composition. Renders nothing
// while gated (body_comp_logging flipped to premium) — gates are invisible
// while everything is free; the journal page shows the lock card itself.
// Private data on the user's own dashboard only — never a social surface.
// ---------------------------------------------------------------------------

export function BodyCompDashboardCard() {
  const { user } = useAuthStore();
  const [latest, setLatest] = useState<BodyCompLog | null>(null);
  const [state, setState] = useState<BodyCompTrendState | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [gated, setGated] = useState(false);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    const load = async () => {
      try {
        const entitlements = await bodyCompClient.getEntitlements();
        const canLog = entitlements.features['body_comp_logging']?.allowed ?? true;
        const canTrends = entitlements.features['body_comp_trends']?.allowed ?? true;
        if (!canLog) {
          // Gated: keep the dashboard clean; the lock card lives on the page.
          if (!cancelled) setGated(true);
          return;
        }
        const latestLog = await bodyCompClient.getLatest();
        if (!cancelled) setLatest(latestLog);
        if (canTrends && latestLog) {
          try {
            const trends = await bodyCompClient.getTrends();
            if (!cancelled) setState(trends.state);
          } catch {
            // State chip is optional decoration — the card works without it.
          }
        }
      } catch (error) {
        console.error('Error loading body composition summary:', error);
      } finally {
        if (!cancelled) setLoaded(true);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Gated (body_comp_logging flipped to premium) → render nothing: an active-looking
  // CTA for a locked feature would contradict the invisible-until-flipped gate rule.
  if (!loaded || gated) return null;

  return (
    <Link href="/body-composition" className="block">
      <Card className="bg-slate-900/50 border-slate-800 backdrop-blur-xl hover:bg-slate-800/50 transition-colors cursor-pointer group">
        <CardContent className="p-4 sm:p-6 flex items-center gap-4">
          <div className="w-12 h-12 rounded-full bg-purple-500/20 flex items-center justify-center flex-shrink-0 group-hover:scale-110 transition-transform">
            <PersonStanding className="w-6 h-6 text-purple-400" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-base sm:text-lg font-semibold text-white">Body Composition</h3>
              {state && <StateChip state={state} />}
            </div>
            <p className="text-sm text-gray-400">
              {latest?.bodyFatPct != null
                ? `Latest body fat: ${latest.bodyFatPct.toFixed(1)}%`
                : latest
                  ? 'Latest entry logged — add body fat % for trends'
                  : 'Log a measurement or scan a report'}
            </p>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
