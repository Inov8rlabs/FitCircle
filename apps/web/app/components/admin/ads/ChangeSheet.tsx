'use client';

import { AlertTriangle, CheckCircle2, Lock, Pencil, XCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { Btn } from '@/components/admin/campaigns/fields';
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { adsAdmin, type ChangeInput } from '@/lib/ads/admin-client';
import type { AdChangeResult, CampaignDetailEntity, FieldEditability } from '@/lib/ads/types';
import { cn } from '@/lib/utils';

import { money, signedPct } from './format';
import { errorText } from './parts';

export type EditField = 'bid' | 'daily_budget' | 'status';

const FIELD_LABEL: Record<EditField, string> = { bid: 'Bid', daily_budget: 'Daily budget', status: 'Status' };
const LEVEL_LABEL: Record<string, string> = { campaign: 'Campaign', ad_group: 'Ad group', keyword: 'Keyword', ad: 'Ad' };

export interface EditTarget {
  entity: CampaignDetailEntity;
  field: EditField;
  /** Preset value (status toggles). */
  value?: string;
}

const current = (e: CampaignDetailEntity, f: EditField): number | string | null => (f === 'bid' ? e.bidAmount : f === 'daily_budget' ? e.dailyBudget : e.status);

/** Inline value with an edit affordance, or read-only + reason. */
export function EditableMoney({ entity, field, edit, onEdit }: { entity: CampaignDetailEntity; field: 'bid' | 'daily_budget'; edit: FieldEditability; onEdit: (t: EditTarget) => void }) {
  const v = current(entity, field) as number | null;
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="tabular-nums text-white">{money(v)}</span>
      {edit.editable ? (
        <button
          type="button"
          onClick={() => onEdit({ entity, field })}
          className="rounded-md p-1 text-slate-400 hover:bg-slate-800 hover:text-white"
          aria-label={`Edit ${FIELD_LABEL[field].toLowerCase()} for ${entity.name ?? entity.externalId}`}
        >
          <Pencil className="h-3.5 w-3.5" />
        </button>
      ) : (
        v !== null && (
          <span className="inline-flex cursor-help items-center text-slate-600" title={edit.reason ?? 'Read-only'}>
            <Lock className="h-3 w-3" aria-hidden />
            <span className="sr-only">{edit.reason ?? 'Read-only'}</span>
          </span>
        )
      )}
    </span>
  );
}

