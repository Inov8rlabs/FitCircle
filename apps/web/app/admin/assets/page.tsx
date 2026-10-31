import type { Metadata } from 'next';

import { AssetsPage } from '@/components/admin/engage/assets/AssetsPage';

export const metadata: Metadata = { title: 'Assets' };

export default function AdminAssetsPage() {
  return <AssetsPage />;
}
