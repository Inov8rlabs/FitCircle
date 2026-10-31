import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { EngageShell } from '@/components/admin/engage/EngageShell';
import { getAdminUser } from '@/lib/campaigns/server';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: { default: 'FitCircle Engage', template: '%s · Engage' },
  robots: { index: false, follow: false },
};

/** FitCircle Engage (ENGAGE_SPEC §12): server-side gate on profiles.is_admin; everyone else gets a 404. */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const admin = await getAdminUser();
  if (!admin) notFound();
  return <EngageShell>{children}</EngageShell>;
}
