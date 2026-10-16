'use client';

import { ArrowRight } from 'lucide-react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { AnalyticsEvents, analytics } from '@/lib/analytics';
import type { CampaignCtaAction, CampaignView } from '@/lib/campaigns/types';
import { cn } from '@/lib/utils';

const CircleCreationWizard = dynamic(() => import('@/components/CircleCreationWizard'), { ssr: false });

/** Web route for a CTA action (start_circle opens the prefilled wizard instead). */
export function ctaHref(view: Pick<CampaignView, 'slug' | 'cta'>): string | null {
  const a: CampaignCtaAction = view.cta.action;
  switch (a) {
    case 'open_calendar':
      return `/c/${view.slug}`;
    case 'invite':
      return '/invite';
    case 'paywall':
      return '/upgrade';
    case 'circles':
      return '/fitcircles';
    case 'open_url':
      return view.cta.url && /^https?:\/\//.test(view.cta.url) ? view.cta.url : null;
    case 'start_circle':
    default:
      return null;
  }
}

interface CampaignCtaButtonProps {
  view: CampaignView;
  className?: string;
  /** Preview mode (admin mocks): render only, no navigation. */
  inert?: boolean;
  label?: string;
  action?: CampaignCtaAction;
  variant?: 'primary' | 'secondary';
}

export function CampaignCtaButton({ view, className, inert, label, action, variant = 'primary' }: CampaignCtaButtonProps) {
  const router = useRouter();
  const [wizardOpen, setWizardOpen] = useState(false);
  const act = action ?? view.cta.action;
  const text = label ?? view.ctaLabel;

  const onClick = () => {
    if (inert) return;
    analytics.track(AnalyticsEvents.campaignCTATapped({ campaign: view.slug, template: view.template, action: act }));
    if (act === 'start_circle') {
      analytics.track(AnalyticsEvents.circleWizardStarted({ source: 'campaign' }));
      setWizardOpen(true);
      return;
    }
    const href = ctaHref({ slug: view.slug, cta: { action: act, url: view.cta.url } });
    if (!href) return;
    if (/^https?:\/\//.test(href)) window.open(href, '_blank', 'noopener,noreferrer');
    else router.push(href);
  };

  if (inert) {
    return (
      <span
        className={cn(
          'inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold',
          variant === 'primary' ? 'bg-white text-slate-950 shadow-lg shadow-black/20' : 'border border-white/20 bg-white/5 text-white',
          className
        )}
      >
        {text}
        <ArrowRight className="h-4 w-4" aria-hidden />
      </span>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={onClick}
        className={cn(
          'inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition active:scale-[0.98]',
          variant === 'primary'
            ? 'bg-white text-slate-950 shadow-lg shadow-black/20 hover:bg-white/90'
            : 'border border-white/20 bg-white/5 text-white hover:bg-white/10',
          className
        )}
      >
        {text}
        <ArrowRight className="h-4 w-4" aria-hidden />
      </button>
      {wizardOpen && (
        <CircleCreationWizard
          isOpen={wizardOpen}
          onClose={() => setWizardOpen(false)}
          onSuccess={(circle: { id?: string; challenge_id?: string } | null) => {
            setWizardOpen(false);
            const id = circle?.challenge_id ?? circle?.id;
            if (id) router.push(`/fitcircles/${id}`);
          }}
          initialValues={
            view.circle
              ? { name: view.circle.name, description: view.circle.description, startDate: view.circle.startDate, endDate: view.circle.endDate }
              : null
          }
        />
      )}
    </>
  );
}
