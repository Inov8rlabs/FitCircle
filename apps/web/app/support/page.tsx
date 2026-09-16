import { LifeBuoy, ArrowLeft, Mail } from 'lucide-react';
import { type Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Support | FitCircle',
  description: 'Get help with FitCircle: contact support, manage your subscription, or delete your account.',
};

const SUPPORT_EMAIL = 'support@fitcircle.ai';

export default function SupportPage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950">
      <div className="max-w-3xl mx-auto p-6 py-12">
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-cyan-400 hover:text-cyan-300 mb-8 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to FitCircle
        </Link>

        <div className="mb-10">
          <h1 className="text-5xl font-bold text-white mb-4 flex items-center gap-4">
            <LifeBuoy className="h-12 w-12 text-purple-400" />
            Support
          </h1>
          <p className="text-slate-400 text-lg">
            We answer every message, usually within one business day.
          </p>
        </div>

        <a
          href={`mailto:${SUPPORT_EMAIL}`}
          className="flex items-center gap-4 rounded-2xl border border-slate-800 bg-slate-900/60 p-6 mb-10 hover:border-purple-500/60 transition-colors"
        >
          <Mail className="h-8 w-8 text-cyan-400 shrink-0" />
          <div>
            <div className="text-white text-xl font-semibold">{SUPPORT_EMAIL}</div>
            <div className="text-slate-400 text-sm">
              Include the email address on your FitCircle account so we can find it quickly.
            </div>
          </div>
        </a>

        <div className="prose prose-invert prose-slate max-w-none space-y-8">
          <section>
            <h2 className="text-2xl font-semibold text-white">Common questions</h2>
            <dl className="mt-4 space-y-5">
              <div>
                <dt className="text-white font-medium">How do I manage or cancel FitCircle Pro?</dt>
                <dd className="text-slate-400">
                  Subscriptions bought on iPhone are managed by Apple: open Settings → your name → Subscriptions →
                  FitCircle. On Android, open the Play Store → Payments &amp; subscriptions. Pro Lifetime is a
                  one-time purchase and never renews.
                </dd>
              </div>
              <div>
                <dt className="text-white font-medium">I paid but the app still shows the free tier.</dt>
                <dd className="text-slate-400">
                  In the app, open Profile → Settings → FitCircle Pro → Restore Purchases. If that does not
                  unlock Pro within a minute, email us with your account email and the purchase receipt.
                </dd>
              </div>
              <div>
                <dt className="text-white font-medium">How do I delete my account?</dt>
                <dd className="text-slate-400">
                  In the app, open Profile → Settings → Delete Account. Your account and all of its data are
                  removed immediately. You can also email us and we will delete it for you.
                </dd>
              </div>
              <div>
                <dt className="text-white font-medium">Apple Health data is not syncing.</dt>
                <dd className="text-slate-400">
                  Open the iPhone Settings app → Health → Data Access &amp; Devices → FitCircle and make sure
                  Steps, Workouts and Weight are turned on. Then in FitCircle open Settings → Sync Last 7 Days.
                </dd>
              </div>
            </dl>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-white">Legal</h2>
            <p className="text-slate-400">
              <Link href="/privacy" className="text-cyan-400 hover:text-cyan-300">Privacy Policy</Link>
              {' · '}
              <Link href="/terms" className="text-cyan-400 hover:text-cyan-300">Terms of Service</Link>
            </p>
            <p className="text-slate-500 text-sm">FitCircle is made by Inov8r Labs Inc.</p>
          </section>
        </div>
      </div>
    </div>
  );
}
