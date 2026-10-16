import type { Metadata } from 'next';

import { CampaignEditor } from '@/components/admin/campaigns/CampaignEditor';

export const metadata: Metadata = { title: 'Edit campaign · Admin' };

type Props = { params: Promise<{ id: string }> };

export default async function EditCampaignPage({ params }: Props) {
  const { id } = await params;
  return <CampaignEditor key={id} id={id} />;
}
