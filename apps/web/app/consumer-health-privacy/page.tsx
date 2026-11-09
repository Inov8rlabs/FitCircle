import { ArrowLeft, HeartPulse } from 'lucide-react';
import { type Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Consumer Health Data Privacy Policy | FitCircle',
  description:
    'How FitCircle collects, uses and shares consumer health data, and how Washington and Nevada residents can exercise their rights.',
};

// Update whenever the text changes; never compute at render time.
const LAST_UPDATED = 'November 6, 2026';
const POLICY_VERSION = '1.0';


const mail = (
  <a href="mailto:privacy@fitcircle.ai" className="text-cyan-400 hover:underline">privacy@fitcircle.ai</a>
);

const h2 = 'text-2xl font-bold text-white mb-4';
const list = 'text-slate-300 space-y-2 list-disc list-inside';

export default function ConsumerHealthPrivacyPage() {
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
            <HeartPulse className="h-12 w-12 text-purple-400" aria-hidden="true" />
            Consumer Health Data Privacy Policy
          </h1>
          <p className="text-slate-400 text-lg">Last Updated: {LAST_UPDATED}</p>
          <p className="text-slate-400 text-sm mt-2">Version {POLICY_VERSION}</p>
        </div>

        <div className="prose prose-invert prose-slate max-w-none">
          <div className="bg-slate-900/50 border border-slate-700 rounded-xl p-8 space-y-8">
            <section>
              <h2 className={h2}>1. About This Policy</h2>
              <p className="text-slate-300 leading-relaxed">
                This policy supplements our{' '}
                <Link href="/privacy" className="text-cyan-400 hover:underline">Privacy Policy</Link> and applies to
                &quot;consumer health data&quot; as defined by the Washington My Health My Data Act (MHMDA) and
                Nevada Senate Bill 370. It is provided by Inov8r Labs Inc. (&quot;FitCircle&quot;), a British Columbia corporation (BC Corporation No.
                BC1310005),{' '}
                485 - 6400 Roberts Street, Burnaby, British Columbia V5G 4C9, Canada. We apply it to all FitCircle
                users, wherever they live.
              </p>
            </section>

            <section>
              <h2 className={h2}>2. Categories of Consumer Health Data We Collect</h2>
              <ul className={list}>
                <li>Weight, body measurements, and body composition values (such as body fat and muscle mass)</li>
                <li>Meals, food, nutrition and supplement logs, including calories and macronutrients</li>
                <li>Water and beverage intake</li>
                <li>Workouts, physical activity, and step counts</li>
                <li>Mood and energy check-ins</li>
                <li>Health goals, streaks and progress toward them</li>
                <li>Data you choose to import from Apple Health (iOS) or Health Connect (Android)</li>
                <li>Photos of meals and photos of body composition scan reports</li>
                <li>Messages to the Fitzy assistant and Fitzy memory, where they contain health information</li>
              </ul>
              <p className="text-slate-300 leading-relaxed mt-4">
                We do not collect precise location data and do not use geofencing around any health care
                facility or other location.
              </p>
            </section>

            <section>
              <h2 className={h2}>3. Sources</h2>
              <ul className={list}>
                <li><strong className="text-white">You</strong>, when you log, type, speak or photograph something in FitCircle</li>
                <li><strong className="text-white">Connected health apps</strong> (Apple Health, Health Connect), only with your permission</li>
                <li>
                  <strong className="text-white">Devices</strong> that write into those health apps, such as
                  smart scales, watches and fitness trackers
                </li>
              </ul>
            </section>

            <section>
              <h2 className={h2}>4. Why We Collect and Use It</h2>
              <ul className={list}>
                <li>To show your logs, progress, trends, streaks and goals</li>
                <li>To run FitCircles, challenges and leaderboards you join</li>
                <li>
                  To provide AI features (nutrition estimates, body composition scan reading, Fitzy replies and
                  daily focus) and to measure their accuracy, only if you have allowed AI processing
                </li>
                <li>To send reminders and notifications you have turned on</li>
                <li>To keep the Service secure and to comply with law</li>
              </ul>
              <p className="text-slate-300 leading-relaxed mt-4">
                We ask for your separate consent before we collect consumer health data, and we record that
                consent on our server. You can withdraw it at any time in Settings → Privacy.{' '}
                <strong className="text-white">
                  We never use consumer health data for advertising, and we never sell it.
                </strong>
              </p>
            </section>

            <section>
              <h2 className={h2}>5. Categories We Share, and With Whom</h2>
              <ul className={list}>
                <li>
                  <strong className="text-white">Service providers (processors)</strong> that act only on our
                  instructions: Supabase (database and storage, all categories), Vercel (hosting and AI routing),
                  and, only if you allow AI processing, Anthropic and Google (Gemini) for the content described in
                  section 4 of our Privacy Policy (meal photos, voice transcripts, body composition photos,
                  workouts, weight, body measurements and food logs).
                </li>
                <li>
                  <strong className="text-white">FitCircle members you choose to share with:</strong> check-ins,
                  streaks and challenge progress are visible to members of the FitCircles you join. Meals you log
                  are private by default and are shared only if you choose to share them.
                </li>
                <li>
                  <strong className="text-white">Apple Health or Health Connect</strong>, if you turn on
                  write-back: the meals, weight and body measurements you log.
                </li>
              </ul>
              <p className="text-slate-300 leading-relaxed mt-4">
                We do not share consumer health data with advertising, analytics or ad-measurement partners
                (Amplitude, Google AdMob and Firebase, Meta, Apple Search Ads). We do not sell consumer health data.
              </p>
            </section>

            <section>
              <h2 className={h2}>6. Your Rights and How to Exercise Them</h2>
              <ul className={list}>
                <li>
                  <strong className="text-white">Confirm and access:</strong> learn whether we collect, share or
                  sell your consumer health data, get a list of the third parties and affiliates we shared it
                  with, and get a copy of it. Use Export Data in the apps or on the website (free, includes photos),
                  or email {mail}.
                </li>
                <li>
                  <strong className="text-white">Delete:</strong> delete your account in the apps or on the
                  website (see <Link href="/privacy/delete-account" className="text-cyan-400 hover:underline">how to delete your account</Link>),
                  or email us. We delete your data from our systems and backups and instruct our processors to
                  delete it too.
                </li>
                <li>
                  <strong className="text-white">Withdraw consent:</strong> in Settings → Privacy (health data and
                  AI), in Settings → AI Data Sharing in the apps, or by disconnecting Apple Health or Health Connect
                  in your device settings.
                </li>
              </ul>
              <p className="text-slate-300 leading-relaxed mt-4">
                We respond within 45 days. We may extend that by another 45 days when reasonably necessary, and we
                will tell you if we do. We may need to verify your identity, usually by asking you to write from
                your account email address. We will not treat you differently for exercising these rights.
              </p>

              <h3 className="text-xl font-semibold text-white mb-3 mt-6">Appeals</h3>
              <p className="text-slate-300 leading-relaxed">
                If we decline your request, you can appeal by emailing {mail} with the subject &quot;Health data
                appeal&quot; within a reasonable time after our decision. We will respond in writing within 45 days
                and explain our reasons. If your appeal is denied, you can contact the Washington State Attorney
                General (atg.wa.gov) or the Nevada Attorney General (ag.nv.gov).
              </p>
            </section>

            <section>
              <h2 className={h2}>7. Contact</h2>
              <p className="text-slate-300 leading-relaxed">
                Inov8r Labs Inc. (BC1310005), 485 - 6400 Roberts Street, Burnaby, British Columbia V5G 4C9, Canada
                <br />
                Email: {mail}
              </p>
              <p className="text-slate-300 leading-relaxed mt-4">
                See also our <Link href="/privacy" className="text-cyan-400 hover:underline">Privacy Policy</Link> and{' '}
                <Link href="/privacy-choices" className="text-cyan-400 hover:underline">Your Privacy Choices</Link>.
              </p>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
