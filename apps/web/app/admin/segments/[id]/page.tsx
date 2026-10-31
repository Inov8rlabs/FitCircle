import type { Metadata } from 'next';

import { SegmentEditor } from '@/components/admin/engage/segments/Segments';

export const metadata: Metadata = { title: 'Segment' };

type Props = { params: Promise<{ id: string }> };

export default async function SegmentPage({ params }: Props) {
  const { id } = await params;
  return <SegmentEditor key={id} id={id} />;
}
