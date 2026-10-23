'use client';

/**
 * Daily check-in history (daily_tracking rows) as an iOS grouped list: date,
 * weight and steps. Capped to `pageSize` rows with "Show more"
 * (or a "See all" link when `seeAllHref` is set, for the dashboard). Tapping a
 * row opens the existing check-in detail (sheet on phones, dialog from md up)
 * with the same delete (DELETE /api/check-ins/:id) and privacy
 * (PATCH /api/check-ins/:id/privacy) actions the dashboard had.
 */
import { CalendarCheck, ChevronDown, Footprints, Lock, Scale } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';

import { CheckInDetailModal } from '@/components/check-ins/CheckInDetailModal';
import { CheckInDetailSheet } from '@/components/check-ins/CheckInDetailSheet';
import { EmptyState } from '@/components/ui/empty-state';
import { GlassCard, MetricPill, ToneDisc } from '@/components/ui/ios';
import { Skeleton } from '@/components/ui/skeleton';
import { useUnitPreference } from '@/hooks/useUnitPreference';
import { getWeightUnit, weightKgToDisplay } from '@/lib/utils/units';
import { useAuthStore } from '@/stores/auth-store';

import { fetchTracking, parseDateKey, type TrackingRow } from './api';

export interface CheckInHistoryListProps {
  /** Pre-fetched rows (newest first). Omit to let the list load daily_tracking itself. */
  rows?: TrackingRow[];
  /** Rows shown before "Show more" (default 10). */
  pageSize?: number;
  /** Section title above the list (default "Check-in history"; pass null to hide). */
  title?: string | null;
  /** When set, the list never expands in place; it shows a "See all" link here instead. */
  seeAllHref?: string;
  /** Called after a delete or privacy change so a parent can refetch. */
  onChanged?: () => void;
  className?: string;
}


function useIsDesktop(): boolean {
  const [desktop, setDesktop] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia?.('(min-width: 768px)');
    if (!mq) return;
    const on = () => setDesktop(mq.matches);
    on();
    mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, []);
  return desktop;
}

