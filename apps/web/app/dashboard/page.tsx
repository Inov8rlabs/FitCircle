'use client';

/**
 * Home: the iOS dashboard feed (FitCircle-iOS DashboardView + HomeFeed).
 *
 * Card order comes from GET /api/mobile/home-feed (schema 1, cookie auth via
 * verifyMobileAuth) when the server answers within 3 s, else the built-in
 * default the apps use (docs/HOME_FEED_SPEC.md §5). Each card renders from the
 * same sources the old dashboard used (daily_tracking, /api/mobile/vitals/summary,
 * /api/streaks/engagement, campaigns, referrals, Fitzy) and collapses when it
 * has nothing to show. Logging happens in sheets, not inline forms.
 */
import { AnimatePresence } from 'framer-motion';
import { Fragment, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

import { CheckInHistoryList } from '@/components/activity';
import { AutoSyncSubmissionCard } from '@/components/AutoSyncSubmissionCard';
import { BodyCompDashboardCard } from '@/components/body-composition/dashboard-card';
import { DashboardCampaignCard } from '@/components/campaigns/DashboardCampaignCard';
import { FitzyFocusCard, PastDateRow, ProUpsellCard, ReferralHomeCard } from '@/components/home/ExtraCards';
import { HydrationCard, HydrationCardSkeleton } from '@/components/home/HydrationCard';
import { ProgressCards } from '@/components/home/ProgressCards';
import { QuickLogSheet, type QuickLogKind } from '@/components/home/QuickLogSheet';
import { StreakCard } from '@/components/home/StreakCard';
import { WeightTrendCard } from '@/components/home/TrendsCard';
import { isoDay, useTracking } from '@/components/home/useTracking';
import { WeekStepsCard } from '@/components/home/WeekStepsCard';
import { Navbar } from '@/components/layout/navbar';
import { Screen, ScreenHeader } from '@/components/ui/ios';
import { Skeleton } from '@/components/ui/skeleton';
import { BmiScaleCard } from '@/components/vitals/BmiScaleCard';
import { useVitals } from '@/components/vitals/useVitals';
import { VitalsGoalDialog } from '@/components/vitals/VitalsGoalDialog';
import { useEntitlements } from '@/hooks/useEntitlements';
import { useUnitPreference } from '@/hooks/useUnitPreference';
import { defaultLayout, fetchHomeFeed, type HomeCardType, type HomeFeedLayout } from '@/lib/home-feed/feed-layout';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/auth-store';

/** Server layout if it arrives in time, else the built-in default (never reorders after first paint). */
function useHomeLayout(): HomeFeedLayout {
  const [layout, setLayout] = useState<HomeFeedLayout>(() => defaultLayout(false));
  useEffect(() => {
    let cancelled = false;
    void fetchHomeFeed().then((server) => {
      if (!cancelled && server) setLayout(server);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return layout;
}

function firstName(name: string | null | undefined): string | null {
  const n = (name ?? '').trim().split(/\s+/)[0];
  return n || null;
}

export default function DashboardPage() {
  const user = useAuthStore((s) => s.user);
  const { unitSystem, setUnitSystem, isLoading: unitLoading } = useUnitPreference();
  const vitals = useVitals();
  const tracking = useTracking();
  const { isPro, isLoading: entLoading } = useEntitlements();
  const layout = useHomeLayout();

  const [goalSheet, setGoalSheet] = useState(false);
  const [quickLog, setQuickLog] = useState<{ open: boolean; kind: QuickLogKind; past: boolean }>({ open: false, kind: 'weight', past: false });
  const openLog = (kind: QuickLogKind, past = false) => setQuickLog({ open: true, kind, past });

  // HealthKit-synced steps awaiting confirmation (same rule as before: today's
  // row has steps from healthkit and the user hasn't confirmed them).
  const [autoSync, setAutoSync] = useState<{ steps: number; submitting: boolean } | null>(null);
  useEffect(() => {
    const row = tracking.today;
    let confirmed = false;
    try {
      confirmed = localStorage.getItem(`stepsConfirmed-${isoDay()}`) === 'true';
    } catch {
      // storage blocked: just show the card
    }
    if (!confirmed && row?.steps && row.steps > 0 && row.steps_source === 'healthkit') setAutoSync({ steps: row.steps, submitting: false });
    else setAutoSync(null);
  }, [tracking.today]);

  const confirmAutoSync = async () => {
    if (!user || !autoSync) return;
    setAutoSync({ ...autoSync, submitting: true });
    try {
      const { error } = await (supabase as any)
        .from('daily_tracking')
        .update({ steps_source: 'manual' })
        .eq('user_id', user.id)
        .eq('tracking_date', isoDay());
      if (error) throw error;
      try {
        localStorage.setItem(`stepsConfirmed-${isoDay()}`, 'true');
      } catch {
        // ignore
      }
      setAutoSync(null);
      toast.success('Steps logged! Your streak is safe 🔥');
      void tracking.reload();
    } catch {
      setAutoSync({ ...autoSync, submitting: false });
      toast.error('Failed to confirm steps');
    }
  };

  const saveDay = async (date: string, values: { weight_kg?: number; steps?: number }) => {
    await tracking.saveDay(date, values);
    if (values.weight_kg) void vitals.refresh({ silent: true });
  };

  const hasData = !tracking.loading;
  const name = firstName(user?.name);

  const renderers = useMemo<Record<HomeCardType, () => React.ReactNode>>(
    () => ({
      header: () => null, // rendered above the feed
      campaign: () => <DashboardCampaignCard />,
      hydration: () =>
        vitals.summary ? (
          <HydrationCard water={vitals.summary.water} unitSystem={unitSystem} onLogWater={vitals.logWater} onEditGoal={() => setGoalSheet(true)} />
        ) : vitals.error ? null : (
          <HydrationCardSkeleton />
        ),
      referral: () => <ReferralHomeCard />,
      pro_upsell: () => <ProUpsellCard isPro={isPro} loading={entLoading} />,
      streak_warning: () => null, // shields banner: no web data source yet
      daily_goals: () => (
        <div className="space-y-4">
          <AnimatePresence>
            {autoSync && <AutoSyncSubmissionCard steps={autoSync.steps} onSubmit={confirmAutoSync} isSubmitting={autoSync.submitting} />}
          </AnimatePresence>
          <StreakCard />
          {hasData ? <WeekStepsCard rows={tracking.rows} stepsGoal={tracking.goals.stepsGoal} /> : <Skeleton className="h-[236px] rounded-xl" />}
        </div>
      ),
      fitzy_focus: () => <FitzyFocusCard />,
      progress: () =>
        hasData ? (
          <ProgressCards
            todaySteps={tracking.today?.steps ?? 0}
            stepsGoal={tracking.goals.stepsGoal}
            summary={vitals.summary}
            fallbackWeightKg={tracking.latestWeight?.weight_kg ?? undefined}
            fallbackGoalKg={tracking.goals.weightGoalKg}
            unitSystem={unitSystem}
            onUnitChange={setUnitSystem}
            unitLoading={unitLoading}
            onLogSteps={() => openLog('steps')}
            onLogWeight={() => openLog('weight')}
          />
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:gap-4">
            <Skeleton className="h-[268px] rounded-xl" />
            <Skeleton className="h-[268px] rounded-xl" />
          </div>
        ),
      vitals: () => <BmiScaleCard bmi={vitals.summary?.bmi ?? null} unitSystem={unitSystem} loading={vitals.loading} />,
      body_comp: () => <BodyCompDashboardCard />,
      past_date_log: () => <PastDateRow onClick={() => openLog('weight', true)} />,
      charts: () =>
        hasData ? (
          <div className="space-y-4">
            <WeightTrendCard rows={tracking.rows} unitSystem={unitSystem} />
            {tracking.rows.length > 0 && (
              <CheckInHistoryList
                rows={tracking.rows}
                pageSize={3}
                title="Recent check-ins"
                seeAllHref="/exercise-log?tab=checkins"
                onChanged={() => void tracking.reload()}
              />
            )}
          </div>
        ) : null,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [vitals.summary, vitals.error, vitals.loading, unitSystem, unitLoading, isPro, entLoading, autoSync, hasData, tracking.rows, tracking.today, tracking.goals]
  );

  return (
    <div className="min-h-screen bg-canvas bg-hero-glow">
      <Navbar />
      <Screen size="wide" className="max-w-2xl lg:max-w-6xl">
        <ScreenHeader
          title={name ? `Welcome back, ${name}!` : 'Welcome back!'}
          subtitle="Track your progress and stay consistent"
        />
        <div
          className="flex flex-col gap-4 lg:block lg:columns-2 lg:gap-5 [&>*]:lg:mb-5 [&>*]:lg:break-inside-avoid [&>div:empty]:hidden"
          data-testid="home-feed"
          data-layout-source={layout.source}
          data-layout-key={layout.layoutKey}
        >
          {layout.cards
            .filter((c) => c.type !== 'header')
            .map((c) => {
              const node = renderers[c.type]?.();
              return node ? (
                <div key={c.id} data-card={c.type}>
                  {node}
                </div>
              ) : (
                <Fragment key={c.id} />
              );
            })}
        </div>
      </Screen>

      <QuickLogSheet
        open={quickLog.open}
        onOpenChange={(open) => setQuickLog((q) => ({ ...q, open }))}
        initialKind={quickLog.kind}
        pastDate={quickLog.past}
        unitSystem={unitSystem}
        onUnitChange={setUnitSystem}
        unitLoading={unitLoading}
        onSave={saveDay}
      />
      <VitalsGoalDialog
        open={goalSheet}
        onOpenChange={setGoalSheet}
        summary={vitals.summary}
        unitSystem={unitSystem}
        onSave={vitals.saveGoals}
      />
    </div>
  );
}
