import type { Metadata } from 'next';

import { CampaignEditor } from '@/components/admin/campaigns/CampaignEditor';

export const metadata: Metadata = { title: 'New campaign · Admin' };

export default function NewCampaignPage() {
  return <CampaignEditor id={null} />;
}
