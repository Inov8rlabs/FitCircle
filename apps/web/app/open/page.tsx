import { redirect } from 'next/navigation';

import { getAppHref, parseGetAppParams } from '@/lib/app-links';

export const dynamic = 'force-dynamic';

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/**
 * "Open in FitCircle" target. https://fitcircle.ai/open is claimed in
 * apple-app-site-association, so with the iOS app installed the tap never
 * reaches this page. When it does (app not installed, Android fallback,
 * desktop), forward to /get with the same attribution, which picks the store.
 */
export default async function OpenInAppRoute({ searchParams }: Props) {
  redirect(getAppHref(parseGetAppParams(await searchParams)));
}
