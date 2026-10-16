import type { NextRequest } from 'next/server';

import { renderInviteOgImage } from '@/lib/referrals/og-image';

/** GET /i/{code}/og — share-card image for a personal invite (referenced by the page's og:image). */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return renderInviteOgImage(code, null);
}
