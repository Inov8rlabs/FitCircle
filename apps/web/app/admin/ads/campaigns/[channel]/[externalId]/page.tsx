import { permanentRedirect } from 'next/navigation';

import { ADMIN_TOOLS_ADS_URL } from '@/lib/ads/services/email-report-service';

/** The Ads Console moved to Admin Tools; keep old links working. */
export default async function AdminAdsCampaignPage({ params }: { params: Promise<{ channel: string; externalId: string }> }) {
  const { channel, externalId } = await params;
  permanentRedirect(`${ADMIN_TOOLS_ADS_URL}/campaigns/${encodeURIComponent(channel)}/${externalId}`);
}
