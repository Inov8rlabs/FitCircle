import { ArrowLeft, Globe } from 'lucide-react';
import { type Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Not available in your region | FitCircle',
  description: 'FitCircle sign-up is not available in your region yet.',
  robots: { index: false },
};

/**
 * Shown when WEB_EU_SIGNUP_BLOCK is on (the default) and an EU/EEA visitor opens /register or /upgrade
 * (middleware.ts; lib/geo/region-restriction.ts). Existing accounts keep sign-in, export and deletion.
 */
export default async function NotAvailablePage({ searchParams }: { searchParams: Promise<{ reason?: string }> }) {
  const { reason } = await searchParams;
  const checkout = reason === 'checkout';
  return (
    <div className="min-h-screen bg-canvas bg-hero-glow">
      <div className="max-w-xl mx-auto p-6 py-16">
        <Link href="/" className="inline-flex items-center gap-2 text-cyan-400 hover:text-cyan-300 mb-8 transition-colors">
          <ArrowLeft className="h-4 w-4" />
          Back to FitCircle
        </Link>
        <h1 className="text-4xl font-bold text-white mb-4 flex items-center gap-3">
          <Globe className="h-9 w-9 text-purple-400" aria-hidden="true" />
          Not available in your region yet
        </h1>
        <p className="text-slate-300 text-lg mb-6">
          {checkout
            ? "FitCircle Pro purchases aren't available in your region yet."
            : "New FitCircle accounts aren't available in your region yet."}{' '}
          FitCircle is currently offered in the United States, Canada, India and Singapore.
        </p>
        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5 text-slate-300 space-y-3">
          <p className="font-semibold text-white">Already have an account?</p>
          <p>
            You can still <Link href="/login" className="text-cyan-400 hover:underline">sign in</Link>, download your data
            and delete your account at any time.
          </p>
          <p>
            Questions? Email <a href="mailto:privacy@fitcircle.ai" className="text-cyan-400 hover:underline">privacy@fitcircle.ai</a>.
          </p>
        </div>
      </div>
    </div>
  );
}
