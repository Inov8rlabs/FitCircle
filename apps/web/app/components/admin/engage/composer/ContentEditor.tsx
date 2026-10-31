'use client';

import { Braces, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';

import { CONTENT_LIMITS, DEFAULT_THEME, PERSONALISATION_TOKENS, PLATFORM_LABEL } from '@/lib/engage/preview/content';
import type { EmailContent, EngageButton, EngagePlatform, EngageTheme, MessageContent, MessageVariant, PushContent } from '@/lib/engage/types';
import { cn } from '@/lib/utils';

import { ImageWell } from '../assets/AssetPicker';
import { Btn, Field, PlatformIcon, SegmentedControl, Toggle, inputCls, textLength } from '../ui';

import { ActionPicker } from './ActionPicker';

export type EditTarget = 'all' | EngagePlatform;

/** Field access that writes to the base content or to a platform override. */
function useAccess<C extends object>(variant: MessageVariant<C>, target: EditTarget, onChange: (v: MessageVariant<C>) => void) {
  const ov = target === 'all' ? undefined : (variant.platformOverrides?.[target]);
  return {
    get<K extends keyof C>(k: K): C[K] {
      if (ov && ov[k] !== undefined) return ov[k] as C[K];
      return variant.content[k];
    },
    overridden: (k: keyof C) => Boolean(ov && ov[k] !== undefined),
    set<K extends keyof C>(k: K, v: C[K]) {
      if (target === 'all') return onChange({ ...variant, content: { ...variant.content, [k]: v } });
      const cur = (variant.platformOverrides ?? {});
      onChange({ ...variant, platformOverrides: { ...cur, [target]: { ...(cur[target] ?? {}), [k]: v } } as MessageVariant<C>['platformOverrides'] });
    },
    reset(k: keyof C) {
      if (target === 'all') return;
      const cur = { ...((variant.platformOverrides ?? {})) };
      const p: Partial<C> = { ...(cur[target] ?? {}) } as Partial<C>;
      delete p[k];
      if (Object.keys(p).length) cur[target] = p;
      else delete cur[target];
      onChange({ ...variant, platformOverrides: cur as MessageVariant<C>['platformOverrides'] });
    },
  };
}

function OverrideMark({ on, onReset, target }: { on: boolean; onReset: () => void; target: EditTarget }) {
  if (target === 'all') return null;
  return on ? (
    <button type="button" onClick={onReset} className="inline-flex items-center gap-1 rounded-full bg-sky-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-sky-300 hover:bg-sky-500/25" title="Reset to the all-platforms value">
      <PlatformIcon p={target} className="h-2.5 w-2.5" /> override <RotateCcw className="h-2.5 w-2.5" />
    </button>
  ) : (
    <span className="text-[10px] text-slate-600">inherits</span>
  );
}

/** Text input/area with a personalisation inserter that inserts at the cursor. */
function PField({
  label,
  value,
  onChange,
  max,
  multiline,
  rows = 3,
  placeholder,
  mark,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  max?: number;
  multiline?: boolean;
  rows?: number;
  placeholder?: string;
  mark?: React.ReactNode;
}) {
  const ref = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const [open, setOpen] = useState(false);
  const insert = (token: string) => {
    const el = ref.current;
    const s = el?.selectionStart ?? value.length;
    const e = el?.selectionEnd ?? value.length;
    const next = `${value.slice(0, s)}${token}${value.slice(e)}`;
    onChange(next);
    setOpen(false);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(s + token.length, s + token.length);
    });
  };
  const count = textLength(value);
  return (
    <Field label={label} count={max ? count : undefined} max={max}>
      <div className="relative">
        {multiline ? (
          <textarea ref={ref} rows={rows} value={value ?? ''} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} className={cn(inputCls, 'resize-y pr-10 leading-relaxed')} />
        ) : (
          <input ref={ref} value={value ?? ''} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} className={cn(inputCls, 'pr-10')} />
        )}
        <button type="button" onClick={() => setOpen((o) => !o)} className="absolute right-1.5 top-1.5 rounded-md p-1 text-slate-400 hover:bg-slate-800 hover:text-purple-200" title="Insert personalisation" aria-label="Insert personalisation">
          <Braces className="h-4 w-4" />
        </button>
        {open && (
          <div className="absolute right-0 top-9 z-30 w-60 rounded-xl border border-slate-800 bg-slate-950 p-1.5 shadow-2xl">
            {PERSONALISATION_TOKENS.map((t) => (
              <button key={t.key} type="button" onClick={() => insert(`{{${t.key}}}`)} className="flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left text-xs hover:bg-slate-800">
                <span className="text-white">{t.label}</span>
                <span className="font-mono text-[10px] text-purple-300">{`{{${t.key}}}`}</span>
              </button>
            ))}
            <button type="button" onClick={() => insert('{{first_name | default: "friend"}}')} className="mt-1 w-full rounded-lg border-t border-slate-800 px-2 py-1.5 text-left text-[11px] text-slate-400 hover:bg-slate-800">
              With a fallback: <span className="font-mono text-purple-300">| default: &quot;friend&quot;</span>
            </button>
          </div>
        )}
      </div>
      {mark && <div className="mt-1">{mark}</div>}
    </Field>
  );
}

