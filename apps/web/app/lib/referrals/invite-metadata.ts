import type { Metadata } from 'next';

import type { ReferralPreview } from './types';
import { canonicalInviteUrl, inviteDescription, inviteTitle } from './web';

/** OG/Twitter metadata for an invite landing page (personal or circle). */
export function buildInviteMetadata(
  preview: ReferralPreview,
  page: { kind: 'personal' | 'circle'; code: string; ref: string | null }
): Metadata {
  const title = inviteTitle(preview);
  const description = inviteDescription(preview);
  const url = canonicalInviteUrl(page.kind, page.code, page.kind === 'circle' ? page.ref : null);
  const base = page.kind === 'circle' ? `/join/${encodeURIComponent(page.code)}` : `/i/${encodeURIComponent(page.code)}`;
  const image = page.kind === 'circle' && page.ref ? `${base}/og?ref=${encodeURIComponent(page.ref)}` : `${base}/og`;

  return {
    // `absolute` skips the root "%s | FitCircle" template: the title already names FitCircle.
    title: { absolute: title },
    description,
    alternates: { canonical: url },
    robots: { index: false, follow: false },
    openGraph: {
      type: 'website',
      siteName: 'FitCircle',
      url,
      title,
      description,
      images: [{ url: image, width: 1200, height: 630, alt: title }],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [image],
    },
  };
}
