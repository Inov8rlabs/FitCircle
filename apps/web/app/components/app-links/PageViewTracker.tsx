'use client';

import { useEffect } from 'react';

import { AnalyticsEvents, analytics } from '@/lib/analytics';
import type { DevicePlatform } from '@/lib/app-links';

/** Fires Get App Page Viewed once per mount. */
export function PageViewTracker({
  source,
  platform,
  hasInvite,
}: {
  source: 'get_page' | 'post_signup';
  platform: DevicePlatform;
  hasInvite: boolean;
}) {
  useEffect(() => {
    analytics.track(AnalyticsEvents.getAppPageViewed({ source, device_platform: platform, has_invite: hasInvite }));
  }, [source, platform, hasInvite]);
  return null;
}
