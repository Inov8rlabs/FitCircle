import type { Metadata } from 'next';

import { MessageList } from '@/components/admin/engage/messages/MessageList';
import type { EngageChannel } from '@/lib/engage/types';

export const metadata: Metadata = { title: 'Messages' };

const CHANNELS: EngageChannel[] = ['content_card', 'in_app', 'push', 'email'];

type Props = { searchParams: Promise<{ channel?: string }> };

export default async function MessagesPage({ searchParams }: Props) {
  const { channel } = await searchParams;
  const ch = CHANNELS.includes(channel as EngageChannel) ? (channel as EngageChannel) : null;
  return <MessageList key={ch ?? 'all'} channel={ch} />;
}
