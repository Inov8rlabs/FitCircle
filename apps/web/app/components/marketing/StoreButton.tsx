'use client';

import { Badge } from '@/components/ui/badge';
import { AnalyticsEvents, analytics, type AppStoreLinkClickedStore } from '@/lib/analytics';

/** App Store / Google Play badge on the marketing site. Tracks App Store Link Clicked. */
export function StoreButton({
  href,
  label,
  eyebrow,
  icon,
  comingSoon,
  store,
  placement,
}: {
  href: string;
  label: string;
  eyebrow: string;
  icon: React.ReactNode;
  comingSoon: boolean;
  store: AppStoreLinkClickedStore;
  placement: string;
}) {
  const inner = (
    <>
      {icon}
      <div className="text-left">
        <div className="text-xs text-gray-400">{eyebrow}</div>
        <div className="text-lg font-semibold text-white">{label}</div>
      </div>
    </>
  );
  return (
    <div className="relative">
      {comingSoon && (
        <Badge className="absolute -top-3 -right-3 z-10 bg-purple-600 text-white border-purple-500 px-3 py-1 text-xs font-semibold">
          Coming soon
        </Badge>
      )}
      {comingSoon ? (
        <div
          aria-disabled
          className="flex items-center gap-3 bg-slate-900/50 border border-slate-700 rounded-xl px-6 py-4 opacity-60"
        >
          {inner}
        </div>
      ) : (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => analytics.track(AnalyticsEvents.appStoreLinkClicked({ store, placement }))}
          className="flex items-center gap-3 bg-slate-900/70 border border-slate-700 rounded-xl px-6 py-4 hover:border-purple-500 hover:bg-slate-900 transition-colors"
        >
          {inner}
        </a>
      )}
    </div>
  );
}
