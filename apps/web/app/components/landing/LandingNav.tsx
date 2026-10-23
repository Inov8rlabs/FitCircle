'use client';

import Link from 'next/link';

import { GetAppButton } from '@/components/app-links/GetAppButton';
import { Logo } from '@/components/ui/logo';
import type { DevicePlatform, GetAppParams } from '@/lib/app-links';
import { useAuthStore } from '@/stores/auth-store';

/** Sticky landing header: logo, section links, sign in / dashboard, Get the app. */
export function LandingNav({ params, initialPlatform }: { params: Omit<GetAppParams, 'placement'>; initialPlatform: DevicePlatform }) {
  const user = useAuthStore((s) => s.user);
  return (
    <header className="sticky top-0 z-50 border-b border-hairline bg-canvas/70 backdrop-blur-xl">
      <nav aria-label="Main" className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-3 px-4 sm:h-16 sm:px-6">
        <Link href="/" aria-label="FitCircle home" className="shrink-0">
          <Logo size="sm" />
        </Link>
        <div className="hidden items-center gap-6 text-subhead text-fg-secondary md:flex">
          <a href="#features" className="transition hover:text-white">Features</a>
          <a href="#everywhere" className="transition hover:text-white">Widgets &amp; Watch</a>
          <a href="#pricing" className="transition hover:text-white">Pricing</a>
          <a href="#faq" className="transition hover:text-white">FAQ</a>
        </div>
        <div className="flex items-center gap-2">
          {user ? (
            <Link href="/dashboard" className="rounded-full px-3 py-2 text-subhead font-semibold text-white transition hover:bg-white/5" data-testid="nav-dashboard">
              Dashboard
            </Link>
          ) : (
            <Link href="/login" className="rounded-full px-3 py-2 text-subhead font-semibold text-fg-secondary transition hover:bg-white/5 hover:text-white">
              Sign in
            </Link>
          )}
          <GetAppButton placement="landing_nav" params={params} initialPlatform={initialPlatform} variant="compact" label="Get the app" />
        </div>
      </nav>
    </header>
  );
}

/** "Start free" secondary CTA: the web app for signed-out visitors, the dashboard for members. */
export function WebCta({ className }: { className?: string }) {
  const user = useAuthStore((s) => s.user);
  return (
    <Link
      href={user ? '/dashboard' : '/register'}
      className={
        className ??
        'inline-flex h-14 items-center justify-center rounded-lg border border-hairline bg-white/5 px-6 text-headline text-white transition hover:bg-white/10'
      }
      data-testid="landing-web-cta"
    >
      {user ? 'Open your dashboard' : 'Use it on the web'}
    </Link>
  );
}
