'use client';

import { format } from 'date-fns';
import { Loader2, Pencil, PersonStanding, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { bodyCompClient, BodyCompApiError } from '@/lib/api/body-comp-client';
import type { BodyCompLog } from '@/lib/types/body-composition';
import { cn } from '@/lib/utils';
import type { UnitSystem } from '@/lib/utils/units';

import { formatMass, formatPct, SOURCE_BADGE_CLASSES, SOURCE_LABELS } from './format';

// ---------------------------------------------------------------------------
// Journal list (BODY_COMP_BUILD_CONTRACT §3): reverse-chronological entry
// cards — date, weight, BF%, SMM, source badge — tap → edit, trash → delete.
// Private-only: nothing here is ever shared to circles/feeds.
// ---------------------------------------------------------------------------

interface BodyCompJournalProps {
  logs: BodyCompLog[];
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
  onEdit: (log: BodyCompLog) => void;
  onDeleted: (id: string) => void;
  unitSystem: UnitSystem;
}

export function BodyCompJournal({
  logs,
  hasMore,
  loadingMore,
  onLoadMore,
  onEdit,
  onDeleted,
  unitSystem,
}: BodyCompJournalProps) {
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const handleDelete = async (id: string) => {
    setDeletingId(id);
    try {
      await bodyCompClient.delete(id);
      onDeleted(id);
      toast.success('Entry deleted');
    } catch (err) {
      const message =
        err instanceof BodyCompApiError ? err.message : 'Could not delete the entry.';
      toast.error(message);
    } finally {
      setDeletingId(null);
    }
  };

  if (logs.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-800 bg-slate-900/30 py-16 text-center">
        <PersonStanding className="mx-auto mb-4 h-12 w-12 text-gray-600" aria-hidden="true" />
        <h3 className="text-lg font-medium text-white">No entries yet</h3>
        <p className="text-gray-400">Log a measurement or scan a report to get started.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {logs.map((log) => (
        <JournalCard
          key={log.id}
          log={log}
          unitSystem={unitSystem}
          deleting={deletingId === log.id}
          onEdit={() => onEdit(log)}
          onDelete={() => void handleDelete(log.id)}
        />
      ))}

      {hasMore && (
        <Button
          variant="outline"
          className="w-full"
          onClick={onLoadMore}
          disabled={loadingMore}
        >
          {loadingMore && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Load more
        </Button>
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-[72px]">
      <p className="text-[11px] uppercase tracking-wider text-gray-500">{label}</p>
      <p className={cn('text-sm font-semibold', value === '—' ? 'text-gray-600' : 'text-white')}>
        {value}
      </p>
    </div>
  );
}

function JournalCard({
  log,
  unitSystem,
  deleting,
  onEdit,
  onDelete,
}: {
  log: BodyCompLog;
  unitSystem: UnitSystem;
  deleting: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const measured = new Date(log.measuredAt);

  return (
    <div className="group flex items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-900/50 backdrop-blur-xl p-4 transition-all hover:border-indigo-500/30 hover:shadow-md">
      <button type="button" onClick={onEdit} className="flex-1 min-w-0 text-left cursor-pointer">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-semibold text-white">
            {format(measured, 'EEE, MMM d, yyyy')}
            <span className="ml-1.5 font-normal text-gray-500">{format(measured, 'h:mm a')}</span>
          </p>
          <span
            className={cn(
              'inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold',
              SOURCE_BADGE_CLASSES[log.source]
            )}
          >
            {SOURCE_LABELS[log.source]}
          </span>
          {log.segmental && (
            <span className="inline-flex items-center rounded-full border border-slate-700 bg-slate-800/60 px-2 py-0.5 text-[10px] font-medium text-gray-400">
              Segmental
            </span>
          )}
        </div>
        <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1">
          <Metric label="Weight" value={formatMass(log.weightKg, unitSystem)} />
          <Metric label="Body fat" value={formatPct(log.bodyFatPct)} />
          <Metric label="Skeletal muscle" value={formatMass(log.skeletalMuscleMassKg, unitSystem)} />
        </div>
        {log.notes && <p className="mt-1.5 truncate text-xs text-gray-500">{log.notes}</p>}
      </button>

      <div className="flex flex-shrink-0 items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          onClick={onEdit}
          className="text-gray-500 opacity-0 transition-opacity group-hover:opacity-100 hover:text-white"
          aria-label="Edit entry"
        >
          <Pencil size={16} />
        </Button>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              disabled={deleting}
              className="text-gray-500 opacity-0 transition-opacity group-hover:opacity-100 hover:bg-destructive/10 hover:text-destructive"
              aria-label="Delete entry"
            >
              {deleting ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete entry?</AlertDialogTitle>
              <AlertDialogDescription>This action cannot be undone.</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={onDelete}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}
