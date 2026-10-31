'use client';

import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';

import { ATTRIBUTES, ATTRIBUTE_BY_KEY, OP_LABEL, conditionValid, defaultCondition, normalizeCondition, opsFor } from '@/lib/engage/preview/attributes';
import type { AttributeKey, FilterCondition, FilterOp } from '@/lib/engage/types';
import { cn } from '@/lib/utils';

import { Btn, inputCls } from './ui';

const selectCls = cn(inputCls, 'h-9 py-1.5');

/** AND-list of attribute conditions. */
export function FilterBuilder({ value, onChange, emptyLabel = 'Everyone matches. Add a condition to narrow it down.' }: { value: FilterCondition[]; onChange: (v: FilterCondition[]) => void; emptyLabel?: string }) {
  const set = (i: number, c: FilterCondition) => onChange(value.map((x, j) => (j === i ? normalizeCondition(c) : x)));
  return (
    <div className="space-y-2">
      {value.length === 0 && <p className="rounded-lg border border-dashed border-slate-800 px-3 py-2.5 text-xs text-slate-500">{emptyLabel}</p>}
      {value.map((c, i) => (
        <div key={i} className="flex flex-wrap items-center gap-2">
          <span className="w-10 shrink-0 text-right text-[11px] font-semibold uppercase text-slate-500">{i === 0 ? 'Where' : 'and'}</span>
          <ConditionRow c={c} onChange={(n) => set(i, n)} />
          <button type="button" onClick={() => onChange(value.filter((_, j) => j !== i))} className="rounded p-1.5 text-slate-500 hover:bg-slate-800 hover:text-rose-300" aria-label="Remove condition">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
      <AddCondition onAdd={(k) => onChange([...value, defaultCondition(k)])} />
    </div>
  );
}

function AddCondition({ onAdd }: { onAdd: (k: AttributeKey) => void }) {
  const [open, setOpen] = useState(false);
  const groups = Array.from(new Set(ATTRIBUTES.map((a) => a.group)));
  return (
    <div className="relative pl-12">
      <Btn size="sm" variant="ghost" onClick={() => setOpen((o) => !o)}>
        <Plus className="h-3.5 w-3.5" /> Add condition
      </Btn>
      {open && (
        <div className="absolute left-12 top-9 z-30 grid w-[420px] max-w-[85vw] grid-cols-2 gap-x-3 gap-y-1 rounded-xl border border-slate-800 bg-slate-950 p-3 shadow-2xl">
          {groups.map((g) => (
            <div key={g} className="space-y-0.5">
              <p className="px-1.5 pt-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">{g}</p>
              {ATTRIBUTES.filter((a) => a.group === g).map((a) => (
                <button
                  key={a.key}
                  type="button"
                  title={a.hint}
                  onClick={() => {
                    onAdd(a.key);
                    setOpen(false);
                  }}
                  className="block w-full rounded-md px-1.5 py-1 text-left text-xs text-slate-200 hover:bg-slate-800"
                >
                  {a.label}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ConditionRow({ c, onChange }: { c: FilterCondition; onChange: (c: FilterCondition) => void }) {
  const meta = ATTRIBUTE_BY_KEY[c.key];
  const ops = opsFor(meta.type);
  const invalid = !conditionValid(c);
  return (
    <div className={cn('flex min-w-0 flex-1 flex-wrap items-center gap-2 rounded-lg p-1', invalid && 'bg-rose-500/5 ring-1 ring-rose-500/30')}>
      <select value={c.key} onChange={(e) => onChange(defaultCondition(e.target.value as AttributeKey))} className={cn(selectCls, 'w-48')} aria-label="Attribute">
        {ATTRIBUTES.map((a) => (
          <option key={a.key} value={a.key}>
            {a.label}
          </option>
        ))}
      </select>
      {meta.type !== 'boolean' && (
        <select value={c.op} onChange={(e) => onChange({ ...c, op: e.target.value as FilterOp })} className={cn(selectCls, 'w-32')} aria-label="Operator">
          {ops.map((o) => (
            <option key={o} value={o}>
              {OP_LABEL[o]}
            </option>
          ))}
        </select>
      )}
      <ValueInput c={c} onChange={onChange} />
    </div>
  );
}

function ValueInput({ c, onChange }: { c: FilterCondition; onChange: (c: FilterCondition) => void }) {
  const meta = ATTRIBUTE_BY_KEY[c.key];
  if (c.op === 'exists' || c.op === 'not_exists') return null;
  if (meta.type === 'boolean') {
    return (
      <select value={String(c.value)} onChange={(e) => onChange({ ...c, value: e.target.value === 'true' })} className={cn(selectCls, 'w-28')} aria-label="Value">
        <option value="true">is true</option>
        <option value="false">is false</option>
      </select>
    );
  }
  if (c.op === 'in' || c.op === 'not_in') {
    const arr = Array.isArray(c.value) ? c.value.map(String) : [];
    if (meta.options) {
      return (
        <div className="flex flex-wrap gap-1">
          {meta.options.map((o) => (
            <button
              key={o}
              type="button"
              onClick={() => onChange({ ...c, value: arr.includes(o) ? arr.filter((x) => x !== o) : [...arr, o] })}
              className={cn('rounded-full px-2.5 py-1 text-xs', arr.includes(o) ? 'bg-purple-500/25 text-white' : 'bg-slate-800 text-slate-400')}
            >
              {o}
            </button>
          ))}
        </div>
      );
    }
    return <input value={arr.join(', ')} onChange={(e) => onChange({ ...c, value: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })} placeholder="comma, separated" className={cn(selectCls, 'min-w-[10rem] flex-1')} aria-label="Values" />;
  }
  if (meta.options) {
    return (
      <select value={String(c.value ?? '')} onChange={(e) => onChange({ ...c, value: e.target.value })} className={cn(selectCls, 'w-32')} aria-label="Value">
        {meta.options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    );
  }
  return (
    <span className="flex items-center gap-1.5">
      <input
        type={meta.type === 'number' ? 'number' : 'text'}
        value={c.value == null ? '' : String(c.value)}
        onChange={(e) => onChange({ ...c, value: meta.type === 'number' ? Number(e.target.value) : e.target.value })}
        className={cn(selectCls, meta.type === 'number' ? 'w-24' : 'w-44')}
        aria-label="Value"
      />
      {meta.unit && <span className="text-xs text-slate-500">{meta.unit}</span>}
    </span>
  );
}
