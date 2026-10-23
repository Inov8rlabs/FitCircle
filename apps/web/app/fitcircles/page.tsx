'use client';

import { AlertCircle, Flame, Hash, Plus, Users } from 'lucide-react';
import { useEffect, useState } from 'react';

import CircleCreationWizard from '@/components/CircleCreationWizard';
import { CircleListCard, CircleListCardSkeleton, type CircleSummary } from '@/components/circles/CircleListCard';
import DashboardNav from '@/components/DashboardNav';
import QuickJoinCircle from '@/components/QuickJoinCircle';
import { Button } from '@/components/ui/button';
import { Chip, ChipRow } from '@/components/ui/chip';
import { EmptyState } from '@/components/ui/empty-state';
import { GlassCard, ListGroup, ListRow, Screen, ScreenHeader } from '@/components/ui/ios';
import { analytics } from '@/lib/analytics';
import { useAuthStore } from '@/stores/auth-store';

type Filter = 'active' | 'ended' | 'all';

function isEnded(c: CircleSummary): boolean {
  return Boolean(c.end_date) && new Date(c.end_date as string).getTime() < Date.now();
}

/**
 * Circles tab, laid out like iOS CirclesListView: gradient title + Fitzy,
 * Challenge Library row, Join with Code / Create Circle, an Active / Ended
 * filter and one live card per circle.
 */