export const THEME_PRESETS: readonly { name: string; theme: Required<EngageTheme> }[] = [
  { name: 'Brand', theme: DEFAULT_THEME },
  { name: 'Midnight', theme: { background: '#0b1023', text: '#e2e8f0', accent: '#38bdf8', buttonBackground: '#0ea5e9', buttonText: '#ffffff' } },
  { name: 'Sunrise', theme: { background: '#2a1238', text: '#fff7ed', accent: '#fbbf24', buttonBackground: '#f97316', buttonText: '#ffffff' } },
  { name: 'Mint', theme: { background: '#062925', text: '#ecfdf5', accent: '#34d399', buttonBackground: '#10b981', buttonText: '#022c22' } },
  { name: 'Rose', theme: { background: '#2b0f1f', text: '#fff1f2', accent: '#fb7185', buttonBackground: '#e11d48', buttonText: '#ffffff' } },
  { name: 'Light', theme: { background: '#ffffff', text: '#0f172a', accent: '#7c3aed', buttonBackground: '#7c3aed', buttonText: '#ffffff' } },
];

const THEME_KEYS: { k: keyof EngageTheme; label: string }[] = [
  { k: 'background', label: 'Background' },
  { k: 'text', label: 'Text' },
  { k: 'accent', label: 'Accent' },
  { k: 'buttonBackground', label: 'Button' },
  { k: 'buttonText', label: 'Button text' },
];

