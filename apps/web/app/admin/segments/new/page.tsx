import type { Metadata } from 'next';

import { SegmentEditor } from '@/components/admin/engage/segments/Segments';

export const metadata: Metadata = { title: 'New segment' };

export default function NewSegmentPage() {
  return <SegmentEditor id={null} />;
}
