'use client';

import { useRef } from 'react';

import { COPY_LIMITS, CTA_ACTIONS, CTA_LABELS, SLUG_RE, resizeDoors, spanDays } from '@/lib/campaigns/campaign-utils';
import { DEFAULT_CTA_LABEL, type CampaignInput, type CampaignTemplate } from '@/lib/campaigns/types';

import { PlatformSelector } from '../../engage/ui';
import type { EditorApi } from '../editor-api';
import { Field, Section, SelectField, TextAreaField, TextField } from '../fields';
import { TemplateThumb } from '../TemplateThumb';

const TEMPLATES: CampaignTemplate[] = ['seasonal_circle', 'daily_calendar', 'spotlight'];

export function slugify(s: string): string {
  return s
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
}

export function switchTemplate(d: CampaignInput, template: CampaignTemplate): CampaignInput {
  const next: CampaignInput = { ...d, template, cta: { action: CTA_ACTIONS[template][0], url: d.cta.url ?? null } };
  if (template === 'spotlight' && CTA_ACTIONS.spotlight.includes(d.cta.action)) next.cta = d.cta;
  if (template !== 'spotlight' && !next.circle) {
    next.circle = { name: d.title, description: d.description, type: 'custom', startDate: d.startsAt, endDate: d.endsAt };
  }
  if (template === 'daily_calendar') {
    next.calendar = { doors: resizeDoors(spanDays(d.startsAt, d.endsAt), d.calendar?.doors ?? []) };
    if (d.glyph === 'star') next.glyph = 'gift';
  } else {
    next.calendar = null;
  }
  return next;
}

export function BasicsSection({ api }: { api: EditorApi }) {
  const { draft, update, set, campaign } = api;
  const slugTouched = useRef(Boolean(campaign));
  const locked = Boolean(campaign?.published);
  const slugError = draft.slug && !SLUG_RE.test(draft.slug) ? 'Use a–z, 0–9 and _ (3–40 characters)' : null;

  return (
    <Section id="basics" index={1} title="Basics" description="Pick how the apps render it, then write the copy.">
      <div className="grid gap-3 sm:grid-cols-3">
        {TEMPLATES.map((t) => (
          <TemplateThumb key={t} template={t} selected={draft.template === t} disabled={locked && draft.template !== t} onSelect={() => !locked && set((d) => switchTemplate(d, t))} />
        ))}
      </div>
      {locked && <p className="-mt-2 text-xs text-slate-500">Unpublish to change the template.</p>}

      <div className="grid gap-4 sm:grid-cols-[1fr_120px]">
        <TextField
          label="Title"
          value={draft.title}
          max={COPY_LIMITS.title}
          placeholder="Hold the Line"
          onChange={(title) => update({ title, ...(slugTouched.current ? {} : { slug: slugify(title) }) })}
        />
        <TextField label="Emoji" value={draft.emoji} max={COPY_LIMITS.emoji} onChange={(emoji) => update({ emoji })} className="text-center text-lg" />
      </div>
      <div className="grid gap-4 sm:grid-cols-[1fr_120px]">
        <TextField
          label="Slug"
          value={draft.slug}
          error={slugError}
          disabled={locked}
          hint={`fitcircle.ai/c/${draft.slug || '…'}${locked ? ' · locked while published' : ''}`}
          onChange={(v) => {
            slugTouched.current = true;
            update({ slug: v.toLowerCase().replace(/[^a-z0-9_]/g, '') });
          }}
          className="font-mono"
        />
        <TextField
          label="Priority"
          type="number"
          value={String(draft.priority)}
          hint="Higher wins"
          onChange={(v) => update({ priority: Number.parseInt(v || '0', 10) || 0 })}
        />
      </div>
      <Field label="Platforms" hint={(draft.platforms ?? []).length === 0 ? 'All platforms. App Store events are iOS-only; Play promos Android-only.' : `Only ${(draft.platforms ?? []).join(' · ')} see this campaign in the app.`}>
        <PlatformSelector value={draft.platforms ?? []} onChange={(platforms) => update({ platforms })} />
      </Field>
      <TextField label="Tagline" value={draft.tagline} max={COPY_LIMITS.tagline} placeholder="Maintain, don't gain, with your crew." onChange={(tagline) => update({ tagline })} />
      <TextAreaField label="Description" value={draft.description} max={COPY_LIMITS.description} onChange={(description) => update({ description })} />

      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          label="CTA label"
          value={draft.ctaLabel ?? ''}
          max={COPY_LIMITS.ctaLabel}
          placeholder={DEFAULT_CTA_LABEL[draft.template]}
          hint="Empty → template default"
          onChange={(v) => update({ ctaLabel: v || null })}
        />
        {draft.template === 'spotlight' ? (
          <SelectField
            label="CTA action"
            value={draft.cta.action}
            options={CTA_ACTIONS.spotlight.map((a) => ({ value: a, label: CTA_LABELS[a] }))}
            onChange={(action) => update({ cta: { ...draft.cta, action } })}
          />
        ) : (
          <div className="space-y-1.5">
            <p className="text-xs font-medium uppercase tracking-wider text-slate-400">CTA action</p>
            <p className="rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2 text-sm text-slate-300">{CTA_LABELS[draft.cta.action]}</p>
          </div>
        )}
      </div>
      {draft.template === 'spotlight' && draft.cta.action === 'open_url' && (
        <TextField
          label="CTA URL"
          type="url"
          value={draft.cta.url ?? ''}
          placeholder="https://www.fitcircle.ai/…"
          error={draft.cta.url && !/^https:\/\//.test(draft.cta.url) ? 'Must start with https://' : null}
          onChange={(url) => update({ cta: { ...draft.cta, url } })}
        />
      )}
    </Section>
  );
}
