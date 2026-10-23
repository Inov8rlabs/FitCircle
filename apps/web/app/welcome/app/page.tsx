import type { Metadata } from 'next';
import { headers } from 'next/headers';

import { GetAppPage } from '@/components/app-links/GetAppPage';
import { GradientText } from '@/components/ui/gradient-text';
import { detectPlatform, parseGetAppParams } from '@/lib/app-links';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'You’re in · Get the FitCircle app',
  robots: { index: false, follow: false },
};

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/** Same-origin, relative path only (no //host or scheme), else /dashboard. */
function safeNext(raw: string | string[] | undefined): string {
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (!v || !v.startsWith('/') || v.startsWith('//') || v.startsWith('/\\') || /^[a-z][a-z0-9+.-]*:/i.test(v)) {
    return '/dashboard';
  }
  return v;
}

/** Post-signup handoff: the account works in the app right away; the web stays one tap away. */
export default async function WelcomeAppRoute({ searchParams }: Props) {
  const [params, h] = await Promise.all([searchParams, headers()]);
  const parsed = parseGetAppParams(params);
  const platform = detectPlatform(h.get('user-agent'));
  return (
    <GetAppPage
      source="post_signup"
      platform={platform}
      params={{ ...parsed, placement: parsed.placement ?? 'post_signup' }}
      eyebrow="Account ready"
      title={
        <>
          You&apos;re in. <GradientText tone="sunset">Now get the app.</GradientText>
        </>
      }
      subtitle="Sign in with the same email and everything you set up is already there."
      continueHref={safeNext(params.next)}
      continueLabel="Continue on the web"
    />
  );
}
