'use client';

import { Check, Download, ImageUp, Library, Plus, Trash2, Wand2 } from 'lucide-react';
import { useDeferredValue, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';

import { campaignsAdmin, CampaignApiError } from '@/lib/campaigns/admin-client';
import { ART_SLOTS, renderSlotPng, svgDataUrl, svgFor } from '@/lib/campaigns/art/campaign-art';
import { ART_SLOT_LABELS, GLYPHS, PALETTE_PRESETS, addDays, matchPreset, shortDate } from '@/lib/campaigns/campaign-utils';
import { ART_SLOT_SIZES, type AdminCampaign, type ArtSlot } from '@/lib/campaigns/types';
import { imageFilesFrom } from '@/lib/engage/client/asset-pipeline';
import type { EngageAsset } from '@/lib/engage/types';
import { cn } from '@/lib/utils';

import { AssetPicker } from '../../engage/assets/AssetPicker';
import type { EditorApi } from '../editor-api';
import { Btn, Field, Section, downloadFile, inputCls } from '../fields';

const EXACT_SLOTS: ArtSlot[] = ['appStoreCard', 'appStoreDetails'];

function readImageSize(file: Blob): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
      URL.revokeObjectURL(url);
    };
    img.onerror = () => {
      reject(new Error('Not an image'));
      URL.revokeObjectURL(url);
    };
    img.src = url;
  });
}

export function CreativeSection({ api }: { api: EditorApi }) {
  const { draft, update, campaign, ensureSaved, applyServer, refreshServer } = api;
  const preset = matchPreset(draft.palette);
  const [busy, setBusy] = useState<Partial<Record<ArtSlot, boolean>>>({});
  const [generating, setGenerating] = useState<string | null>(null);

  // Live preview of the generated art (deferred so typing stays snappy).
  const creative = useDeferredValue({ template: draft.template, palette: draft.palette, glyph: draft.glyph, startsAt: draft.startsAt, endsAt: draft.endsAt, marks: draft.marks, slug: draft.slug });
  const liveSvg = useMemo(() => svgDataUrl(svgFor(creative, 'inAppHero')), [creative]);

  const uploadSlot = async (slot: ArtSlot, blob: Blob, generated: boolean, saved?: AdminCampaign | null) => {
    const c = saved ?? (await ensureSaved());
    if (!c) return false;
    setBusy((b) => ({ ...b, [slot]: true }));
    try {
      const updated = await campaignsAdmin.uploadArt(c.id, slot, blob, generated);
      if (updated && typeof updated === 'object' && 'id' in updated) applyServer(updated);
      else await refreshServer();
      return true;
    } catch (e) {
      toast.error(`${ART_SLOT_LABELS[slot]}: ${e instanceof CampaignApiError ? e.message : 'upload failed'}`);
      return false;
    } finally {
      setBusy((b) => ({ ...b, [slot]: false }));
    }
  };

  const generateAll = async () => {
    const c = await ensureSaved();
    if (!c) return;
    let ok = 0;
    for (const slot of ART_SLOTS) {
      setGenerating(ART_SLOT_LABELS[slot]);
      try {
        const png = await renderSlotPng(draft, slot);
        if (await uploadSlot(slot, png, true, c)) ok++;
      } catch (e) {
        toast.error(`${ART_SLOT_LABELS[slot]}: ${e instanceof Error ? e.message : 'render failed'}`);
      }
    }
    setGenerating(null);
    if (ok === ART_SLOTS.length) toast.success('Artwork generated and uploaded for all 4 slots');
  };

  const onFile = async (slot: ArtSlot, file: File | undefined) => {
    if (!file) return;
    const local = URL.createObjectURL(file);
    api.setLocalArt(slot, local);
    try {
      await onFileInner(slot, file);
    } finally {
      api.setLocalArt(slot, null);
      URL.revokeObjectURL(local);
    }
  };

  const onFileInner = async (slot: ArtSlot, file: File) => {
    if (!/^image\/(png|jpe?g)$/.test(file.type)) return void toast.error('PNG or JPG only');
    if (file.size > 8 * 1024 * 1024) return void toast.error('Max 8 MB');
    const want = ART_SLOT_SIZES[slot];
    try {
      const got = await readImageSize(file);
      if (EXACT_SLOTS.includes(slot) && (got.width !== want.width || got.height !== want.height)) {
        return void toast.error(`${ART_SLOT_LABELS[slot]} must be exactly ${want.width}×${want.height} (got ${got.width}×${got.height})`);
      }
      if (!EXACT_SLOTS.includes(slot) && Math.abs(got.width / got.height - want.width / want.height) > 0.02) {
        toast.warning(`Heads up: ${ART_SLOT_LABELS[slot]} is designed for ${want.width}×${want.height}; it will be cropped.`);
      }
    } catch {
      return void toast.error('Could not read that image');
    }
    if (await uploadSlot(slot, file, false)) toast.success(`${ART_SLOT_LABELS[slot]} replaced`);
  };

  return (
    <Section
      id="creative"
      index={4}
      title="Creative"
      description="Glyph, palette and marks drive the generated neon-ring art."
      actions={
        <Btn variant="primary" onClick={() => void generateAll()} loading={Boolean(generating)}>
          <Wand2 className="h-4 w-4" /> {generating ? `Rendering ${generating}…` : 'Generate artwork'}
        </Btn>
      }
    >
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <div className="space-y-5">
          <Field label="Glyph">
            <div className="grid grid-cols-5 gap-2">
              {GLYPHS.map((g) => (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => update({ glyph: g.id })}
                  aria-pressed={draft.glyph === g.id}
                  className={cn(
                    'flex flex-col items-center gap-1 rounded-xl border p-2 text-[11px] transition',
                    draft.glyph === g.id ? 'border-purple-400 bg-purple-500/15 text-white' : 'border-slate-800 bg-slate-950/40 text-slate-400 hover:border-slate-600'
                  )}
                >
                  <span className="text-xl">{g.id === 'year' ? draft.startsAt.slice(0, 4) || '2027' : g.emoji}</span>
                  {g.label}
                </button>
              ))}
            </div>
          </Field>

          <Field label="Palette" hint={preset ? `${preset.name} · ${preset.particles === 'none' ? 'no particles' : preset.particles}` : 'Custom · particles follow the glyph'}>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-6 lg:grid-cols-3 xl:grid-cols-6">
              {PALETTE_PRESETS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => update({ palette: [...p.colors], accent: p.accent })}
                  className={cn('rounded-xl border p-1.5 text-left transition', preset?.id === p.id ? 'border-white/80 ring-2 ring-white/30' : 'border-slate-800 hover:border-slate-600')}
                >
                  <span className="flex h-8 overflow-hidden rounded-lg">
                    {p.colors.map((c) => (
                      <span key={c} className="flex-1" style={{ background: c }} />
                    ))}
                  </span>
                  <span className="mt-1 block truncate text-[11px] text-slate-300">{p.name}</span>
                </button>
              ))}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              {draft.palette.map((c, i) => (
                <label key={i} className="flex items-center gap-1.5 text-xs text-slate-400">
                  <input
                    type="color"
                    value={c}
                    onChange={(e) => {
                      const next = [...draft.palette] as [string, string, string];
                      next[i] = e.target.value;
                      update({ palette: next });
                    }}
                    className="h-7 w-9 cursor-pointer rounded border border-slate-700 bg-transparent"
                  />
                  Aurora {i + 1}
                </label>
              ))}
              <label className="flex items-center gap-1.5 text-xs text-slate-400">
                <input type="color" value={draft.accent} onChange={(e) => update({ accent: e.target.value })} className="h-7 w-9 cursor-pointer rounded border border-slate-700 bg-transparent" />
                Accent
              </label>
            </div>
          </Field>

          <MarksEditor api={api} />
        </div>

        <div className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-wider text-slate-400">Live art preview</p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={liveSvg} alt="Generated art preview" className="aspect-[16/9] w-full rounded-xl ring-1 ring-slate-800" />
          <p className="text-xs text-slate-500">Rendered in your browser from the same parametric ring as the launch art. Generate uploads all four sizes.</p>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {ART_SLOTS.map((slot) => (
          <SlotTile key={slot} slot={slot} api={api} busy={Boolean(busy[slot])} onFile={(f) => void onFile(slot, f)} />
        ))}
      </div>
      {!campaign && <p className="text-xs text-slate-500">Uploading saves the campaign first.</p>}
    </Section>
  );
}

