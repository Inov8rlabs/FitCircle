'use client';

import { forwardRef, useId } from 'react';

import { cn } from '@/lib/utils';

export const inputCls =
  'w-full rounded-lg border border-slate-700/80 bg-slate-950/60 px-3 py-2 text-sm text-white placeholder:text-slate-500 transition focus:border-purple-400 focus:outline-none focus:ring-2 focus:ring-purple-500/30 disabled:opacity-50';

export function Section({
  id,
  index,
  title,
  description,
  actions,
  children,
}: {
  id: string;
  index: number;
  title: string;
  description?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section id={id} data-section={id} className="scroll-mt-36 rounded-2xl border border-slate-800 bg-slate-900/50 p-4 backdrop-blur-xl sm:p-6">
      <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-purple-500/15 text-xs font-bold text-purple-200">{index}</span>
          <div>
            <h2 className="text-lg font-semibold text-white">{title}</h2>
            {description && <p className="mt-0.5 text-sm text-slate-400">{description}</p>}
          </div>
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </header>
      <div className="space-y-5">{children}</div>
    </section>
  );
}

export function Field({
  label,
  hint,
  error,
  count,
  max,
  children,
  className,
  htmlFor,
}: {
  label: string;
  hint?: React.ReactNode;
  error?: string | null;
  count?: number;
  max?: number;
  children: React.ReactNode;
  className?: string;
  htmlFor?: string;
}) {
  const over = max !== undefined && count !== undefined && count > max;
  return (
    <div className={cn('space-y-1.5', className)}>
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={htmlFor} className="text-xs font-medium uppercase tracking-wider text-slate-400">
          {label}
        </label>
        {max !== undefined && count !== undefined && (
          <span className={cn('text-[11px] tabular-nums', over ? 'font-semibold text-rose-400' : count > max * 0.9 ? 'text-amber-300' : 'text-slate-500')}>
            {count}/{max}
          </span>
        )}
      </div>
      {children}
      {error ? <p className="text-xs text-rose-400">{error}</p> : hint ? <p className="text-xs text-slate-500">{hint}</p> : null}
    </div>
  );
}

/** Grapheme-ish length (emoji count as 1 where the runtime supports Intl.Segmenter). */
export function textLength(s: string | null | undefined): number {
  const v = s ?? '';
  try {
    const Seg = (Intl as unknown as { Segmenter?: new (l?: string, o?: { granularity: string }) => { segment: (s: string) => Iterable<unknown> } }).Segmenter;
    if (Seg) return Array.from(new Seg(undefined, { granularity: 'grapheme' }).segment(v)).length;
  } catch {
    // fall through
  }
  return Array.from(v).length;
}

type TextProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value'> & {
  label: string;
  value: string;
  onChange: (v: string) => void;
  max?: number;
  hint?: React.ReactNode;
  error?: string | null;
  fieldClassName?: string;
};

export const TextField = forwardRef<HTMLInputElement, TextProps>(function TextField(
  { label, value, onChange, max, hint, error, fieldClassName, className, ...rest },
  ref
) {
  const id = useId();
  return (
    <Field label={label} hint={hint} error={error} count={max ? textLength(value) : undefined} max={max} className={fieldClassName} htmlFor={id}>
      <input ref={ref} id={id} value={value ?? ''} onChange={(e) => onChange(e.target.value)} className={cn(inputCls, className)} {...rest} />
    </Field>
  );
});

export function TextAreaField({
  label,
  value,
  onChange,
  max,
  hint,
  rows = 3,
  placeholder,
  className,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  max?: number;
  hint?: React.ReactNode;
  rows?: number;
  placeholder?: string;
  className?: string;
}) {
  const id = useId();
  return (
    <Field label={label} hint={hint} count={max ? textLength(value) : undefined} max={max} className={className} htmlFor={id}>
      <textarea id={id} rows={rows} value={value ?? ''} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} className={cn(inputCls, 'resize-y leading-relaxed')} />
    </Field>
  );
}

