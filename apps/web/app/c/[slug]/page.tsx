import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';

import { CampaignLanding } from '@/components/campaigns/CampaignLanding';
import { CampaignPageClient } from '@/components/campaigns/CampaignPageClient';
import { dateRange } from '@/lib/campaigns/campaign-utils';
import { getSessionUser, loadPublicCampaign } from '@/lib/campaigns/server';
import { detectPlatform } from '@/lib/referrals/web';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ slug: string }> };

const HOST = 'https://www.fitcircle.ai';

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const slug = (await params).slug.toLowerCase();
  const c = await loadPublicCampaign(slug);
  if (!c) return { title: 'FitCircle', robots: { index: false, follow: false } };
  const title = `${c.title} ${c.emoji}`.trim();
  const description = [c.tagline, dateRange(c.startsAt, c.endsAt)].filter(Boolean).join(' · ');
  const url = `${HOST}/c/${c.slug}`;
  const image = c.art.appStoreCard
    ? { url: c.art.appStoreCard, width: 1920, height: 1080, alt: c.title }
    : c.art.inAppHero
      ? { url: c.art.inAppHero, width: 1200, height: 675, alt: c.title }
      : { url: '/og-image.png', width: 1200, height: 630, alt: 'FitCircle' };
  return {
    title: { absolute: `${title} · FitCircle` },
    description,
    alternates: { canonical: url },
    openGraph: { type: 'website', siteName: 'FitCircle', url, title, description, images: [image] },
    twitter: { card: 'summary_large_image', title, description, images: [image.url] },
  };
}

/** Campaign page: https://www.fitcircle.ai/c/{slug} (CAMPAIGNS_SPEC §6, §9, §10). */
export default async function CampaignPage({ params }: Props) {
  const slug = (await params).slug.toLowerCase();
  const [user, campaign, h] = await Promise.all([getSessionUser(), loadPublicCampaign(slug), headers()]);

  if (user) {
    // Signed in: the viewer API decides visibility (incl. admin draft previews).
    return <CampaignPageClient slug={slug} fallback={campaign} />;
  }
  if (!campaign) notFound();
  return (
    <CampaignLanding
      campaign={campaign}
      initialPlatform={detectPlatform(h.get('user-agent'))}
      appStoreUrl={process.env.NEXT_PUBLIC_APP_STORE_URL || ''}
      playStoreLive={Boolean(process.env.NEXT_PUBLIC_PLAY_STORE_URL)}
    />
  );
}
