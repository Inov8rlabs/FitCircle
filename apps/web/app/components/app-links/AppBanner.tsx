'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { X } from 'lucide-react';
import Image from 'next/image';
import { useEffect, useState } from 'react';

import { AnalyticsEvents, analytics } from '@/lib/analytics';
import {
  hasInvite,
  openAppUrl,
  openPath,
  playStoreUrl,
  showsNativeSmartBanner,
  storeTargetFor,
  type DevicePlatform,
  type GetAppParams,
} from '@/lib/app-links';

import { useDevicePlatform } from './GetAppButton';

export const APP_BANNER_DISMISS_KEY = 'fc_app_banner_dismissed_at';
const DISMISS_MS = 14 * 24 * 60 * 60 * 1000;

function dismissedRecently(): boolean {
  try {
    const at = Number(window.localStorage.getItem(APP_BANNER_DISMISS_KEY));
    return Number.isFinite(at) && at > 0 && Date.now() - at < DISMISS_MS;
  } catch {
    return false;
  }
}

function isStandalone(): boolean {
  try {
    return (
      window.matchMedia?.('(display-mode: standalone)').matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true
    );
  } catch {
    return false;
  }
}

/**
 * Sticky, dismissible "FitCircle is better in the app" bar for phones.
 * Skipped where Safari already shows Apple's Smart App Banner, inside the
 * installed PWA, and for 14 days after a dismiss.
 *
 * The button opens the app when it's installed and the store when it isn't:
 * - iOS: https://fitcircle.ai/<path> (apex host → universal link; not installed →
 *   www → /open → App Store).
 * - Android: intent:// for https://www.fitcircle.ai/<path>, falling back to the
 *   Play listing with the install referrer.
 * `path` defaults to /open; invite pages pass their own /i/… or /join/… path,
 * which both apps already claim.
 */
export function AppBanner({
  placement,
  params = {},
  path,
  initialPlatform = 'desktop',
  title = 'FitCircle',
  subtitle = 'Log meals in seconds. Free on iPhone & Android.',
}: {
  placement: string;
  params?: Omit<GetAppParams, 'placement'>;
  /** In-app path to open (default: /open with the same attribution params). */
  path?: string;
  initialPlatform?: DevicePlatform;
  title?: string;
  subtitle?: string;
}) {
  const platform = useDevicePlatform(initialPlatform);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (platform === 'desktop') return setVisible(false);
    if (showsNativeSmartBanner(navigator.userAgent) || isStandalone() || dismissedRecently()) return;
    const t = window.setTimeout(() => setVisible(true), 600);
    return () => window.clearTimeout(t);
  }, [platform]);

  const full: GetAppParams = { ...params, placement };
  const target = path ?? openPath(full);
  const href = openAppUrl(platform, target, playStoreUrl(full)) ?? '/get';

  const dismiss = () => {
    setVisible(false);
    try {
      window.localStorage.setItem(APP_BANNER_DISMISS_KEY, String(Date.now()));
    } catch {
      // private mode: it just shows again next visit
    }
    analytics.track(AnalyticsEvents.appBannerDismissed({ placement, device_platform: platform }));
  };

  return (
    <AnimatePresence>
      {visible && (
        <motion.aside
          role="complementary"
          aria-label="Get the FitCircle app"
          data-testid="app-banner"
          initial={{ y: 120, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 120, opacity: 0 }}
          transition={{ type: 'spring', damping: 28, stiffness: 320 }}
          className="fixed inset-x-3 z-[60] md:hidden"
          style={{ bottom: 'calc(12px + env(safe-area-inset-bottom))' }}
        >
          <div className="flex items-center gap-3 rounded-xl border border-glass bg-surface/95 p-3 pr-2 shadow-ios-lg backdrop-blur-xl">
            <button
              type="button"
              onClick={dismiss}
              aria-label="Dismiss"
              className="-ml-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-fg-tertiary hover:bg-white/5 hover:text-white"
            >
              <X className="h-4 w-4" />
            </button>
            <Image
              src="/brand/fitcircle-icon-512.png"
              alt=""
              width={44}
              height={44}
              className="h-11 w-11 shrink-0 rounded-[11px] ring-1 ring-white/10"
            />
            <div className="min-w-0 flex-1">
              <p className="truncate text-subhead font-semibold text-white">{title}</p>
              <p className="truncate text-footnote text-fg-secondary">{subtitle}</p>
            </div>
            <a
              href={href}
              data-testid="app-banner-cta"
              onClick={() =>
                analytics.track(
                  AnalyticsEvents.getAppClicked({
                    placement,
                    device_platform: platform,
                    store: storeTargetFor(platform, full).store,
                    has_invite: hasInvite(full),
                  })
                )
              }
              className="inline-flex h-9 shrink-0 items-center rounded-full bg-gradient-brand px-5 text-subhead font-semibold text-white shadow-glow active:scale-[0.97]"
            >
              Get
            </a>
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}
