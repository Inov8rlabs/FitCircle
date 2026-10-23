'use client';

import { useEffect, useRef } from 'react';

import { AnalyticsEvents, analytics } from '@/lib/analytics';

/** Fires Pricing Viewed (source: landing) once, when the pricing teaser scrolls into view. */
export function PricingViewTracker({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        analytics.track(AnalyticsEvents.pricingViewed({ source: 'landing' }));
        io.disconnect();
      }
    });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return <div ref={ref}>{children}</div>;
}
