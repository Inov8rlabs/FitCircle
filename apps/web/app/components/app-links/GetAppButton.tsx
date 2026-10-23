'use client';

import { Smartphone } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { AnalyticsEvents, analytics } from '@/lib/analytics';
import {
  detectPlatform,
  getAppHref,
  hasInvite,
  storeTargetFor,
  type DevicePlatform,
  type GetAppParams,
} from '@/lib/app-links';
import { copyText } from '@/lib/referrals/clipboard';
import { cn } from '@/lib/utils';

import { AppleGlyph, PlayGlyph } from './glyphs';

/** Client-side platform, seeded from the server's User-Agent guess (iPadOS reports a Mac UA). */
export function useDevicePlatform(initial: DevicePlatform = 'desktop'): DevicePlatform {
  const [platform, setPlatform] = useState<DevicePlatform>(initial);
  useEffect(() => {
    if (typeof navigator === 'undefined') return;
    setPlatform(detectPlatform(navigator.userAgent, { maxTouchPoints: navigator.maxTouchPoints }));
  }, []);
  return platform;
}

export const INVITE_COPIED_TOAST = 'Invite copied. Paste it when FitCircle asks for a code.';

/**
 * The one "Get the app" CTA. Always a plain <a href="/get?…"> (a full
 * navigation, so the server's 307 to apps.apple.com / play.google.com happens
 * inside the tap and the store app opens natively). Desktop lands on the QR page.
 *
 * iOS has no install referrer, so for invites we copy "FitCircle invite: <url>"
 * inside the tap; the app's "Got an invite code?" step reads it with PasteButton.
 */
export function GetAppButton({
  placement,
  params = {},
  initialPlatform = 'desktop',
  variant = 'primary',
  label,
  inviteCopyText,
  className,
  fullWidth = false,
}: {
  placement: string;
  params?: Omit<GetAppParams, 'placement'>;
  initialPlatform?: DevicePlatform;
  variant?: 'primary' | 'secondary' | 'compact';
  label?: string;
  /** Text copied to the clipboard on iOS before the App Store opens (invites only). */
  inviteCopyText?: string;
  className?: string;
  fullWidth?: boolean;
}) {
  const platform = useDevicePlatform(initialPlatform);
  const full: GetAppParams = { ...params, placement };
  const href = getAppHref(full);
  const target = storeTargetFor(platform, full);

  const text =
    label ??
    (platform === 'ios' ? 'Get it on the App Store' : platform === 'android' ? 'Get it on Google Play' : 'Get the app');
  const Glyph = platform === 'ios' ? AppleGlyph : platform === 'android' ? PlayGlyph : null;

  const onClick = async (e: React.MouseEvent<HTMLAnchorElement>) => {
    analytics.track(
      AnalyticsEvents.getAppClicked({
        placement,
        device_platform: platform,
        store: target.store,
        has_invite: hasInvite(full),
      })
    );
    if (platform === 'ios' && inviteCopyText) {
      e.preventDefault();
      // Must start inside the tap: iOS only allows clipboard writes from a user gesture.
      const copied = await copyText(inviteCopyText);
      if (copied) toast.success(INVITE_COPIED_TOAST);
      window.setTimeout(() => window.location.assign(href), copied ? 700 : 0);
    }
  };

  return (
    <a
      href={href}
      onClick={onClick}
      data-testid="get-app-button"
      data-platform={platform}
      className={cn(
        'inline-flex select-none items-center justify-center gap-2.5 font-semibold transition duration-200 ease-ios active:scale-[0.97]',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-purple focus-visible:ring-offset-2 focus-visible:ring-offset-canvas',
        variant === 'primary' &&
          'h-14 rounded-lg bg-gradient-brand px-6 text-headline text-white shadow-glow hover:brightness-110',
        variant === 'secondary' &&
          'h-14 rounded-lg border border-hairline bg-surface-raised px-6 text-headline text-white hover:bg-slate-700',
        variant === 'compact' && 'h-9 rounded-full bg-gradient-brand px-4 text-subhead text-white shadow-glow',
        fullWidth && 'w-full',
        className
      )}
    >
      {Glyph ? (
        <Glyph className={cn(variant === 'compact' ? 'h-4 w-4' : 'h-5 w-5', platform === 'android' && 'drop-shadow')} />
      ) : (
        <Smartphone className={variant === 'compact' ? 'h-4 w-4' : 'h-5 w-5'} aria-hidden />
      )}
      <span>{text}</span>
    </a>
  );
}
