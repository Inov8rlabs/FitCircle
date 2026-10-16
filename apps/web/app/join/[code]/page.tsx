import type { Metadata } from 'next';
import { headers } from 'next/headers';

import { InviteLanding } from '@/components/referrals/InviteLanding';
import { buildInviteMetadata } from '@/lib/referrals/invite-metadata';
import { normalizeCode } from '@/lib/referrals/links';
import { loadInvitePreview } from '@/lib/referrals/load-preview';
import { detectPlatform } from '@/lib/referrals/web';

export const dynamic = 'force-dynamic';

type Props = {
  params: Promise<{ code: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

async function resolve({ params, searchParams }: Props) {
  const [{ code: rawCode }, sp] = await Promise.all([params, searchParams]);
  const rawRef = Array.isArray(sp.ref) ? sp.ref[0] : sp.ref;
  const ref = rawRef ? normalizeCode(rawRef) || null : null;
  return { code: normalizeCode(rawCode), ref };
}

export async function generateMetadata(props: Props): Promise<Metadata> {
  const { code, ref } = await resolve(props);
  const { preview } = await loadInvitePreview(code, ref);
  return buildInviteMetadata(preview, { kind: 'circle', code, ref });
}

/**
 * Circle invite landing page: https://www.fitcircle.ai/join/{CIRCLECODE}?ref={REFCODE}.
 * Signed-out visitors get the "saved you a seat" landing; signed-in members can
 * join right here (JoinCircleFlow → POST /api/mobile/circles/join).
 */
export default async function JoinCirclePage(props: Props) {
  const { code, ref } = await resolve(props);
  const [{ preview, degraded }, h] = await Promise.all([loadInvitePreview(code, ref), headers()]);
  return (
    <InviteLanding
      kind="circle"
      code={code}
      refCode={ref}
      preview={preview}
      degraded={degraded}
      initialPlatform={detectPlatform(h.get('user-agent'))}
      appStoreUrl={process.env.NEXT_PUBLIC_APP_STORE_URL || ''}
      playStoreLive={Boolean(process.env.NEXT_PUBLIC_PLAY_STORE_URL)}
    />
  );
}