export default function CirclesPage() {
  const { user } = useAuthStore();
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [isJoinDialogOpen, setIsJoinDialogOpen] = useState(false);
  const [myCircles, setMyCircles] = useState<CircleSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const [filter, setFilter] = useState<Filter>('active');

  useEffect(() => {
    if (user) {
      void fetchMyCircles();
    } else {
      setIsLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refetch only when the signed-in user changes
  }, [user]);

  const fetchMyCircles = async () => {
    if (!user?.id) {
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setHasError(false);
    try {
      // GET /api/fitcircles is the source of truth (migration 067 makes the
      // browser anon-key client own-row-only on fitcircles/fitcircle_members).
      const response = await fetch('/api/fitcircles', { headers: { 'Content-Type': 'application/json' } });
      if (response.ok) {
        const data = await response.json();
        const circles: CircleSummary[] = (data.circles || []).map((c: CircleSummary & { challenge_id?: string }) => ({
          ...c,
          id: c.challenge_id || c.id,
        }));
        setMyCircles(circles);
        analytics.setUserProperties({ circles_count: circles.length });
        return;
      }
      console.error('GET /api/fitcircles failed:', response.status);
      setMyCircles([]);
      setHasError(true);
    } catch (error) {
      console.error('Exception in fetchMyCircles:', error);
      setMyCircles([]);
      setHasError(true);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCircleCreated = () => {
    setIsCreateDialogOpen(false);
    void fetchMyCircles();
  };

  const counts = {
    active: myCircles.filter((c) => !isEnded(c)).length,
    ended: myCircles.filter(isEnded).length,
    all: myCircles.length,
  };
  const shown = myCircles.filter((c) => (filter === 'all' ? true : filter === 'ended' ? isEnded(c) : !isEnded(c)));

  return (
    <>
      <DashboardNav />
      <div className="min-h-screen bg-canvas">
        <Screen size="wide" className="max-w-5xl">
          <ScreenHeader title="FitCircles" subtitle="Join groups and compete with friends" />

          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
            <div className="min-w-0 space-y-4">
              {/* Join / Create (iOS SecondaryButton + PrimaryButton) */}
              <div className="grid grid-cols-2 gap-3 lg:hidden">
                <Button variant="outline" size="lg" className="px-3" onClick={() => setIsJoinDialogOpen(true)} data-testid="join-with-code">
                  <Hash className="mr-2 h-4 w-4 shrink-0" />
                  Join with Code
                </Button>
                <Button size="lg" className="px-3" onClick={() => setIsCreateDialogOpen(true)} data-testid="create-circle">
                  <Plus className="mr-2 h-4 w-4 shrink-0" />
                  Create Circle
                </Button>
              </div>

              {myCircles.length > 0 && (
                <ChipRow>
                  {(['active', 'ended', 'all'] as const).map((f) => (
                    <Chip
                      key={f}
                      selected={filter === f}
                      onClick={() => setFilter(f)}
                      className={filter === f ? 'bg-gradient-brand' : undefined}
                    >
                      {f === 'active' ? 'Active' : f === 'ended' ? 'Ended' : 'All'}
                      {counts[f] > 0 && (
                        <span className={filter === f ? 'rounded-full bg-white/25 px-1.5 text-caption' : 'rounded-full bg-white/10 px-1.5 text-caption'}>
                          {counts[f]}
                        </span>
                      )}
                    </Chip>
                  ))}
                </ChipRow>
              )}

              {hasError && (
                <GlassCard className="border-brand-red/30 bg-brand-red/10" role="alert">
                  <div className="flex items-start gap-3">
                    <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-brand-red" aria-hidden />
                    <div className="min-w-0 flex-1">
                      <h3 className="text-headline text-white">Couldn&apos;t load your circles</h3>
                      <p className="mt-1 text-subhead text-fg-secondary">Check your connection and try again.</p>
                      <Button variant="outline" size="sm" className="mt-3" onClick={() => void fetchMyCircles()}>
                        Try again
                      </Button>
                    </div>
                  </div>
                </GlassCard>
              )}

              {isLoading ? (
                <div className="space-y-4" data-testid="circles-loading">
                  <CircleListCardSkeleton />
                  <CircleListCardSkeleton />
                </div>
              ) : !hasError && myCircles.length === 0 ? (
                <GlassCard>
                  <EmptyState
                    icon={Users}
                    tone="orange"
                    title="No Circles Yet"
                    description="Create a circle and invite a few friends, or join one with an invite code."
                    action={
                      <div className="flex flex-wrap justify-center gap-3">
                        <Button onClick={() => setIsCreateDialogOpen(true)}>
                          <Plus className="mr-2 h-4 w-4 shrink-0" />
                          Create Circle
                        </Button>
                        <Button variant="outline" onClick={() => setIsJoinDialogOpen(true)}>
                          <Hash className="mr-2 h-4 w-4 shrink-0" />
                          Join with Code
                        </Button>
                      </div>
                    }
                  />
                </GlassCard>
              ) : !hasError && shown.length === 0 ? (
                <GlassCard>
                  <EmptyState
                    icon={Users}
                    tone="indigo"
                    title={filter === 'ended' ? 'No ended circles' : 'No active circles'}
                    description={filter === 'ended' ? 'Circles you finish land here.' : 'Start a new one or join with a code.'}
                  />
                </GlassCard>
              ) : (
                <ul className="space-y-4" data-testid="circles-list">
                  {shown.map((circle) => (
                    <li key={circle.id}>
                      <CircleListCard circle={circle} />
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Side column on desktop; stacked under the list on phones */}
            <aside className="space-y-4 lg:sticky lg:top-24">
              <div className="hidden gap-3 lg:grid">
                <Button size="lg" fullWidth onClick={() => setIsCreateDialogOpen(true)}>
                  <Plus className="mr-2 h-4 w-4 shrink-0" />
                  Create Circle
                </Button>
                <Button variant="outline" size="lg" fullWidth onClick={() => setIsJoinDialogOpen(true)}>
                  <Hash className="mr-2 h-4 w-4 shrink-0" />
                  Join with Code
                </Button>
              </div>
              <ListGroup className="mb-0">
                <ListRow
                  href="/challenges"
                  icon={Flame}
                  tone="orange"
                  title="Challenge Library"
                  subtitle="Browse and start challenges"
                  testId="challenge-library-row"
                />
                <ListRow href="/invite" icon={Users} tone="pink" title="Invite friends" subtitle="Better together: share your link" />
              </ListGroup>
            </aside>
          </div>
        </Screen>
      </div>

      <CircleCreationWizard
        isOpen={isCreateDialogOpen}
        onClose={() => setIsCreateDialogOpen(false)}
        onSuccess={handleCircleCreated}
      />

      <QuickJoinCircle
        isOpen={isJoinDialogOpen}
        onClose={() => {
          setIsJoinDialogOpen(false);
          if (user) void fetchMyCircles();
        }}
      />
    </>
  );
}