export function ChangeSheet({ target, onClose, onApplied }: { target: EditTarget | null; onClose: () => void; onApplied: () => void }) {
  const [value, setValue] = useState('');
  const [force, setForce] = useState(false);
  const [check, setCheck] = useState<AdChangeResult | null>(null);
  const [busy, setBusy] = useState<'check' | 'apply' | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!target) return;
    const cur = current(target.entity, target.field);
    setValue(target.value ?? (cur === null ? '' : String(cur)));
    setForce(false);
    setCheck(null);
    setError(null);
  }, [target]);

  if (!target) return null;
  const { entity, field } = target;
  const old = current(entity, field);
  const isMoney = field !== 'status';

  const input = (dryRun: boolean): ChangeInput => ({
    channel: entity.channel,
    level: entity.level as ChangeInput['level'],
    externalId: entity.externalId,
    field,
    value: isMoney ? Number(value) : value,
    dryRun,
    force: force || undefined,
    expectedOldValue: old,
  });

  const runCheck = async () => {
    setBusy('check');
    setError(null);
    try {
      setCheck(await adsAdmin.change(input(true)));
    } catch (e) {
      setError(errorText(e, 'Check failed'));
    } finally {
      setBusy(null);
    }
  };

  const apply = async () => {
    setBusy('apply');
    setError(null);
    try {
      const res = await adsAdmin.change(input(false));
      if (res.outcome === 'applied') {
        toast.success(`${FIELD_LABEL[field]} is now ${isMoney ? money(Number(res.newValue)) : String(res.newValue)} (confirmed by the network)`);
        onApplied();
        onClose();
      } else {
        setCheck(res);
        setError(res.message ?? 'Change rejected');
      }
    } catch (e) {
      setError(errorText(e, 'Apply failed'));
    } finally {
      setBusy(null);
    }
  };

  const stepFailed = check?.checks.some((c) => c.rule === 'step_limit' && !c.ok);
  const checkedValue = check ? String(check.requestedValue) : null;
  const dirty = checkedValue !== null && (isMoney ? Number(value).toFixed(2) !== Number(checkedValue).toFixed(2) : value.toUpperCase() !== checkedValue);
  const canApply = !!check && check.ok && check.outcome === 'dry_run' && !dirty;

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>
            {field === 'status' ? `${value === 'PAUSED' ? 'Pause' : 'Enable'} ${LEVEL_LABEL[entity.level]?.toLowerCase()}` : `Change ${FIELD_LABEL[field].toLowerCase()}`}
          </SheetTitle>
          <SheetDescription>
            {LEVEL_LABEL[entity.level]} · {entity.name ?? entity.externalId}
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-4">
          {isMoney ? (
            <label className="block space-y-1.5">
              <span className="text-xs font-medium uppercase tracking-wider text-slate-400">New {FIELD_LABEL[field].toLowerCase()} (USD)</span>
              <div className="relative">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500">$</span>
                <input
                  autoFocus
                  inputMode="decimal"
                  type="number"
                  step="0.01"
                  min="0"
                  value={value}
                  onChange={(e) => {
                    setValue(e.target.value);
                    setForce(false);
                  }}
                  className="h-11 w-full rounded-lg border border-slate-700/80 bg-slate-950/60 pl-7 pr-3 text-lg tabular-nums text-white focus:border-purple-400 focus:outline-none focus:ring-2 focus:ring-purple-500/30"
                />
              </div>
            </label>
          ) : (
            <p className="text-sm text-slate-300">
              {String(old ?? '—')} → <span className="font-semibold text-white">{value}</span>
            </p>
          )}

          {check && (
            <div className="space-y-3 rounded-xl border border-slate-800 bg-slate-950/50 p-3">
              <div className="grid grid-cols-3 gap-2 text-center">
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-slate-500">Current</p>
                  <p className="tabular-nums text-white">{isMoney ? money(Number(check.oldValue)) : String(check.oldValue ?? '—')}</p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-slate-500">New</p>
                  <p className="tabular-nums text-white">{isMoney ? money(Number(check.requestedValue)) : String(check.requestedValue)}</p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-slate-500">Change</p>
                  <p className={cn('tabular-nums', check.pctChange !== null && Math.abs(check.pctChange) > 50 ? 'text-amber-300' : 'text-white')}>{signedPct(check.pctChange)}</p>
                </div>
              </div>
              <p className="text-xs text-slate-400">Spend today on this {LEVEL_LABEL[entity.level]?.toLowerCase()}: {money(check.todaySpend)}</p>
              <ul className="space-y-1">
                {check.checks.map((c) => (
                  <li key={c.rule} className="flex items-start gap-2 text-xs">
                    {c.ok ? <CheckCircle2 className="mt-px h-3.5 w-3.5 shrink-0 text-emerald-400" aria-hidden /> : <XCircle className="mt-px h-3.5 w-3.5 shrink-0 text-rose-400" aria-hidden />}
                    <span className={c.ok ? 'text-slate-300' : 'text-rose-200'}>
                      <span className="sr-only">{c.ok ? 'Pass: ' : 'Fail: '}</span>
                      {c.message}
                    </span>
                  </li>
                ))}
              </ul>
              {stepFailed && (
                <label className="flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-2 text-xs text-amber-100">
                  <input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} className="accent-amber-400" />
                  Override the ±50% step limit (logged as forced), then check again
                </label>
              )}
              {dirty && <p className="text-xs text-amber-300">Value changed since the check: check again.</p>}
            </div>
          )}

          {error && (
            <p className="flex items-start gap-2 text-sm text-rose-300">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
            </p>
          )}
        </div>

        <SheetFooter>
          <Btn variant="ghost" onClick={onClose}>
            Cancel
          </Btn>
          <Btn onClick={() => void runCheck()} loading={busy === 'check'} disabled={isMoney && !(Number(value) > 0)}>
            {check ? 'Check again' : 'Check (dry run)'}
          </Btn>
          <Btn variant="primary" onClick={() => void apply()} loading={busy === 'apply'} disabled={!canApply}>
            Apply
          </Btn>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
