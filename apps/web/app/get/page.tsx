import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { GetAppPage } from '@/components/app-links/GetAppPage';
import { GradientText } from '@/components/ui/gradient-text';
import { detectPlatform, parseGetAppParams, storeTargetFor } from '@/lib/app-links';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Get the FitCircle app',
  description: 'FitCircle is free on iPhone and Android. Log meals in seconds, track your streak and compete with friends.',
  alternates: { canonical: '/get' },
};

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/**
 * Smart "get the app" link. Phones are sent straight to their store (307, so
 * the store app opens inside the tap); the Play link carries the invite and
 * UTM in its install referrer. Desktops (and unknown agents) get a QR page.
 */
export default async function GetAppRoute({ searchParams }: Props) {
  const [params, h] = await Promise.all([searchParams, headers()]);
  const parsed = parseGetAppParams(params);
  const platform = detectPlatform(h.get('user-agent'));
  const target = storeTargetFor(platform, parsed, process.env.NEXT_PUBLIC_ASC_PROVIDER_TOKEN);
  if (target.url) redirect(target.url);

  return (
    <GetAppPage
      source="get_page"
      platform={platform}
      params={parsed}
      eyebrow="Free on iPhone & Android"
      title={
        <>
          FitCircle is better <GradientText tone="sunset">in your pocket</GradientText>
        </>
      }
      subtitle="Log a meal in seconds, keep your streak alive and cheer on your circle, wherever you are."
      continueHref="/login"
      continueLabel="Or sign in on the web"
    />
  );
}
