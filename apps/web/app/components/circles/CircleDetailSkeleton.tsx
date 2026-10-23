import { GlassCard } from '@/components/ui/ios';
import { Skeleton } from '@/components/ui/skeleton';

import { CircleStreakLiveCardSkeleton } from './CircleStreakLiveCard';
import { LeaderboardSkeleton } from './LeaderboardRow';

/** Same boxes as the loaded circle screen, so nothing jumps when data lands. */
export function CircleDetailSkeleton() {
  return (
    <div aria-busy="true" data-testid="circle-detail-skeleton">
      <div className="mb-2 flex items-center justify-between">
        <Skeleton className="h-10 w-10 rounded-full" />
        <Skeleton className="h-10 w-10 rounded-full" />
      </div>
      <div className="mb-6 flex flex-col items-center">
        <Skeleton className="h-9 w-56" />
        <Skeleton className="mt-2 h-4 w-72 max-w-full" />
        <div className="mt-4 flex gap-2">
          <Skeleton className="h-9 w-24 rounded-full" />
          <Skeleton className="h-9 w-24 rounded-full" />
        </div>
      </div>
      <Skeleton className="mx-auto mb-5 h-10 w-full max-w-md" />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start">
        <div className="space-y-5">
          <CircleStreakLiveCardSkeleton />
          <Skeleton className="h-6 w-40" />
          <LeaderboardSkeleton />
        </div>
        <div className="grid grid-cols-2 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <GlassCard key={i} className="space-y-2">
              <Skeleton className="h-9 w-9 rounded-full" />
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-6 w-12" />
            </GlassCard>
          ))}
        </div>
      </div>
    </div>
  );
}