function SlotTile({ slot, api, busy, onFile }: { slot: ArtSlot; api: EditorApi; busy: boolean; onFile: (f: File | undefined) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [picker, setPicker] = useState(false);
  const exact = EXACT_SLOTS.includes(slot);
  const fromLibrary = async (a: EngageAsset) => {
    try {
      const blob = await (await fetch(a.url)).blob();
      onFile(new File([blob], `${a.name}.${a.mime.split('/')[1] ?? 'png'}`, { type: a.mime }));
    } catch {
      toast.error('Could not fetch that asset');
    }
  };
  const asset = api.campaign?.art?.[slot];
  const size = ART_SLOT_SIZES[slot];
  const { url } = api.artFor(slot);
  const portrait = size.height > size.width;
  return (
    <div
      className={cn('flex flex-col overflow-hidden rounded-xl border bg-slate-950/40 transition', over ? 'border-purple-400 ring-2 ring-purple-500/30' : 'border-slate-800')}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        onFile(imageFilesFrom(e.dataTransfer)[0]);
      }}
    >
      <div className={cn('relative flex items-center justify-center bg-slate-950', portrait ? 'h-44' : 'h-32')}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url} alt="" className={cn('max-h-full max-w-full object-contain', !asset && 'opacity-50')} />
        <span
          className={cn(
            'absolute left-2 top-2 rounded-full px-2 py-0.5 text-[10px] font-semibold',
            asset ? 'bg-emerald-500/20 text-emerald-300' : 'bg-slate-800 text-slate-400'
          )}
        >
          {asset ? (asset.generated ? 'Generated' : 'Uploaded') : 'Not uploaded'}
        </span>
        {busy && <div className="absolute inset-0 flex items-center justify-center bg-slate-950/60"><span className="h-5 w-5 animate-spin rounded-full border-2 border-white border-t-transparent" /></div>}
      </div>
      <div className="flex flex-1 flex-col gap-2 p-2.5">
        <div>
          <p className="text-xs font-semibold text-white">{ART_SLOT_LABELS[slot]}</p>
          <p className="text-[11px] text-slate-500">
            {size.width}×{size.height}
            {asset?.updatedAt ? ` · ${new Date(asset.updatedAt).toLocaleDateString()}` : ''}
          </p>
        </div>
        <div className="mt-auto flex gap-1.5">
          <input ref={inputRef} type="file" accept="image/png,image/jpeg" className="hidden" onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = ''; }} />
          <Btn size="sm" className="flex-1" onClick={() => inputRef.current?.click()} disabled={busy}>
            <ImageUp className="h-3.5 w-3.5" /> {asset ? 'Replace' : 'Upload'}
          </Btn>
          <Btn size="sm" variant="ghost" aria-label="Pick from library" onClick={() => setPicker(true)} disabled={busy}>
            <Library className="h-3.5 w-3.5" />
          </Btn>
          <Btn
            size="sm"
            variant="ghost"
            aria-label="Download"
            onClick={async () => {
              const name = `${api.draft.slug || 'campaign'}-${slot}-${size.width}x${size.height}.png`;
              if (asset) await downloadFile(asset.url, name);
              else await downloadFile(await renderSlotPng(api.draft, slot), name);
            }}
          >
            <Download className="h-3.5 w-3.5" />
          </Btn>
        </div>
        <p className="text-[10px] text-slate-600">Drop a file here{exact ? ` · must be exactly ${size.width}×${size.height}` : ''}</p>
      </div>
      <AssetPicker
        open={picker}
        onOpenChange={setPicker}
        title={`${ART_SLOT_LABELS[slot]} from library`}
        filter={(a) => (exact && (a.width !== size.width || a.height !== size.height) ? `${ART_SLOT_LABELS[slot]} needs exactly ${size.width}×${size.height} (that one is ${a.width}×${a.height})` : null)}
        onPick={(a) => void fromLibrary(a)}
      />
    </div>
  );
}

