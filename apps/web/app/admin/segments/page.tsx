import type { Metadata } from 'next';

import { SegmentList } from '@/components/admin/engage/segments/Segments';

export const metadata: Metadata = { title: 'Segments' };

export default function SegmentsPage() {
  return <SegmentList />;
}
