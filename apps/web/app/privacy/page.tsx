import { Shield, ArrowLeft } from 'lucide-react';
import { type Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Privacy Policy | FitCircle',
  description: 'FitCircle Privacy Policy - How we collect, use, and protect your data',
};

// Update this date whenever the policy text changes. It must never be computed
// at render time: a policy that always shows today's date is misleading.
const LAST_UPDATED = 'September 29, 2026';
const POLICY_VERSION = '1.1';

function ThirdParty({
  name,
  purpose,
  href,
  children,
}: {
  name: string;
  purpose: string;
  href: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-slate-800/50 p-4 rounded-lg">
      <h4 className="text-lg font-semibold text-white mb-2">
        {name} <span className="text-slate-400 font-normal">({purpose})</span>
      </h4>
      <p className="text-slate-300 text-sm">{children}</p>
      <a href={href} className="text-cyan-400 text-sm hover:underline" target="_blank" rel="noopener">
        {name} Privacy Policy →
      </a>
    </div>
  );
}

export default function PrivacyPolicyPage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950">
      <div className="max-w-4xl mx-auto p-6 py-12">
        {/* Back Button */}
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-cyan-400 hover:text-cyan-300 mb-8 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to FitCircle
        </Link>

        {/* Header */}
        <div className="mb-12">
          <h1 className="text-5xl font-bold text-white mb-4 flex items-center gap-4">
            <Shield className="h-12 w-12 text-purple-400" />
            Privacy Policy
          </h1>
          <p className="text-slate-400 text-lg">Last Updated: {LAST_UPDATED}</p>
          <p className="text-slate-400 text-sm mt-2">Version {POLICY_VERSION}</p>
        </div>

        {/* Content */}
        <div className="prose prose-invert prose-slate max-w-none">
          <div className="bg-slate-900/50 border border-slate-700 rounded-xl p-8 space-y-8">

            <section>
              <h2 className="text-2xl font-bold text-white mb-4">1. Introduction</h2>
              <p className="text-slate-300 leading-relaxed">
                Welcome to FitCircle. We respect your privacy and are committed to protecting your personal data.
                This privacy policy explains how we collect, use, store, share, and protect your information when
                you use the FitCircle website and the FitCircle mobile apps for iOS and Android (together, the
                &quot;Service&quot;).
              </p>
              <p className="text-slate-300 leading-relaxed mt-4">
                <strong className="text-white">Data Controller:</strong> FitCircle Inc.
                <br />
                <strong className="text-white">Contact:</strong> privacy@fitcircle.ai
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-bold text-white mb-4">2. Data We Collect</h2>

              <h3 className="text-xl font-semibold text-white mb-3">2.1 Account Information</h3>
              <ul className="text-slate-300 space-y-2 list-disc list-inside">
                <li>Email address (required for account creation)</li>
                <li>Display name, username, and optional profile details (bio, photo, gender, height)</li>
                <li>
                  If you sign in with Apple or Google: the identifier, name, and email address that the provider
                  shares with us. With Sign in with Apple you may choose to hide your email address.
                </li>
                <li>Account preferences (unit system, timezone, notification settings)</li>
              </ul>

              <h3 className="text-xl font-semibold text-white mb-3 mt-6">2.2 Health and Fitness Data</h3>
              <p className="text-slate-300 mb-2">Depending on what you choose to log or connect, we collect:</p>
              <ul className="text-slate-300 space-y-2 list-disc list-inside">
                <li>Weight, body measurements, and body composition values</li>
                <li>Step counts, workouts, and other physical activity data</li>
                <li>Food, water, and supplement logs, including calories and macronutrients</li>
                <li>Mood and energy level ratings</li>
                <li>Goals, streaks, and challenge participation and progress</li>
              </ul>

              <h3 className="text-xl font-semibold text-white mb-3 mt-6">2.3 Apple Health and Health Connect</h3>
              <p className="text-slate-300 leading-relaxed">
                If you give permission, the iOS app reads steps, workouts, weight, and body measurements from
                Apple Health, and can write the meals, weight, and body measurements you log in FitCircle back to
                Apple Health. The Android app can read similar data from Health Connect. Connecting is optional and you
                can withdraw permission at any time in your device settings. Data obtained from Apple Health or
                Health Connect is used only to provide FitCircle&apos;s health and fitness features.{' '}
                <strong className="text-white">
                  It is never used for advertising or marketing, never sold, and never shared with data brokers.
                </strong>
              </p>

              <h3 className="text-xl font-semibold text-white mb-3 mt-6">2.4 Photos, Voice, and Messages</h3>
              <ul className="text-slate-300 space-y-2 list-disc list-inside">
                <li>Photos you take or choose: meal photos, body composition reports, and chat photos</li>
                <li>
                  Voice logging: your speech is transcribed on your device or by your device&apos;s speech service
                  (Apple on iOS). We receive the resulting text, not the audio recording.
                </li>
                <li>Messages and reactions you post in FitCircle chats</li>
                <li>Messages you send to the Fitzy assistant</li>
              </ul>

              <h3 className="text-xl font-semibold text-white mb-3 mt-6">2.5 Technical and Usage Data</h3>
              <ul className="text-slate-300 space-y-2 list-disc list-inside">
                <li>IP address (for security, rate limiting, and approximate location in analytics)</li>
                <li>Device and app information (model, operating system, app version, language)</li>
                <li>Device identifiers, including a push notification token if you allow notifications</li>
                <li>
                  The advertising identifier of your device, only if you allow tracking when the app asks
                  (see section 5)
                </li>
                <li>Usage data (screens viewed, features used) and crash and performance diagnostics</li>
                <li>On the website: browser type and cookie identifiers</li>
                <li>Purchase history for FitCircle Pro (we never receive your card details)</li>
              </ul>
            </section>

            <section>
              <h2 className="text-2xl font-bold text-white mb-4">3. How We Use Your Data</h2>

              <h3 className="text-xl font-semibold text-white mb-3">3.1 Providing the Service</h3>
              <ul className="text-slate-300 space-y-2 list-disc list-inside">
                <li>Provide logging, tracking, streaks, trends, and insights</li>
                <li>Manage your account and authentication</li>
                <li>Enable FitCircles, chat, challenges, and leaderboards</li>
                <li>Estimate nutrition from photos and voice, and answer your questions to Fitzy</li>
                <li>Send notifications you have enabled and essential service communications</li>
                <li>Process purchases and provide FitCircle Pro features</li>
                <li>Keep the Service safe: prevent abuse, review reports, and enforce our Terms</li>
              </ul>

              <h3 className="text-xl font-semibold text-white mb-3 mt-6">3.2 Analytics and Diagnostics</h3>
              <p className="text-slate-300 mb-2">We use usage analytics and crash reports to:</p>
              <ul className="text-slate-300 space-y-2 list-disc list-inside">
                <li>Understand how people use FitCircle</li>
                <li>Improve features and user experience</li>
                <li>Identify and fix bugs and crashes</li>
              </ul>
              <p className="text-slate-400 text-sm mt-4 italic">
                On the website, analytics cookies and session replay are used only with your consent, which you
                can withdraw at any time in your{' '}
                <Link href="/settings/privacy" className="text-cyan-400 hover:underline">Privacy Settings</Link>.
                In the mobile apps, analytics record which features are used, not the health values you log.
              </p>

              <h3 className="text-xl font-semibold text-white mb-3 mt-6">3.3 Advertising</h3>
              <p className="text-slate-300 leading-relaxed">
                The free version of the mobile apps shows ads. FitCircle Pro removes them. See section 5 for
                what is and is not used for advertising.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-bold text-white mb-4">4. Artificial Intelligence Features</h2>
              <p className="text-slate-300 leading-relaxed">
                Some features use artificial intelligence models operated by third parties. When you use these
                features, and only after you have given permission in the app, we send the following to AI
                models provided by <strong className="text-white">Anthropic</strong> and{' '}
                <strong className="text-white">Google</strong>, through Vercel&apos;s AI Gateway:
              </p>
              <ul className="text-slate-300 space-y-2 list-disc list-inside mt-4">
                <li>Meal photos, and any note you add, to estimate calories and macronutrients</li>
                <li>The text of your voice log, to turn it into a food entry</li>
                <li>Photos of body composition reports, to read the values from them</li>
                <li>
                  Your messages to Fitzy, together with a summary of your recent workouts, weight trend, and
                  body measurements, so that Fitzy can answer questions about your own logs
                </li>
              </ul>
              <p className="text-slate-300 leading-relaxed mt-4">
                We do not include your name or email address in these requests. A random account identifier
                is attached so that we can apply usage limits and prevent abuse. You can withdraw permission at
                any time in the app under Settings → AI Data Sharing. Without it you can still log everything
                by hand. Results produced by AI are estimates and are not medical or dietary advice.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-bold text-white mb-4">5. Advertising and Tracking</h2>
              <p className="text-slate-300 leading-relaxed">
                Ads in the free version of the mobile apps are served by Google AdMob.
              </p>
              <ul className="text-slate-300 space-y-2 list-disc list-inside mt-4">
                <li>
                  On iOS, the app asks for your permission before tracking (the App Tracking Transparency
                  prompt). If you allow it, Google may use your device&apos;s advertising identifier to show more
                  relevant ads and measure their performance. If you do not allow it, you still see ads, but
                  they are not personalized using that identifier.
                </li>
                <li>
                  You can change this choice at any time in your device settings (on iOS: Settings → Privacy
                  &amp; Security → Tracking).
                </li>
                <li>
                  Where required by law, the app asks for your advertising consent choices through
                  Google&apos;s consent form before any ad is requested.
                </li>
                <li>
                  <strong className="text-white">
                    We never use or share your health and fitness data, food logs, photos, or messages for
                    advertising.
                  </strong>{' '}
                  We do not sell your personal information.
                </li>
              </ul>
            </section>

            <section>
              <h2 className="text-2xl font-bold text-white mb-4">6. Who We Share Data With</h2>
              <p className="text-slate-300 mb-4">
                We share data only with the service providers below, each for the purpose stated, and with
                other users as described in section 7.
              </p>

              <div className="space-y-4">
                <ThirdParty name="Supabase" purpose="database, authentication, file storage" href="https://supabase.com/privacy">
                  Stores your account, logs, photos, and messages.
                </ThirdParty>
                <ThirdParty name="Vercel" purpose="hosting and AI gateway" href="https://vercel.com/legal/privacy-policy">
                  Hosts our application and routes AI requests. May process request logs (IP addresses, user agents).
                </ThirdParty>
                <ThirdParty name="Anthropic" purpose="AI models" href="https://www.anthropic.com/legal/privacy">
                  Processes the content described in section 4 to produce nutrition estimates and Fitzy replies.
                </ThirdParty>
                <ThirdParty name="Google" purpose="AI models, ads, sign-in, push notifications" href="https://policies.google.com/privacy">
                  Gemini models process the content described in section 4. AdMob serves ads in the free mobile
                  apps (section 5). Google Sign-In authenticates you if you choose it. Firebase Cloud Messaging
                  delivers push notifications.
                </ThirdParty>
                <ThirdParty name="Apple" purpose="sign-in, purchases, push notifications, speech" href="https://www.apple.com/legal/privacy/">
                  Sign in with Apple authenticates you if you choose it. App Store purchases are processed by
                  Apple. Apple delivers push notifications on iOS and transcribes speech for voice logging.
                </ThirdParty>
                <ThirdParty name="RevenueCat" purpose="subscription management" href="https://www.revenuecat.com/privacy">
                  Validates FitCircle Pro purchases and keeps your subscription status in sync. Receives an
                  account identifier and purchase records, not payment card details.
                </ThirdParty>
                <ThirdParty name="Stripe" purpose="payments on the website" href="https://stripe.com/privacy">
                  Processes purchases made on our website. We never receive your full card details.
                </ThirdParty>
                <ThirdParty name="Amplitude" purpose="analytics" href="https://amplitude.com/privacy">
                  Records which features are used so we can improve the Service. On the website it is active
                  only if you consent to analytics cookies.
                </ThirdParty>
                <ThirdParty name="Sentry" purpose="crash and error reporting" href="https://sentry.io/privacy/">
                  Receives crash reports and performance diagnostics so we can fix problems.
                </ThirdParty>
              </div>

              <p className="text-slate-300 leading-relaxed mt-6">
                We may also disclose information when required by law, or to protect the rights and safety of
                our users and the Service.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-bold text-white mb-4">7. What Other Users Can See</h2>
              <p className="text-slate-300 leading-relaxed">
                FitCircle is a social service. Members of the FitCircles you join can see your display name,
                username, profile photo, check-ins, streak, challenge progress, and the chat messages you post.
                Meals you log are shared with your FitCircles by default, and you can change what each FitCircle
                sees, or keep meals private, from the sharing controls in the app. People outside your FitCircles
                cannot see your logs.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-bold text-white mb-4">8. Cookie Policy (Website)</h2>

              <h3 className="text-xl font-semibold text-white mb-3">8.1 Essential Cookies (No Consent Required)</h3>
              <ul className="text-slate-300 space-y-2 list-disc list-inside">
                <li><code className="text-cyan-400">sb-access-token</code> - Supabase authentication (session management)</li>
                <li><code className="text-cyan-400">sb-refresh-token</code> - Supabase authentication (persistent login)</li>
                <li><code className="text-cyan-400">fc_consent</code> - Stores your cookie preferences</li>
              </ul>

              <h3 className="text-xl font-semibold text-white mb-3 mt-6">8.2 Analytics Cookies (Consent Required)</h3>
              <ul className="text-slate-300 space-y-2 list-disc list-inside">
                <li><code className="text-cyan-400">amplitude_*</code> - Amplitude tracking (usage analytics, session replay)</li>
              </ul>

              <p className="text-slate-400 text-sm mt-4">
                You can manage cookie preferences at any time in your <Link href="/settings/privacy" className="text-cyan-400 hover:underline">Privacy Settings</Link>.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-bold text-white mb-4">9. Your Choices and Rights</h2>

              <h3 className="text-xl font-semibold text-white mb-3">9.1 In the Mobile Apps</h3>
              <ul className="text-slate-300 space-y-2 list-disc list-inside">
                <li>
                  <strong className="text-white">Delete your account:</strong> Profile → Settings → Delete
                  Account. This permanently deletes your account and the data associated with it.
                </li>
                <li><strong className="text-white">Export your data:</strong> Profile → Settings → Export Data</li>
                <li><strong className="text-white">AI data sharing:</strong> Profile → Settings → AI Data Sharing</li>
                <li><strong className="text-white">Block or report a user:</strong> from any chat message or profile</li>
                <li><strong className="text-white">Health, camera, microphone, notifications, tracking:</strong> your device settings</li>
              </ul>

              <h3 className="text-xl font-semibold text-white mb-3 mt-6">9.2 GDPR Rights (EU/EEA Residents)</h3>
              <ul className="text-slate-300 space-y-2 list-disc list-inside">
                <li><strong className="text-white">Right to Access:</strong> Request a copy of your data</li>
                <li><strong className="text-white">Right to Rectification:</strong> Correct inaccurate data</li>
                <li><strong className="text-white">Right to Erasure:</strong> Delete your account and data</li>
                <li><strong className="text-white">Right to Data Portability:</strong> Export your data in JSON format</li>
                <li><strong className="text-white">Right to Object:</strong> Opt-out of analytics and processing</li>
                <li><strong className="text-white">Right to Restrict Processing:</strong> Limit how we use your data</li>
                <li><strong className="text-white">Right to Withdraw Consent:</strong> Change your consent choices at any time</li>
              </ul>

              <h3 className="text-xl font-semibold text-white mb-3 mt-6">9.3 CCPA Rights (California Residents)</h3>
              <ul className="text-slate-300 space-y-2 list-disc list-inside">
                <li><strong className="text-white">Right to Know:</strong> What personal information we collect</li>
                <li><strong className="text-white">Right to Delete:</strong> Request deletion of your data</li>
                <li><strong className="text-white">Right to Opt-Out:</strong> Do not sell or share my personal information</li>
                <li><strong className="text-white">Right to Non-Discrimination:</strong> Equal service regardless of privacy choices</li>
              </ul>

              <div className="bg-purple-500/10 border border-purple-500/30 rounded-lg p-4 mt-6">
                <p className="text-white font-semibold mb-2">Exercise Your Rights:</p>
                <p className="text-slate-300 text-sm mb-3">
                  Use the in-app settings above, go to{' '}
                  <Link href="/settings/privacy" className="text-cyan-400 hover:underline">Privacy Settings</Link>{' '}
                  on the website, or email{' '}
                  <a href="mailto:privacy@fitcircle.ai" className="text-cyan-400 hover:underline">privacy@fitcircle.ai</a>{' '}
                  to:
                </p>
                <ul className="text-slate-300 text-sm space-y-1 list-disc list-inside">
                  <li>Download your data (JSON export)</li>
                  <li>Delete your account</li>
                  <li>Manage cookie preferences</li>
                  <li>Opt-out of data sharing (CCPA)</li>
                </ul>
              </div>
            </section>

            <section>
              <h2 className="text-2xl font-bold text-white mb-4">10. Data Retention</h2>
              <ul className="text-slate-300 space-y-2 list-disc list-inside">
                <li><strong className="text-white">Active Account Data:</strong> Retained while your account is active</li>
                <li><strong className="text-white">Deleted Account Data:</strong> Erased within 30 days of deletion request</li>
                <li><strong className="text-white">Consent Records:</strong> Retained for 5 years (compliance requirement)</li>
                <li><strong className="text-white">Aggregate Analytics:</strong> Anonymized data may be retained indefinitely</li>
              </ul>
              <p className="text-slate-300 leading-relaxed mt-4">
                Deleting your account does not cancel a subscription bought through the App Store or Google
                Play. Subscriptions are managed in your store account settings.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-bold text-white mb-4">11. Data Security</h2>
              <p className="text-slate-300 leading-relaxed">
                We implement industry-standard security measures to protect your data:
              </p>
              <ul className="text-slate-300 space-y-2 list-disc list-inside mt-4">
                <li>Encryption for data in transit (HTTPS/TLS)</li>
                <li>Encryption at rest for stored data</li>
                <li>Row-level security (RLS) policies in database</li>
                <li>Regular security updates</li>
                <li>Limited employee access to personal data</li>
              </ul>
            </section>

            <section>
              <h2 className="text-2xl font-bold text-white mb-4">12. International Data Transfers</h2>
              <p className="text-slate-300 leading-relaxed">
                FitCircle is hosted in the United States. If you are accessing from the EU/EEA, your data will be transferred
                to the US. We rely on:
              </p>
              <ul className="text-slate-300 space-y-2 list-disc list-inside mt-4">
                <li>EU-US Data Privacy Framework, where our providers are certified</li>
                <li>Standard Contractual Clauses (SCCs) where applicable</li>
                <li>Your explicit consent for health data processing</li>
              </ul>
            </section>

            <section>
              <h2 className="text-2xl font-bold text-white mb-4">13. Children&apos;s Privacy</h2>
              <p className="text-slate-300 leading-relaxed">
                FitCircle is not intended for users under 18 years of age. We do not knowingly collect data from children.
                If we discover that we have collected data from a child, we will delete it immediately.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-bold text-white mb-4">14. Changes to This Policy</h2>
              <p className="text-slate-300 leading-relaxed">
                We may update this privacy policy from time to time. Material changes will require re-consent.
                You will be notified via:
              </p>
              <ul className="text-slate-300 space-y-2 list-disc list-inside mt-4">
                <li>Email notification (for significant changes)</li>
                <li>Cookie consent banner (for cookie-related changes)</li>
                <li>In-app notification</li>
              </ul>
            </section>

            <section>
              <h2 className="text-2xl font-bold text-white mb-4">15. Contact Us</h2>
              <p className="text-slate-300 leading-relaxed mb-4">
                For privacy-related questions or to exercise your rights, contact us:
              </p>
              <div className="bg-slate-800/50 p-4 rounded-lg">
                <p className="text-white"><strong>Email:</strong> <a href="mailto:privacy@fitcircle.ai" className="text-cyan-400 hover:underline">privacy@fitcircle.ai</a></p>
                <p className="text-white mt-2"><strong>Response Time:</strong> Within 30 days (GDPR) or 45 days (CCPA)</p>
              </div>

              <p className="text-slate-400 text-sm mt-6 italic">
                You also have the right to lodge a complaint with your local data protection authority.
              </p>
            </section>

            <section className="border-t border-slate-700 pt-8">
              <h2 className="text-2xl font-bold text-white mb-4">16. Consent Withdrawal</h2>
              <p className="text-slate-300 leading-relaxed">
                You can withdraw any consent you have given at any time without affecting the lawfulness of
                processing based on consent before its withdrawal. Use the in-app settings described in section
                9.1, or visit <Link href="/settings/privacy" className="text-cyan-400 hover:underline">Privacy Settings</Link> on
                the website.
              </p>
            </section>

          </div>
        </div>

        {/* Footer CTA */}
        <div className="mt-12 p-6 bg-purple-500/10 border border-purple-500/30 rounded-xl">
          <h3 className="text-xl font-bold text-white mb-3">Need to Exercise Your Rights?</h3>
          <p className="text-slate-300 mb-4">
            Download your data, delete your account, or manage cookie preferences.
          </p>
          <Link
            href="/settings/privacy"
            className="inline-flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-purple-500 to-indigo-500 hover:from-purple-600 hover:to-indigo-600 text-white font-semibold rounded-lg transition-all"
          >
            <Shield className="h-5 w-5" />
            Go to Privacy Settings
          </Link>
        </div>
      </div>
    </div>
  );
}
