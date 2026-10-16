import type { Metadata } from 'next';

import { CampaignList } from '@/components/admin/campaigns/CampaignList';

export const metadata: Metadata = { title: 'Campaigns · Admin' };

export default function AdminCampaignsPage() {
  return <CampaignList />;
}