export function EditTargetBar({ target, onChange, overrides }: { target: EditTarget; onChange: (t: EditTarget) => void; overrides: Partial<Record<EngagePlatform, unknown>> | undefined }) {
  const opts: { value: EditTarget; label: React.ReactNode }[] = [
    { value: 'all', label: 'All platforms' },
    ...(['ios', 'android', 'web'] as EngagePlatform[]).map((p) => ({
      value: p as EditTarget,
      label: (
        <span className="inline-flex items-center gap-1">
          <PlatformIcon p={p} className="h-3 w-3" /> {PLATFORM_LABEL[p]}
          {Boolean(overrides?.[p]) && Object.keys(overrides?.[p] as object).length > 0 && <span className="h-1.5 w-1.5 rounded-full bg-sky-400" />}
        </span>
      ),
    })),
  ];
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs text-slate-400">Editing</span>
      <SegmentedControl value={target} onChange={onChange} options={opts} size="sm" />
      {target !== 'all' && <span className="text-[11px] text-sky-300">Changes here apply only on {PLATFORM_LABEL[target]}</span>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Card / in-app content
// ---------------------------------------------------------------------------

export function CardContentEditor({
  variant,
  onChange,
  target,
  isCard,
  layout,
  onLocalPreview,
}: {
  variant: MessageVariant<MessageContent>;
  onChange: (v: MessageVariant<MessageContent>) => void;
  target: EditTarget;
  isCard: boolean;
  layout: string | null;
  onLocalPreview: (url: string | null) => void;
}) {
  const a = useAccess(variant, target, onChange);
  const buttons = a.get('buttons') ?? [];
  const theme = a.get('theme') ?? {};
  const setButtons = (b: EngageButton[]) => a.set('buttons', b);
  const image = a.get('image');
  const mark = (k: keyof MessageContent) => <OverrideMark on={a.overridden(k)} onReset={() => a.reset(k)} target={target} />;

  return (
    <div className="space-y-5">
      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="space-y-2">
          <ImageWell
            assetId={image?.assetId ?? null}
            onChange={(id) => a.set('image', id ? { assetId: id } : null)}
            hint={layout === 'card' ? 'Shown 88×88' : layout === 'banner' || layout === 'slideup' ? 'Shown 44×44' : layout === 'image_only' ? 'Own aspect, max 4:5' : '16:9 recommended'}
            aspect={layout === 'card' || layout === 'banner' || layout === 'slideup' ? 'aspect-square max-h-44' : layout === 'captioned_image' ? 'aspect-[4/3]' : 'aspect-[16/9]'}
            onLocalPreview={onLocalPreview}
          />
          {mark('image')}
          <div className="flex items-center gap-3">
            <SegmentedControl
              size="sm"
              value={a.get('imageFit') ?? 'cover'}
              onChange={(v) => a.set('imageFit', v)}
              options={[
                { value: 'cover', label: 'Fill' },
                { value: 'contain', label: 'Fit' },
              ]}
            />
            <input value={a.get('imageAlt') ?? ''} onChange={(e) => a.set('imageAlt', e.target.value || null)} placeholder="Alt text (accessibility)" className={cn(inputCls, 'h-8 text-xs')} />
          </div>
        </div>
        <div className="space-y-4">
          <PField label="Badge" value={a.get('badge') ?? ''} onChange={(v) => a.set('badge', v || null)} max={CONTENT_LIMITS.badge} placeholder="NEW" mark={mark('badge')} />
          <PField label="Title" value={a.get('title') ?? ''} onChange={(v) => a.set('title', v)} max={CONTENT_LIMITS.title} placeholder="Start your winter circle" mark={mark('title')} />
          <PField label="Body" value={a.get('body') ?? ''} onChange={(v) => a.set('body', v)} max={CONTENT_LIMITS.body} multiline placeholder="Hey {{first_name}}, …" mark={mark('body')} />
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-slate-400">Buttons {mark('buttons')}</p>
          {buttons.length < 2 && (
            <Btn size="sm" variant="ghost" onClick={() => setButtons([...buttons, { label: buttons.length ? 'Not now' : 'Take a look', action: buttons.length ? { type: 'dismiss' } : { type: 'deeplink', value: 'circles' }, style: buttons.length ? 'secondary' : 'primary' }])}>
              <Plus className="h-3.5 w-3.5" /> Add button
            </Btn>
          )}
        </div>
        {buttons.length === 0 && <p className="text-xs text-slate-500">No buttons. {isCard ? 'The whole card is tappable only for captioned/image layouts.' : 'Users can close it with ×.'}</p>}
        {buttons.map((b, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-800 bg-slate-950/40 p-2">
            <input value={b.label} maxLength={40} onChange={(e) => setButtons(buttons.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} className={cn(inputCls, 'h-9 w-40', textLength(b.label) > CONTENT_LIMITS.buttonLabel && 'border-rose-500/60')} placeholder="Label" aria-label={`Button ${i + 1} label`} />
            <SegmentedControl
              size="sm"
              value={b.style}
              onChange={(style) => setButtons(buttons.map((x, j) => (j === i ? { ...x, style } : x)))}
              options={[
                { value: 'primary', label: 'Primary' },
                { value: 'secondary', label: 'Secondary' },
              ]}
            />
            <ActionPicker value={b.action} onChange={(action) => setButtons(buttons.map((x, j) => (j === i ? { ...x, action } : x)))} />
            <button type="button" onClick={() => setButtons(buttons.filter((_, j) => j !== i))} className="ml-auto rounded p-1.5 text-slate-500 hover:bg-slate-800 hover:text-rose-300" aria-label="Remove button">
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>

      <div className="space-y-2">
        <p className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-slate-400">Theme {mark('theme')}</p>
        <div className="flex flex-wrap gap-2">
          {THEME_PRESETS.map((p) => {
            const active = THEME_KEYS.every(({ k }) => (theme[k] ?? DEFAULT_THEME[k]).toLowerCase() === p.theme[k].toLowerCase());
            return (
              <button key={p.name} type="button" onClick={() => a.set('theme', { ...p.theme })} className={cn('flex items-center gap-2 rounded-lg border px-2 py-1.5 text-xs transition', active ? 'border-white/70 text-white' : 'border-slate-800 text-slate-400 hover:border-slate-600')}>
                <span className="flex h-5 w-8 overflow-hidden rounded" style={{ background: p.theme.background }}>
                  <span className="m-auto h-2.5 w-4 rounded-sm" style={{ background: p.theme.buttonBackground }} />
                </span>
                {p.name}
              </button>
            );
          })}
        </div>
        <div className="flex flex-wrap gap-3">
          {THEME_KEYS.map(({ k, label }) => (
            <label key={k} className="flex items-center gap-1.5 text-xs text-slate-400">
              <input type="color" value={theme[k] ?? DEFAULT_THEME[k]} onChange={(e) => a.set('theme', { ...theme, [k]: e.target.value })} className="h-7 w-9 cursor-pointer rounded border border-slate-700 bg-transparent" />
              {label}
            </label>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap gap-5">
        <label className="flex items-center gap-2 text-sm text-slate-300">
          <Toggle checked={a.get('dismissible')} onChange={(v) => a.set('dismissible', v)} label="Dismissible" /> Dismissible (×)
        </label>
        {isCard && (
          <label className="flex items-center gap-2 text-sm text-slate-300">
            <Toggle checked={a.get('pinned')} onChange={(v) => a.set('pinned', v)} label="Pinned" /> Pinned to the top
          </label>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Push / email
// ---------------------------------------------------------------------------

export function PushContentEditor({ variant, onChange, target }: { variant: MessageVariant<PushContent>; onChange: (v: MessageVariant<PushContent>) => void; target: EditTarget }) {
  const a = useAccess(variant, target, onChange);
  const mark = (k: keyof PushContent) => <OverrideMark on={a.overridden(k)} onReset={() => a.reset(k)} target={target} />;
  return (
    <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_220px]">
      <div className="space-y-4">
        <PField label="Title" value={a.get('title')} onChange={(v) => a.set('title', v)} max={CONTENT_LIMITS.pushTitle} placeholder="Your circle misses you 👋" mark={mark('title')} />
        <PField label="Body" value={a.get('body')} onChange={(v) => a.set('body', v)} max={CONTENT_LIMITS.pushBody} multiline rows={2} placeholder="{{first_name}}, a quick check-in keeps your {{streak}}-day streak alive." mark={mark('body')} />
        <Field label="On tap">
          <ActionPicker value={a.get('action')} onChange={(v) => a.set('action', v)} allow={['deeplink', 'invite', 'paywall', 'start_circle', 'campaign', 'url']} />
        </Field>
      </div>
      <div className="space-y-1">
        <ImageWell assetId={a.get('image')?.assetId ?? null} onChange={(id) => a.set('image', id ? { assetId: id } : null)} label="Rich image (optional)" aspect="aspect-[2/1]" />
        {mark('image')}
      </div>
    </div>
  );
}

export function EmailContentEditor({ variant, onChange, target, onLocalPreview }: { variant: MessageVariant<EmailContent>; onChange: (v: MessageVariant<EmailContent>) => void; target: EditTarget; onLocalPreview: (url: string | null) => void }) {
  const a = useAccess(variant, target, onChange);
  const mark = (k: keyof EmailContent) => <OverrideMark on={a.overridden(k)} onReset={() => a.reset(k)} target={target} />;
  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        <PField label="Subject" value={a.get('subject')} onChange={(v) => a.set('subject', v)} max={CONTENT_LIMITS.subject} mark={mark('subject')} />
        <PField label="Preheader" value={a.get('preheader')} onChange={(v) => a.set('preheader', v)} max={CONTENT_LIMITS.preheader} mark={mark('preheader')} />
      </div>
      <ImageWell assetId={a.get('image')?.assetId ?? null} onChange={(id) => a.set('image', id ? { assetId: id } : null)} label="Header image" aspect="aspect-[5/2]" onLocalPreview={onLocalPreview} />
      <PField label="Heading" value={a.get('heading')} onChange={(v) => a.set('heading', v)} max={CONTENT_LIMITS.heading} mark={mark('heading')} />
      <PField label="Body" value={a.get('body')} onChange={(v) => a.set('body', v)} max={CONTENT_LIMITS.emailBody} multiline rows={6} mark={mark('body')} />
      <div className="grid gap-4 md:grid-cols-[200px_minmax(0,1fr)]">
        <PField label="Button" value={a.get('ctaLabel')} onChange={(v) => a.set('ctaLabel', v)} max={CONTENT_LIMITS.buttonLabel} mark={mark('ctaLabel')} />
        <Field label="Button opens">
          <ActionPicker value={a.get('action')} onChange={(v) => a.set('action', v)} allow={['deeplink', 'campaign', 'invite', 'paywall', 'url']} />
        </Field>
      </div>
      <p className="text-xs text-slate-500">Sent with the FitCircle email shell; marketing consent and the unsubscribe link are added automatically.</p>
    </div>
  );
}
