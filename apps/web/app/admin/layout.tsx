import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { Navbar } from '@/components/layout/navbar';
import { getAdminUser } from '@/lib/campaigns/server';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Admin',
  robots: { index: false, follow: false },
};

/** Admin area: server-side gate on profiles.is_admin; everyone else gets a 404 (CAMPAIGNS_SPEC §9). */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const admin = await getAdminUser();
  if (!admin) notFound();
  return (
    <>
      <Navbar />
      <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950">
        <div className="mx-auto max-w-[1440px] px-4 sm:px-6 lg:px-8">{children}</div>
      </div>
    </>
  );
}