export function CheckInHistoryList({
  rows: rowsProp,
  pageSize = 10,
  title = 'Check-in history',
  seeAllHref,
  onChanged,
  className,
}: CheckInHistoryListProps) {
  const user = useAuthStore((s) => s.user);
  const { unitSystem } = useUnitPreference();
  const isDesktop = useIsDesktop();
  const [ownRows, setOwnRows] = useState<TrackingRow[] | null>(null);
  const [shown, setShown] = useState(pageSize);
  const [selected, setSelected] = useState<TrackingRow | null>(null);

  const load = useCallback(async () => {
    if (rowsProp || !user?.id) return;
    try {
      setOwnRows(await fetchTracking(user.id, 90));
    } catch (e) {
      console.error('[check-in history] load failed', e);
      setOwnRows([]);
    }
  }, [rowsProp, user?.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const rows = rowsProp ?? ownRows;
  const loading = rows === null;
  const visible = (rows ?? []).slice(0, shown);
  const more = (rows?.length ?? 0) - visible.length;
  const unit = getWeightUnit(unitSystem);

  const changed = () => {
    onChanged?.();
    void load();
  };

  const handleDelete = async (id: string) => {
    try {
      const res = await fetch(`/api/check-ins/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete check-in');
      toast.success('Check-in deleted successfully');
      setSelected(null);
      changed();
    } catch (e) {
      console.error('Error deleting check-in:', e);
      toast.error('Failed to delete check-in');
    }
  };

  const handlePrivacy = async (id: string, isPublic: boolean) => {
    try {
      const res = await fetch(`/api/check-ins/${id}/privacy`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isPublic }),
      });
      if (!res.ok) throw new Error('Failed to update privacy');
      toast.success(isPublic ? 'Check-in is now public' : 'Check-in is now private');
      changed();
    } catch (e) {
      console.error('Error updating privacy:', e);
      toast.error('Failed to update privacy');
    }
  };

  const detail = selected
    ? {
        id: selected.id,
        user_id: user?.id ?? '',
        tracking_date: selected.tracking_date,
        weight_kg: selected.weight_kg ?? null,
        steps: selected.steps ?? null,
        mood_score: selected.mood_score ?? null,
        energy_level: selected.energy_level ?? null,
        notes: selected.notes ?? null,
        is_public: selected.is_public ?? true,
        created_at: selected.created_at,
        updated_at: selected.created_at,
        profile: {
          username: user?.email?.split('@')[0] ?? 'user',
          display_name: user?.name ?? 'You',
          avatar_url: null,
        },
      }
    : null;

  return (
    <section className={className} data-testid="checkin-history">
      {(title || seeAllHref) && (
        <div className="mb-2 flex items-center justify-between px-1">
          {title && <h2 className="text-title3 text-white">{title}</h2>}
          {seeAllHref && (rows?.length ?? 0) > 0 && (
            <Link href={seeAllHref} className="text-subhead font-semibold text-brand-indigo hover:text-brand-purple">
              See all
            </Link>
          )}
        </div>
      )}

      {loading ? (
        <ul role="status" aria-label="Loading check-ins" className="space-y-2">
          {Array.from({ length: Math.min(pageSize, 4) }).map((_, i) => (
            <li key={i} className="flex h-[76px] items-center gap-3 rounded-xl border border-glass bg-surface-raised/50 px-4">
              <Skeleton className="h-10 w-10 rounded-full" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-1/3" />
                <Skeleton className="h-4 w-2/3" />
              </div>
            </li>
          ))}
        </ul>
      ) : visible.length === 0 ? (
        <GlassCard>
          <EmptyState
            icon={CalendarCheck}
            tone="green"
            title="No check-ins yet"
            description="Log your weight or steps and each day shows up here."
          />
        </GlassCard>
      ) : (
        <ul className="space-y-2">
          {visible.map((r) => {
            const d = parseDateKey(r.tracking_date);
            return (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => setSelected(r)}
                  data-testid="checkin-row"
                  className="flex w-full items-center gap-3 rounded-xl border border-glass bg-surface-raised/50 px-4 py-3 text-left transition hover:border-white/20 hover:bg-surface-raised/70"
                >
                  <ToneDisc icon={CalendarCheck} tone="green" size="md" />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5 text-headline text-white">
                      {d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                      {r.is_public === false && <Lock className="h-3.5 w-3.5 text-fg-tertiary" aria-label="Private" />}
                    </span>
                    <span className="mt-1.5 flex flex-wrap gap-1.5">
                      {typeof r.weight_kg === 'number' && (
                        <MetricPill icon={Scale} tone="purple">
                          {weightKgToDisplay(r.weight_kg, unitSystem).toFixed(1)} {unit}
                        </MetricPill>
                      )}
                      {typeof r.steps === 'number' && r.steps > 0 && (
                        <MetricPill icon={Footprints} tone="indigo">
                          {r.steps.toLocaleString()} steps
                        </MetricPill>
                      )}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {!seeAllHref && more > 0 && (
        <button
          type="button"
          onClick={() => setShown((n) => n + pageSize)}
          className="mx-auto mt-3 flex h-10 items-center gap-1.5 rounded-full bg-white/5 px-5 text-subhead font-semibold text-fg-secondary transition hover:bg-white/10 hover:text-white"
          data-testid="checkin-show-more"
        >
          Show more <span className="text-fg-tertiary">({more})</span>
          <ChevronDown className="h-4 w-4" aria-hidden />
        </button>
      )}

      {detail && selected && (
        isDesktop ? (
          <CheckInDetailModal
            checkIn={detail}
            isOpen
            onClose={() => setSelected(null)}
            onDelete={() => handleDelete(selected.id)}
            onTogglePrivacy={(isPublic) => handlePrivacy(selected.id, isPublic)}
            canEdit
          />
        ) : (
          <CheckInDetailSheet
            checkIn={detail}
            isOpen
            onClose={() => setSelected(null)}
            onDelete={() => handleDelete(selected.id)}
            onTogglePrivacy={(isPublic) => handlePrivacy(selected.id, isPublic)}
            canEdit
          />
        )
      )}
    </section>
  );
}
