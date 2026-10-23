'use client';

import { AnalyticsEvents, analytics } from '@/lib/analytics';
import { cn } from '@/lib/utils';

import { AppleGlyph, PlayGlyph } from './glyphs';

export type StoreKind = 'app_store' | 'play_store';

const COPY: Record<StoreKind, { eyebrow: string; label: string }> = {
  app_store: { eyebrow: 'Download on the', label: 'App Store' },
  play_store: { eyebrow: 'Get it on', label: 'Google Play' },
};

/**
 * Black store badge (Apple / Google badge proportions). Links straight to the
 * listing; on phones, prefer <GetAppButton> which routes through /get.
 */
export function StoreBadge({
  store,
  href,
  placement,
  size = 'md',
  className,
  onBeforeNavigate,
}: {
  store: StoreKind;
  href: string;
  placement: string;
  size?: 'md' | 'lg';
  className?: string;
  /** Runs inside the tap (e.g. to copy an invite to the clipboard). */
  onBeforeNavigate?: () => void;
}) {
  const { eyebrow, label } = COPY[store];
  return (
    <a
      href={href}
      onClick={() => {
        onBeforeNavigate?.();
        analytics.track(AnalyticsEvents.appStoreLinkClicked({ store, placement }));
      }}
      data-testid={`store-badge-${store}`}
      aria-label={`${eyebrow} ${label}`}
      className={cn(
        'group inline-flex items-center gap-3 rounded-lg border border-white/20 bg-black text-white shadow-ios-sm',
        'transition duration-200 ease-ios hover:border-white/40 hover:bg-neutral-950 active:scale-[0.97]',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-purple focus-visible:ring-offset-2 focus-visible:ring-offset-canvas',
        size === 'lg' ? 'h-[60px] px-5' : 'h-[52px] px-4',
        className
      )}
    >
      {store === 'app_store' ? (
        <AppleGlyph className={size === 'lg' ? 'h-8 w-8' : 'h-7 w-7'} />
      ) : (
        <PlayGlyph className={size === 'lg' ? 'h-8 w-8' : 'h-7 w-7'} />
      )}
      <span className="flex flex-col text-left leading-none">
        <span className="text-[11px] font-medium tracking-wide text-white/80">{eyebrow}</span>
        <span className={cn('mt-1 font-semibold tracking-tight', size === 'lg' ? 'text-[22px]' : 'text-[19px]')}>
          {label}
        </span>
      </span>
    </a>
  );
}
