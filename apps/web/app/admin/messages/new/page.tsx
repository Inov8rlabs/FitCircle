import type { Metadata } from 'next';

import { MessageComposer } from '@/components/admin/engage/composer/MessageComposer';
import type { EngageChannel } from '@/lib/engage/types';

export const metadata: Metadata = { title: 'New message' };

const CHANNELS: EngageChannel[] = ['content_card', 'in_app', 'push', 'email'];

type Props = { searchParams: Promise<{ channel?: string; campaignId?: string }> };

export default async function NewMessagePage({ searchParams }: Props) {
  const { channel, campaignId } = await searchParams;
  const ch = CHANNELS.includes(channel as EngageChannel) ? (channel as EngageChannel) : 'content_card';
  return <MessageComposer key={`${ch}-${campaignId ?? ''}`} id={null} initialChannel={ch} campaignId={campaignId ?? null} />;
}
