'use client';

import { Navbar } from '@/components/layout/navbar';
import { InviteHub } from '@/components/referrals/InviteHub';

/**
 * Web invite hub ("Better together"). Auth is enforced by middleware.ts
 * (/invite is not a public route → unauthenticated visitors go to /login?returnUrl=/invite).
 */
export default function InvitePage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950">
      <div className="pointer-events-none fixed inset-0 overflow-hidden" aria-hidden>
        <div className="absolute -top-40 left-1/2 h-[520px] w-[520px] -translate-x-1/2 rounded-full bg-purple-600/15 blur-3xl" />
        <div className="absolute bottom-0 right-[-120px] h-[420px] w-[420px] rounded-full bg-pink-600/10 blur-3xl" />
      </div>
      <Navbar />
      <main className="relative">
        <InviteHub />
      </main>
    </div>
  );
}
