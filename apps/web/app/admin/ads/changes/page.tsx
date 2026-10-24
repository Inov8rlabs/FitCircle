import type { Metadata } from 'next';
import { Suspense } from 'react';

import { ChangeLogView } from '@/components/admin/ads/ChangeLogView';

export const metadata: Metadata = { title: 'Ad change log · Admin' };

export default function AdminAdsChangesPage() {
  return (
    <Suspense>
      <ChangeLogView />
    </Suspense>
  );
}
