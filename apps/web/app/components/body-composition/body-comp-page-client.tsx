'use client';

import { Plus } from 'lucide-react';
import { useCallback, useState } from 'react';

import { Button } from '@/components/ui/button';
import { useUnitPreference } from '@/hooks/useUnitPreference';
import { bodyCompClient, BodyCompApiError } from '@/lib/api/body-comp-client';
import type {
  BodyCompLog,
  BodyCompTrends,
  EntitlementsResponse,
} from '@/lib/types/body-composition';

import { BodyCompEntryModal, type BodyCompPrefill } from './body-comp-entry-modal';
import { BodyCompJournal } from './body-comp-journal';
import { BodyCompScan } from './body-comp-scan';
import { BodyCompTrendsSection } from './body-comp-trends';
import { LockCard } from './lock-card';

// ---------------------------------------------------------------------------
// Body Composition page shell — owns the journal/trends state seeded by the
// server component and refreshes through the mobile API after every mutation.
// Entitlement gates arrive server-resolved so lock cards never flash; a
// missing feature key counts as allowed (everything ships free —
// BODY_COMP_BUILD_CONTRACT §3). Private-only: no sharing affordances.
// ---------------------------------------------------------------------------

const PAGE_SIZE = 50;

interface BodyCompPageClientProps {
  initialLogs: BodyCompLog[];
  initialHasMore: boolean;
  initialNextBefore: string | null;
  initialLatest: BodyCompLog | null;
  initialTrends: BodyCompTrends | null;
  entitlements: EntitlementsResponse;
}

function allowed(entitlements: EntitlementsResponse, key: string): boolean {
  return entitlements.features[key]?.allowed ?? true;
}

export function BodyCompPageClient({
  initialLogs,
  initialHasMore,
  initialNextBefore,
  initialLatest,
  initialTrends,
  entitlements,
}: BodyCompPageClientProps) {
  const { unitSystem } = useUnitPreference();

  const canLog = allowed(entitlements, 'body_comp_logging');
  const canScan = allowed(entitlements, 'body_comp_photo_scan');
  const canTrends = allowed(entitlements, 'body_comp_trends');
  const canSegmental = allowed(entitlements, 'body_comp_segmental');

  const [logs, setLogs] = useState<BodyCompLog[]>(initialLogs);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [nextBefore, setNextBefore] = useState<string | null>(initialNextBefore);
  const [latest, setLatest] = useState<BodyCompLog | null>(initialLatest);
  const [trends, setTrends] = useState<BodyCompTrends | null>(initialTrends);
  const [trendsLocked, setTrendsLocked] = useState(!canTrends);
  const [loadingMore, setLoadingMore] = useState(false);

  // Entry modal state — create, edit, or low-confidence-scan-prefill mode.
  const [modalOpen, setModalOpen] = useState(false);
  const [editingLog, setEditingLog] = useState<BodyCompLog | null>(null);
  const [prefill, setPrefill] = useState<BodyCompPrefill | null>(null);

  const refresh = useCallback(async () => {
    // Refetch rather than patching local state: creates can upsert-merge into
    // existing rows and every write re-runs server derivations.
    try {
      const [list, latestLog] = await Promise.all([
        bodyCompClient.list({ limit: PAGE_SIZE }),
        bodyCompClient.getLatest(),
      ]);
      setLogs(list.logs);
      setHasMore(list.hasMore);
      setNextBefore(list.nextBefore);
      setLatest(latestLog);
    } catch {
      // Keep whatever we had; the toast for the failed action already fired.
    }
    if (canTrends) {
      try {
        setTrends(await bodyCompClient.getTrends());
        setTrendsLocked(false);
      } catch (err) {
        if (err instanceof BodyCompApiError && err.code === 'PREMIUM_REQUIRED') {
          setTrendsLocked(true);
        }
      }
    }
  }, [canTrends]);

  const loadMore = useCallback(async () => {
    if (!nextBefore || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await bodyCompClient.list({ limit: PAGE_SIZE, before: nextBefore });
      setLogs((prev) => [...prev, ...page.logs]);
      setHasMore(page.hasMore);
      setNextBefore(page.nextBefore);
    } catch {
      // Leave the button enabled for a retry.
    } finally {
      setLoadingMore(false);
    }
  }, [nextBefore, loadingMore]);

  const openCreate = () => {
    setEditingLog(null);
    setPrefill(null);
    setModalOpen(true);
  };

  const openEdit = (log: BodyCompLog) => {
    setEditingLog(log);
    setPrefill(null);
    setModalOpen(true);
  };

  const openScanFallback = (scanPrefill: BodyCompPrefill) => {
    setEditingLog(null);
    setPrefill(scanPrefill);
    setModalOpen(true);
  };

  const onSaved = () => void refresh();

  const onDeleted = (id: string) => {
    setLogs((prev) => prev.filter((l) => l.id !== id));
    void refresh();
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 overflow-x-hidden">
      {/* Subtle circle background decoration */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-20 left-10 w-96 h-96 bg-indigo-500/5 rounded-full blur-3xl" />
        <div className="absolute top-40 right-20 w-[500px] h-[500px] bg-purple-500/5 rounded-full blur-3xl" />
        <div className="absolute bottom-20 left-1/3 w-[400px] h-[400px] bg-orange-500/5 rounded-full blur-3xl" />
      </div>

      <div className="relative mx-auto max-w-2xl px-3 sm:px-6 py-6 sm:py-8 space-y-6 sm:space-y-8">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-white">
              Body Composition
            </h1>
            <p className="text-sm text-gray-400">Your measurements, tracked privately.</p>
          </div>
          {canLog && (
            <Button
              onClick={openCreate}
              className="h-12 w-12 rounded-full p-0 shadow-lg transition-all hover:scale-105 hover:shadow-xl"
              aria-label="Log body composition"
            >
              <Plus size={24} />
            </Button>
          )}
        </div>

        {canLog ? (
          <>
            {/* Scan upload */}
            {canScan ? (
              <BodyCompScan
                unitSystem={unitSystem}
                onLowConfidence={openScanFallback}
                onSaved={onSaved}
              />
            ) : (
              <LockCard title="Scan an InBody / DEXA sheet" />
            )}

            {/* Trends */}
            <BodyCompTrendsSection trends={trends} locked={trendsLocked} unitSystem={unitSystem} />

            {/* Journal */}
            <div className="space-y-4">
              <h2 className="text-lg sm:text-xl font-semibold text-white">Journal</h2>
              <BodyCompJournal
                logs={logs}
                hasMore={hasMore}
                loadingMore={loadingMore}
                onLoadMore={() => void loadMore()}
                onEdit={openEdit}
                onDeleted={onDeleted}
                unitSystem={unitSystem}
              />
            </div>
          </>
        ) : (
          <LockCard title="Body composition journal" />
        )}
      </div>

      <BodyCompEntryModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        log={editingLog}
        prefill={prefill}
        latestWeightKg={latest?.weightKg ?? null}
        segmentalAllowed={canSegmental}
        onSaved={onSaved}
      />
    </div>
  );
}