export function SelectField<T extends string | number>({
  label,
  value,
  onChange,
  options,
  hint,
  className,
}: {
  label: string;
  value: T;
  onChange: (v: T) => void;
  options: readonly { value: T; label: string }[];
  hint?: React.ReactNode;
  className?: string;
}) {
  const id = useId();
  return (
    <Field label={label} hint={hint} className={className} htmlFor={id}>
      <select
        id={id}
        value={String(value)}
        onChange={(e) => {
          const raw = e.target.value;
          const match = options.find((o) => String(o.value) === raw);
          if (match) onChange(match.value);
        }}
        className={cn(inputCls, 'appearance-none pr-8')}
        style={{ backgroundRepeat: 'no-repeat', backgroundSize: '16px', backgroundPosition: 'right 0.6rem center', backgroundColor: 'rgb(2 6 23 / 0.6)', backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%2394a3b8' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")" }}
      >
        {options.map((o) => (
          <option key={String(o.value)} value={String(o.value)}>
            {o.label}
          </option>
        ))}
      </select>
    </Field>
  );
}

export function Btn({
  children,
  variant = 'secondary',
  size = 'md',
  className,
  loading,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'success'; size?: 'sm' | 'md'; loading?: boolean }) {
  return (
    <button
      type="button"
      {...rest}
      disabled={rest.disabled || loading}
      className={cn(
        'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-lg font-medium transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50',
        size === 'sm' ? 'h-8 px-2.5 text-xs' : 'h-9 px-3.5 text-sm',
        variant === 'primary' && 'bg-gradient-to-r from-purple-600 to-fuchsia-600 text-white shadow-lg shadow-purple-900/30 hover:brightness-110',
        variant === 'secondary' && 'border border-slate-700 bg-slate-800/60 text-slate-100 hover:border-slate-600 hover:bg-slate-800',
        variant === 'ghost' && 'text-slate-300 hover:bg-slate-800 hover:text-white',
        variant === 'danger' && 'border border-rose-500/40 bg-rose-500/10 text-rose-300 hover:bg-rose-500/20',
        variant === 'success' && 'bg-emerald-600 text-white hover:bg-emerald-500',
        className
      )}
    >
      {loading && <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden />}
      {children}
    </button>
  );
}

export function Callout({ tone = 'info', children, className }: { tone?: 'info' | 'warn' | 'ok' | 'error'; children: React.ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'rounded-xl border px-3 py-2.5 text-sm',
        tone === 'info' && 'border-sky-500/30 bg-sky-500/10 text-sky-100',
        tone === 'warn' && 'border-amber-500/30 bg-amber-500/10 text-amber-100',
        tone === 'ok' && 'border-emerald-500/30 bg-emerald-500/10 text-emerald-100',
        tone === 'error' && 'border-rose-500/30 bg-rose-500/10 text-rose-100',
        className
      )}
    >
      {children}
    </div>
  );
}

export function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label?: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition disabled:opacity-50',
        checked ? 'bg-emerald-500' : 'bg-slate-700'
      )}
    >
      <span className={cn('inline-block h-4 w-4 rounded-full bg-white shadow transition', checked ? 'translate-x-[18px]' : 'translate-x-0.5')} />
    </button>
  );
}

export function StatusPill({ status }: { status: string }) {
  const map: Record<string, string> = {
    draft: 'bg-slate-700/60 text-slate-200',
    scheduled: 'bg-sky-500/15 text-sky-300 ring-1 ring-sky-500/30',
    live: 'bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30',
    ended: 'bg-amber-500/10 text-amber-300 ring-1 ring-amber-500/20',
    archived: 'bg-slate-800 text-slate-500',
    paused: 'bg-orange-500/15 text-orange-300 ring-1 ring-orange-500/30',
    new: 'bg-purple-500/15 text-purple-200 ring-1 ring-purple-500/30',
  };
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize', map[status] ?? map.draft)}>
      {status === 'live' && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />}
      {status}
    </span>
  );
}

/** Trigger a browser download for a URL or Blob. */
export async function downloadFile(src: string | Blob, filename: string): Promise<void> {
  let url: string;
  let revoke = false;
  if (typeof src === 'string') {
    try {
      const res = await fetch(src);
      url = URL.createObjectURL(await res.blob());
      revoke = true;
    } catch {
      url = src;
    }
  } else {
    url = URL.createObjectURL(src);
    revoke = true;
  }
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  if (revoke) setTimeout(() => URL.revokeObjectURL(url), 2000);
}
