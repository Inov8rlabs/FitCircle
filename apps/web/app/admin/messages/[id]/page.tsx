import type { Metadata } from 'next';

import { MessageComposer } from '@/components/admin/engage/composer/MessageComposer';

export const metadata: Metadata = { title: 'Message' };

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string; platform?: string }> };

export default async function MessagePage({ params, searchParams }: Props) {
  const [{ id }, { tab, platform }] = await Promise.all([params, searchParams]);
  const p = platform === 'android' || platform === 'web' || platform === 'ios' ? platform : undefined;
  return <MessageComposer key={id} id={id} initialTab={tab === 'analytics' ? 'analytics' : 'compose'} initialPlatform={p} />;
}