function MarksEditor({ api }: { api: EditorApi }) {
  const { draft, update } = api;
  const outside = (d: string) => d < draft.startsAt || d > draft.endsAt;
  return (
    <Field label="Marks" hint="Emoji on the art's day dial and calendar (e.g. 🦃 Thanksgiving)">
      <div className="space-y-1.5">
        {draft.marks.map((m, i) => (
          <div key={i} className="grid grid-cols-[132px_52px_1fr_auto] items-center gap-1.5">
            <input
              type="date"
              value={m.date}
              min={draft.startsAt}
              max={draft.endsAt}
              onChange={(e) => update({ marks: draft.marks.map((x, j) => (j === i ? { ...x, date: e.target.value } : x)) })}
              className={cn(inputCls, 'h-8 px-2 text-xs', outside(m.date) && 'border-amber-500/60')}
            />
            <input value={m.emoji} onChange={(e) => update({ marks: draft.marks.map((x, j) => (j === i ? { ...x, emoji: e.target.value } : x)) })} className={cn(inputCls, 'h-8 px-1 text-center')} aria-label="Mark emoji" />
            <input value={m.label} placeholder="Label" onChange={(e) => update({ marks: draft.marks.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })} className={cn(inputCls, 'h-8 text-xs')} />
            <button type="button" onClick={() => update({ marks: draft.marks.filter((_, j) => j !== i) })} className="rounded p-1.5 text-slate-500 hover:bg-slate-800 hover:text-rose-300" aria-label="Remove mark">
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
        <div className="flex flex-wrap gap-1.5">
          <Btn size="sm" variant="ghost" onClick={() => update({ marks: [...draft.marks, { date: draft.startsAt, emoji: '⭐', label: '' }] })}>
            <Plus className="h-3.5 w-3.5" /> Add mark
          </Btn>
          {!draft.marks.some((m) => m.date === draft.endsAt) && (
            <Btn size="sm" variant="ghost" onClick={() => update({ marks: [...draft.marks, { date: draft.endsAt, emoji: '🏁', label: 'Finish' }] })}>
              <Check className="h-3.5 w-3.5" /> 🏁 on {shortDate(draft.endsAt)}
            </Btn>
          )}
          {draft.marks.length === 0 && (
            <Btn size="sm" variant="ghost" onClick={() => update({ marks: [{ date: addDays(draft.startsAt, 0), emoji: '🎉', label: 'Kick-off' }] })}>
              🎉 Kick-off
            </Btn>
          )}
        </div>
      </div>
    </Field>
  );
}
