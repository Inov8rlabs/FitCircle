'use client';

import { useMemo } from 'react';

import { CampaignHomeCard } from '@/components/campaigns/CampaignCards';
import { addDays, buildPreviewView, fillDoorsFromIdeas, newCampaignInput } from '@/lib/campaigns/campaign-utils';
import type { CampaignTemplate } from '@/lib/campaigns/types';
import { cn } from '@/lib/utils';

const SAMPLE: Record<CampaignTemplate, { title: string; emoji: string; tagline: string; description: string; palette: [string, string, string]; label: string; blurb: string }> = {
  seasonal_circle: {
    title: 'Hold the Line',
    emoji: '❄️',
    tagline: "Maintain, don't gain, with your crew.",
    description: '',
    palette: ['#8b5cf6', '#22d3ee', '#ec4899'],
    label: 'Seasonal circle',
    blurb: 'Hero card + Circles banner; the CTA opens the circle wizard prefilled.',
  },
  daily_calendar: {
    title: 'Advent Circle',
    emoji: '🎁',
    tagline: 'A small healthy win behind every door.',
    description: '',
    palette: ['#f43f5e', '#f59e0b', '#a855f7'],
    label: 'Daily calendar',
    blurb: 'A door a day, opened by checking in. Calendar screen + reminders.',
  },
  spotlight: {
    title: 'Bring a friend',
    emoji: '💜',
    tagline: '',
    description: 'Invite a friend and you both get a free week of Pro.',
    palette: ['#8b5cf6', '#6366f1', '#f97316'],
    label: 'Spotlight',
    blurb: 'Simple promo card: art, title, body, one CTA.',
  },
};

/** A live, scaled-down render of the in-app home card for a template. */
export function TemplateThumb({ template, selected, onSelect, disabled }: { template: CampaignTemplate; selected: boolean; onSelect: () => void; disabled?: boolean }) {
  const s = SAMPLE[template];
  const view = useMemo(() => {
    const today = '2026-12-07';
    const input = { ...newCampaignInput(template, '2026-11-10'), ...s, slug: 'sample', startsAt: '2026-12-01', endsAt: '2026-12-24', featuredFrom: '2026-11-17' };
    if (template === 'seasonal_circle') Object.assign(input, { startsAt: addDays(today, -8), endsAt: addDays(today, 22) });
    if (template === 'daily_calendar') input.calendar = { doors: fillDoorsFromIdeas(24, []) };
    return { ...buildPreviewView(input, today, { todayOpened: false }), isPreview: false };
  }, [template, s]);

  return (
    <div
      role="button"
      tabIndex={disabled ? -1 : 0}
      onClick={() => !disabled && onSelect()}
      onKeyDown={(e) => {
        if (!disabled && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          onSelect();
        }
      }}
      aria-disabled={disabled}
      aria-pressed={selected}
      className={cn(
        'cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-400',
        'group flex flex-col overflow-hidden rounded-2xl border text-left transition',
        selected ? 'border-purple-400 bg-purple-500/10 ring-2 ring-purple-500/40' : 'border-slate-800 bg-slate-950/40 hover:border-slate-600',
        disabled && !selected && 'cursor-not-allowed opacity-40 hover:border-slate-800'
      )}
    >
      <div className="relative h-36 overflow-hidden bg-slate-950 px-3 pt-3">
        <div className="pointer-events-none origin-top-left scale-[0.55]" style={{ width: `${100 / 0.55}%` }} aria-hidden inert>
          <CampaignHomeCard view={view} inert />
        </div>
        <div className="absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-slate-950 to-transparent" />
      </div>
      <div className="p-3">
        <p className="text-sm font-semibold text-white">{s.label}</p>
        <p className="mt-0.5 text-xs text-slate-400">{s.blurb}</p>
      </div>
    </div>
  );
}
