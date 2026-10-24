import type { Metadata } from 'next';
import { Suspense } from 'react';

import { CampaignDetailView } from '@/components/admin/ads/CampaignDetailView';

export const metadata: Metadata = { title: 'Ad campaign · Admin' };

export default async function AdminAdsCampaignPage({ params }: { params: Promise<{ channel: string; externalId: string }> }) {
  const { channel, externalId } = await params;
  return (
    <Suspense>
      <CampaignDetailView channel={channel} externalId={decodeURIComponent(externalId)} />
    </Suspense>
  );
}
