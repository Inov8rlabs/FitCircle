import { Check } from 'lucide-react';
import Link from 'next/link';

import { Logo } from '@/components/ui/logo';
import {
  absoluteGetAppUrl,
  appStoreUrl,
  hasInvite,
  playStoreUrl,
  type DevicePlatform,
  type GetAppParams,
} from '@/lib/app-links';

import { GetAppButton } from './GetAppButton';
import { PageViewTracker } from './PageViewTracker';
import { QrCode } from './QrCode';
import { StoreBadge } from './StoreBadge';

const FEATURES = [
  'Snap a photo of a meal and get calories and macros in seconds',
  'Steps, workouts and weight sync from Apple Health and Health Connect',
  'Daily streaks and friendly competition in your circles',
];

/**
 * Shared body of /get (desktop fallback) and /welcome/app (post-signup).
 * Desktop: QR code that lands the phone on the right store, plus both badges.
 * Phone: one big store button (through /get, so attribution is kept).
 */
export async function GetAppPage({
  source,
  platform,
  params,
  eyebrow,
  title,
  subtitle,
  continueHref,
  continueLabel,
}: {
  source: 'get_page' | 'post_signup';
  platform: DevicePlatform;
  params: GetAppParams;
  eyebrow?: string;
  title: React.ReactNode;
  subtitle: string;
  continueHref?: string;
  continueLabel?: string;
}) {
  const providerToken = process.env.NEXT_PUBLIC_ASC_PROVIDER_TOKEN;
  const qrValue = absoluteGetAppUrl({ ...params, placement: params.placement ?? source });
  return (
    <main className="relative min-h-dvh overflow-hidden bg-canvas text-white">
      <PageViewTracker source={source} platform={platform} hasInvite={hasInvite(params)} />
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-hero-glow" />
      <div className="relative mx-auto flex min-h-dvh w-full max-w-5xl flex-col px-4 pb-10 pt-6 sm:px-6 lg:px-8">
        <header className="flex items-center justify-between">
          <Link href="/" aria-label="FitCircle home">
            <Logo size="sm" />
          </Link>
        </header>

        <div className="flex flex-1 flex-col items-center justify-center gap-10 py-10 md:flex-row md:items-center md:justify-between md:gap-16">
          <section className="max-w-xl text-center md:text-left">
            {eyebrow && (
              <p className="mb-3 inline-flex items-center rounded-full border border-hairline bg-surface-raised/60 px-3 py-1 text-footnote font-semibold uppercase tracking-wide text-brand-purple">
                {eyebrow}
              </p>
            )}
            <h1 className="text-large-title sm:text-[44px] sm:leading-[1.1]" data-testid="get-app-title">
              {title}
            </h1>
            <p className="mt-3 text-body text-fg-secondary">{subtitle}</p>
            <ul className="mt-6 space-y-3 text-left">
              {FEATURES.map((f) => (
                <li key={f} className="flex items-start gap-3 text-callout text-white/90">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-green/20 text-brand-green">
                    <Check className="h-3.5 w-3.5" strokeWidth={3} />
                  </span>
                  {f}
                </li>
              ))}
            </ul>

            {platform !== 'desktop' && (
              <div className="mt-8">
                <GetAppButton placement={source} params={params} initialPlatform={platform} fullWidth />
              </div>
            )}

            {continueHref && (
              <p className="mt-6 text-subhead text-fg-secondary">
                <Link
                  href={continueHref}
                  className="font-semibold text-white underline-offset-4 hover:underline"
                  data-testid="get-app-continue"
                >
                  {continueLabel ?? 'Continue on the web'}
                </Link>
              </p>
            )}
          </section>

          <aside
            className="w-full max-w-sm rounded-2xl border border-hairline bg-surface/80 p-6 shadow-ios-lg backdrop-blur-xl"
            data-testid="get-app-card"
          >
            <div className="flex flex-col items-center text-center">
              {platform === 'desktop' ? (
                <>
                  <QrCode value={qrValue} size={184} label="QR code: scan with your phone camera to get FitCircle" />
                  <p className="mt-4 text-headline text-white">Scan with your phone</p>
                  <p className="mt-1 text-subhead text-fg-secondary">
                    Point your camera at the code. It opens the right store for your phone.
                  </p>
                </>
              ) : (
                <>
                  <p className="text-headline text-white">Free on iPhone and Android</p>
                  <p className="mt-1 text-subhead text-fg-secondary">Already have it? Sign in with the same account.</p>
                </>
              )}
              <div className="mt-5 flex w-full flex-col items-stretch gap-3">
                <StoreBadge store="app_store" href={appStoreUrl({ ...params, placement: source }, providerToken)} placement={source} />
                <StoreBadge store="play_store" href={playStoreUrl({ ...params, placement: source })} placement={source} />
              </div>
            </div>
          </aside>
        </div>
      </div>
    </main>
  );
}
