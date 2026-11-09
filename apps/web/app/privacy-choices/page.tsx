import { ArrowLeft, SlidersHorizontal } from 'lucide-react';
import { type Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Your Privacy Choices | FitCircle',
  description:
    'Do Not Sell or Share: how to opt out of ad-measurement sharing and manage health, AI and email choices in FitCircle.',
};

const LAST_UPDATED = 'November 6, 2026';

const mail = (
  <a href="mailto:privacy@fitcircle.ai" className="text-cyan-400 hover:underline">privacy@fitcircle.ai</a>
);

const h2 = 'text-2xl font-bold text-white mb-4';
const list = 'text-slate-300 space-y-2 list-disc list-inside';

export default function PrivacyChoicesPage() {
  return (
    <div className="min-h-screen bg-canvas bg-hero-glow">
      <div className="max-w-4xl mx-auto p-6 py-12">
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-cyan-400 hover:text-cyan-300 mb-8 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to FitCircle
        </Link>

        <div className="mb-12">
          <h1 className="text-5xl font-bold text-white mb-4 flex items-center gap-4">
            <SlidersHorizontal className="h-12 w-12 text-purple-400" aria-hidden="true" />
            Your Privacy Choices
          </h1>
          <p className="text-slate-300 text-lg">Do Not Sell or Share My Personal Information</p>
          <p className="text-slate-400 text-sm mt-2">Last Updated: {LAST_UPDATED}</p>
        </div>

        <div className="prose prose-invert prose-slate max-w-none">
          <div className="bg-slate-900/50 border border-slate-700 rounded-xl p-8 space-y-8">
            <section>
              <h2 className={h2}>We Do Not Sell Your Personal Data</h2>
              <p className="text-slate-300 leading-relaxed">
                FitCircle (Inov8r Labs Inc.) does not sell personal data, and never uses or shares your health
                and fitness data, food logs, photos or messages for advertising.
              </p>
            </section>

            <section>
              <h2 className={h2}>Ad Measurement &quot;Sharing&quot;</h2>
              <p className="text-slate-300 leading-relaxed">
                When we advertise FitCircle on other services, the mobile apps tell our ad partners (Google,
                Apple Search Ads and, on iOS only, Meta) about a small set of events, such as installing the app,
                signing up and starting a trial, together with a device advertising identifier. This helps us
                learn which ads work. Some US state laws call this &quot;sharing&quot; or &quot;targeted
                advertising&quot;. The free mobile apps also show ads from Google AdMob. The website shows no ads
                and loads no advertising pixels. Details are in the advertising section of our{' '}
                <Link href="/privacy" className="text-cyan-400 hover:underline">Privacy Policy</Link>.
              </p>
            </section>

            <section>
              <h2 className={h2}>How to Opt Out</h2>
              <ul className={list}>
                <li>
                  <strong className="text-white">Signed in on the website:</strong> turn on{' '}
                  <strong className="text-white">Do Not Sell My Personal Information</strong> in{' '}
                  <Link href="/settings/privacy" className="text-cyan-400 hover:underline">Settings → Privacy</Link>.
                  We apply it to your account on every device.
                </li>
                <li>
                  <strong className="text-white">Website cookies:</strong> choose Reject in the cookie banner or
                  change your choice in{' '}
                  <Link href="/settings/privacy" className="text-cyan-400 hover:underline">Privacy Settings</Link>.
                  We honour the Global Privacy Control (GPC) signal from your browser as an opt-out.
                </li>
                <li>
                  <strong className="text-white">iPhone and iPad:</strong> choose &quot;Ask App Not to Track&quot;
                  in the App Tracking Transparency prompt, or turn tracking off in Settings → Privacy &amp; Security
                  → Tracking. Without tracking permission, Meta measurement does not run and the advertising
                  identifier is not shared.
                </li>
                <li>
                  <strong className="text-white">Android:</strong> reset or delete your advertising ID in Settings
                  → Privacy → Ads (or Settings → Google → Ads), and review Privacy &amp; Ad Choices in FitCircle.
                </li>
                <li>
                  <strong className="text-white">By email:</strong> write to {mail} from your account email
                  address and ask us to opt you out. We do not need anything else from you.
                </li>
              </ul>
            </section>

            <section>
              <h2 className={h2}>Health Data and AI</h2>
              <p className="text-slate-300 leading-relaxed">
                Your consent to process health data and your permission for AI features are separate choices. You
                can review or withdraw them at any time in{' '}
                <Link href="/settings/privacy" className="text-cyan-400 hover:underline">Settings → Privacy</Link>{' '}
                on the website, or in Settings in the apps. See also our{' '}
                <Link href="/consumer-health-privacy" className="text-cyan-400 hover:underline">
                  Consumer Health Data Privacy Policy
                </Link>.
              </p>
            </section>

            <section>
              <h2 className={h2}>Marketing Email</h2>
              <p className="text-slate-300 leading-relaxed">
                Every marketing email has an unsubscribe link. You can also turn marketing email off in your
                notification settings. We will still send essential service and security emails.
              </p>
            </section>

            <section>
              <h2 className={h2}>Your Other Rights</h2>
              <p className="text-slate-300 leading-relaxed">
                You can export your data (free, including photos) or delete your account at any time. See the
                rights section of our <Link href="/privacy" className="text-cyan-400 hover:underline">Privacy Policy</Link> for
                the rights that apply where you live and how to appeal a decision, or email {mail}.
              </p>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
