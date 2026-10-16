import type { Metadata } from 'next';
import { headers } from 'next/headers';

import { InviteLanding } from '@/components/referrals/InviteLanding';
import { buildInviteMetadata } from '@/lib/referrals/invite-metadata';
import { normalizeCode } from '@/lib/referrals/links';
import { loadInvitePreview } from '@/lib/referrals/load-preview';
import { detectPlatform } from '@/lib/referrals/web';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ code: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const code = normalizeCode((await params).code);
  const { preview } = await loadInvitePreview(code, null);
  return buildInviteMetadata(preview, { kind: 'personal', code, ref: null });
}

/** Personal invite landing page: https://www.fitcircle.ai/i/{REFCODE} (docs/REFERRALS_SPEC.md §3). */
export default async function PersonalInvitePage({ params }: Props) {
  const code = normalizeCode((await params).code);
  const [{ preview, degraded }, h] = await Promise.all([loadInvitePreview(code, null), headers()]);
  return (
    <InviteLanding
      kind="personal"
      code={code}
      refCode={null}
      preview={preview}
      degraded={degraded}
      initialPlatform={detectPlatform(h.get('user-agent'))}
      appStoreUrl={process.env.NEXT_PUBLIC_APP_STORE_URL || ''}
      playStoreLive={Boolean(process.env.NEXT_PUBLIC_PLAY_STORE_URL)}
    />
  );
}
