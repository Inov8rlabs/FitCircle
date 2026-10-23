import { ArrowLeft, Shield } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Delete Your Account | FitCircle',
  description: 'How to request deletion of your FitCircle account and associated data.',
};

export default function DeleteAccountPage() {
  return (
    <main className="min-h-screen bg-canvas bg-hero-glow px-4 py-10 text-fg-secondary sm:px-6 sm:py-12">
      <div className="mx-auto max-w-2xl space-y-8">
        <Link href="/privacy" className="inline-flex items-center gap-2 text-body text-brand-purple hover:brightness-110">
          <ArrowLeft size={18} aria-hidden="true" /> FitCircle privacy policy
        </Link>
        <header className="space-y-4">
          <span className="inline-flex h-14 w-14 items-center justify-center rounded-full bg-brand-purple/20 text-brand-purple"><Shield size={28} aria-hidden="true" /></span>
          <p className="text-footnote font-semibold uppercase tracking-widest text-brand-purple">FitCircle</p>
          <h1 className="w-fit bg-gradient-sunset bg-clip-text text-title1 text-transparent sm:text-large-title">Delete your account</h1>
          <p className="leading-relaxed">
            You can request deletion from the app or this website. You do not need to reinstall FitCircle.
            Account deletion is permanent, so export any data you want to keep first.
          </p>
        </header>
        <section className="space-y-4 rounded-xl border border-glass bg-surface-raised/50 p-5 backdrop-blur-xl sm:p-6">
          <h2 className="text-title3 text-white">Request deletion on the website</h2>
          <ol className="list-decimal space-y-3 pl-5">
            <li>Sign in to the FitCircle account you want to delete.</li>
            <li>Open Privacy Settings and select <strong className="text-white">Delete My Account Permanently</strong>.</li>
            <li>Read the confirmation and enter your account email address to confirm.</li>
          </ol>
          <Link href="/settings/privacy" className="inline-flex h-12 items-center rounded-xl bg-gradient-brand px-6 text-headline text-white shadow-glow transition hover:brightness-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand-purple">
            Open Privacy Settings
          </Link>
          <p className="text-sm leading-relaxed">
            Cannot sign in? Email{' '}
            <a className="text-brand-purple underline" href="mailto:privacy@fitcircle.ai?subject=FitCircle%20account%20deletion%20request">privacy@fitcircle.ai</a>{' '}
            from your account email address to request deletion. Do not send your password.
          </p>
        </section>
        <section className="space-y-3">
          <h2 className="text-title3 text-white">Request deletion in the app</h2>
          <p>Open Profile → Settings → Delete Account and follow the confirmation steps.</p>
        </section>
        <section className="space-y-3 leading-relaxed">
          <h2 className="text-title3 text-white">What happens to your data</h2>
          <p>
            Deletion removes your FitCircle account and associated personal data, including your profile,
            health and fitness logs, uploaded photos, and messages. Our privacy policy specifies that
            deleted account data is erased within 30 days of the request.
          </p>
          <p>
            Anonymized aggregate analytics may be retained indefinitely. Purchase records held
            independently by Apple or Google are governed by their own privacy policies.
          </p>
          <p>
            Deleting your FitCircle account does not cancel an App Store or Google Play subscription.
            Manage or cancel subscriptions separately in your store account settings.
          </p>
          <Link href="/privacy" className="inline-block text-brand-purple underline">Read the full privacy policy</Link>
        </section>
      </div>
    </main>
  );
}
