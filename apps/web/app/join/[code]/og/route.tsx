import type { NextRequest } from 'next/server';

import { renderInviteOgImage } from '@/lib/referrals/og-image';

/** GET /join/{code}/og?ref= — share-card image for a circle invite (referenced by the page's og:image). */
export async function GET(request: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return renderInviteOgImage(code, request.nextUrl.searchParams.get('ref'));
}
