'use client';

import { Navbar } from '@/components/layout/navbar';
import { InviteHub } from '@/components/referrals/InviteHub';

/**
 * Web invite hub ("Better together"). Auth is enforced by middleware.ts
 * (/invite is not a public route → unauthenticated visitors go to /login?returnUrl=/invite).
 */
export default function InvitePage() {
  return (
    <div className="min-h-screen bg-canvas">
      <div className="pointer-events-none fixed inset-x-0 top-0 h-[480px] bg-[radial-gradient(60%_60%_at_50%_0%,rgba(139,92,246,0.18),transparent_70%)]" aria-hidden />
      <Navbar />
      <main className="relative">
        <InviteHub />
      </main>
    </div>
  );
}
