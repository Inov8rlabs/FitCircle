import Link from 'next/link';

import { GradientText } from '@/components/ui/gradient-text';

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-canvas bg-hero-glow px-6 text-center text-white">
      <GradientText as="p" className="text-[64px] font-bold leading-none">
        404
      </GradientText>
      <h1 className="mt-4 text-title2 text-white">Page not found</h1>
      <p className="mt-2 max-w-sm text-subhead text-fg-secondary">
        The page you&apos;re looking for doesn&apos;t exist or has moved.
      </p>
      <Link
        href="/dashboard"
        className="mt-8 inline-flex h-12 items-center justify-center rounded-xl bg-gradient-brand px-6 text-headline text-white shadow-glow transition hover:brightness-110 active:scale-[0.98]"
      >
        Back to dashboard
      </Link>
    </div>
  );
}
