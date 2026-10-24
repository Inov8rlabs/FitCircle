import type { Metadata } from 'next';
import { Suspense } from 'react';

import { AdsOverviewView } from '@/components/admin/ads/AdsOverviewView';

export const metadata: Metadata = { title: 'Ads · Admin' };

export default function AdminAdsPage() {
  return (
    <Suspense>
      <AdsOverviewView />
    </Suspense>
  );
}
