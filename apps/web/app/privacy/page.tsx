import { Shield, ArrowLeft } from 'lucide-react';
import { type Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Privacy Policy | FitCircle',
  description: 'FitCircle Privacy Policy - How we collect, use, and protect your data',
  alternates: { languages: { 'fr-CA': '/fr/privacy' } },
};

// Update this date whenever the policy text changes. It must never be computed
// at render time: a policy that always shows today's date is misleading.
const LAST_UPDATED = 'November 6, 2026';
const POLICY_VERSION = '1.3';


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

function Table({ head, rows }: { head: string[]; rows: React.ReactNode[][] }) {
  return (
    <div className="overflow-x-auto mt-4">
      <table className="w-full text-sm text-left text-slate-300 border border-slate-700">
        <thead className="bg-slate-800/70 text-white">
          <tr>
            {head.map((h) => (
              <th key={h} className="p-3 font-semibold border-b border-slate-700">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-b border-slate-800 align-top">
              {row.map((cell, j) => (
                <td key={j} className="p-3">{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const mail = (
  <a href="mailto:privacy@fitcircle.ai" className="text-cyan-400 hover:underline">privacy@fitcircle.ai</a>
);

export default function PrivacyPolicyPage() {
  return (
    <div className="min-h-screen bg-canvas bg-hero-glow">
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
          <p className="text-slate-400 text-sm mt-2">
            <Link href="/fr/privacy" className="text-cyan-400 hover:underline" lang="fr">
              Version française
            </Link>
            {' · '}
            <Link href="/consumer-health-privacy" className="text-cyan-400 hover:underline">
              Consumer Health Data Privacy Policy
            </Link>
            {' · '}
            <Link href="/privacy-choices" className="text-cyan-400 hover:underline">
              Your Privacy Choices
            </Link>
          </p>
        </div>

        {/* Content */}
        <div className="prose prose-invert prose-slate max-w-none">
          <div className="bg-slate-900/50 border border-slate-700 rounded-xl p-8 space-y-8">

            <section>
              <h2 className="text-2xl font-bold text-white mb-4">1. Introduction and Who We Are</h2>
              <p className="text-slate-300 leading-relaxed">
                This privacy policy explains how we collect, use, store, share, and protect your information when
                you use the FitCircle website and the FitCircle mobile apps for iOS and Android (together, the
                &quot;Service&quot;).
              </p>
              <p className="text-slate-300 leading-relaxed mt-4">
                <strong className="text-white">Controller:</strong> Inov8r Labs Inc. (&quot;FitCircle&quot;,
                &quot;we&quot;, &quot;us&quot;), a British Columbia corporation (BC Corporation No. BC1310005) with its
                registered office at 485 - 6400 Roberts Street, Burnaby, British Columbia V5G 4C9, Canada, is the controller of your
                personal data (the organization responsible for it under Canadian privacy law).
                <br />
                <strong className="text-white">Contact:</strong> {mail}
              </p>
              <p className="text-slate-300 leading-relaxed mt-4">
                <strong className="text-white">Where the Service is offered.</strong> The mobile apps and the
                website are offered in the United States, Canada, India and Singapore. The
                website does not accept new sign-ups from the European Union or the European Economic Area; existing
                users there can still sign in, export their data and delete their account.
              </p>
              <p className="text-slate-300 leading-relaxed mt-4">
                <strong className="text-white">Minimum age.</strong> You must be 18 or older to use FitCircle. We
                check your age at sign-up (see section 14).
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-bold text-white mb-4">2. Data We Collect</h2>

              <h3 className="text-xl font-semibold text-white mb-3">2.1 Account Information</h3>
              <ul className="text-slate-300 space-y-2 list-disc list-inside">
                <li>Email address (required for account creation)</li>
                <li>Display name, username, and optional profile details (bio, photo, gender, height)</li>
                <li>Year or date of birth (to confirm you are 18 or older)</li>
                <li>
                  If you sign in with Apple or Google: the identifier, name, and email address that the provider
                  shares with us. With Sign in with Apple you may choose to hide your email address.
                </li>
                <li>Account preferences (unit system, timezone, notification settings)</li>
                <li>Your consent choices (health data, AI, analytics, marketing email) and when you made them</li>
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
              <p className="text-slate-300 leading-relaxed mt-4">
                Before the app or website asks you for any health data, we ask for your explicit, separate consent
                to process it, and we record that consent on our server. You can withdraw it at any time in
                Settings → Privacy (see section 10). Residents of Washington and Nevada should also read our{' '}
                <Link href="/consumer-health-privacy" className="text-cyan-400 hover:underline">
                  Consumer Health Data Privacy Policy
                </Link>.
              </p>

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
                  Voice logging: speech is transcribed using your device&apos;s speech recognition service
                  (Apple on iOS; the configured speech provider on Android). Depending on your device and
                  provider, audio may be processed on the device or sent to that provider&apos;s servers.
                  FitCircle receives the resulting transcript, not the audio recording. You can type a meal
                  instead of using voice logging.
                </li>
                <li>Messages and reactions you post in FitCircle chats</li>
                <li>Messages you send to the Fitzy assistant</li>
                <li>
                  <strong className="text-white">Fitzy memory:</strong> short facts you share with Fitzy (for
                  example a food you avoid or a goal you mention) that Fitzy keeps so it does not have to ask
                  again. You can view and delete these facts in Fitzy settings.
                </li>
              </ul>

              <h3 className="text-xl font-semibold text-white mb-3 mt-6">2.5 Technical and Usage Data</h3>
              <ul className="text-slate-300 space-y-2 list-disc list-inside">
                <li>IP address (for security, rate limiting, consent records, and approximate location in analytics)</li>
                <li>Device and app information (model, operating system, app version, language)</li>
                <li>Device identifiers, including a push notification token if you allow notifications</li>
                <li>
                  Advertising identifiers and other device identifiers used by our advertising providers,
                  subject to your device settings and applicable consent choices (see section 6)
                </li>
                <li>Usage data (screens viewed, features used) and crash and performance diagnostics</li>
                <li>On the website: browser type and cookie identifiers</li>
                <li>Purchase history for FitCircle Pro (we never receive your card details)</li>
              </ul>
            </section>

            <section>
              <h2 className="text-2xl font-bold text-white mb-4">3. How We Use Your Data and Our Lawful Bases</h2>
              <p className="text-slate-300 leading-relaxed">
                The table below lists each purpose, the data used and the legal basis we rely on. Article
                references are to the GDPR; where the GDPR does not apply to you, read the last column as a plain
                description of why we use each kind of data.
              </p>
              <Table
                head={['Purpose', 'Data used', 'Legal basis']}
                rows={[
                  [
                    'Providing the Service: your account, logging, streaks, trends, FitCircles, chat, challenges, notifications you enable, essential service emails',
                    'Account, usage, messages, photos',
                    'Performance of our contract with you (Art. 6(1)(b))',
                  ],
                  [
                    'Processing your health and fitness data to show your progress and circle stats',
                    'Health and fitness data (section 2.2, 2.3)',
                    'Your explicit consent (Art. 9(2)(a)), given separately and recorded on our server',
                  ],
                  [
                    'AI features: nutrition estimates from photos and voice, body composition scans, Fitzy replies and daily focus, AI accuracy measurement',
                    'See section 4',
                    'Your consent (Art. 6(1)(a) and, for health data, Art. 9(2)(a))',
                  ],
                  [
                    'Ads in the free mobile apps and measuring our own ad campaigns',
                    'Advertising and device identifiers, limited in-app events (section 6)',
                    'Your consent where required by law; legitimate interests with a right to opt out elsewhere',
                  ],
                  [
                    'Product analytics and diagnostics (understanding which features are used, fixing crashes)',
                    'Usage and device data; never health values',
                    'Legitimate interests (Art. 6(1)(f)); consent on the website (cookies)',
                  ],
                  [
                    'Security, abuse and fraud prevention, enforcing our Terms, reviewing reports',
                    'Account, IP address, device data, reported content',
                    'Legitimate interests in keeping the Service and its users safe',
                  ],
                  [
                    'Keeping purchase and tax records',
                    'Purchase history',
                    'Legal obligation (Art. 6(1)(c))',
                  ],
                  [
                    'Marketing emails (tips, updates, offers)',
                    'Email address, name',
                    'Your consent, or for existing customers the soft opt-in where the law allows it. Every marketing email has an unsubscribe link.',
                  ],
                  [
                    'Keeping proof of your consent choices',
                    'Consent records (type, version, time, IP address, platform)',
                    'Legal obligation and legitimate interests in demonstrating compliance',
                  ],
                ]}
              />
              <p className="text-slate-400 text-sm mt-4 italic">
                On the website, analytics cookies and session replay are used only with your consent, which you
                can withdraw at any time in your{' '}
                <Link href="/settings/privacy" className="text-cyan-400 hover:underline">Privacy Settings</Link>.
                In the mobile apps, analytics record which features are used, not the health values you log.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-bold text-white mb-4">4. Artificial Intelligence Features</h2>
              <p className="text-slate-300 leading-relaxed">
                Some features use artificial intelligence models operated by third parties.{' '}
                <strong className="text-white">
                  We send data to AI providers only after you have allowed AI processing in the app or on the
                  website. Your choice is recorded on our server, and our server checks it before every AI request.
                </strong>{' '}
                When you have allowed it, we send the following to AI models provided by{' '}
                <strong className="text-white">Anthropic</strong> and{' '}
                <strong className="text-white">Google</strong> (Gemini), through Vercel&apos;s AI Gateway:
              </p>
              <ul className="text-slate-300 space-y-2 list-disc list-inside mt-4">
                <li>Meal photos, and any note you add, to estimate calories and macronutrients</li>
                <li>The text of your voice log, to turn it into a food entry</li>
                <li>Photos of body composition reports, to read the values from them</li>
                <li>
                  Your messages to Fitzy, together with a summary of your recent workouts, weight trend, body
                  measurements, food logs and your Fitzy memory, so that Fitzy can answer questions about your
                  own logs and suggest a daily focus
                </li>
              </ul>
              <p className="text-slate-300 leading-relaxed mt-4">
                We do not include your name or email address in these requests. A random account identifier
                is attached so that we can apply usage limits and prevent abuse.
              </p>
              <p className="text-slate-300 leading-relaxed mt-4">
                <strong className="text-white">AI accuracy measurement.</strong> We keep the AI&apos;s estimate and
                any corrections you make to measure and improve accuracy, while your account is active. Photos are not kept for
                this. This only happens if you have allowed AI processing.
              </p>
              <p className="text-slate-300 leading-relaxed mt-4">
                <strong className="text-white">Provider retention.</strong> Every AI request goes through the Vercel
                AI Gateway with zero data retention turned on: it is only routed to provider endpoints that do not
                keep your content or use it to train their models. Google models run on Google Cloud Vertex AI.
              </p>
              <p className="text-slate-300 leading-relaxed mt-4">
                You can withdraw permission at any time in Settings → Privacy (website) or Settings → AI Data
                Sharing (apps). Without it you can still log everything by hand. Results produced by AI are
                estimates and are not medical or dietary advice.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-bold text-white mb-4">5. What Other Users Can See</h2>
              <p className="text-slate-300 leading-relaxed">
                FitCircle is a social service. Members of the FitCircles you join can see your display name,
                username, profile photo, check-ins, streak, challenge progress, and the chat messages you post.
                Meals you log are private by default. You can choose to share a meal, or turn on &quot;Share new
                meals with my circles&quot;, and change what each FitCircle sees, from the sharing controls in the
                app. People outside your FitCircles cannot see your logs.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-bold text-white mb-4">6. Advertising and Tracking</h2>
              <p className="text-slate-300 leading-relaxed">
                Ads in the free version of the mobile apps are served by Google AdMob. FitCircle Pro removes them.
                The website shows no ads and loads no advertising pixels.
              </p>
              <ul className="text-slate-300 space-y-2 list-disc list-inside mt-4">
                <li>
                  On iOS, the app asks for your permission before tracking (the App Tracking Transparency
                  prompt). If you allow it, Google may use your device&apos;s advertising identifier to show more
                  relevant ads and measure their performance. If you do not allow it, you still see ads, but
                  they are not personalized using that identifier. You can change this at any time in Settings →
                  Privacy &amp; Security → Tracking.
                </li>
                <li>
                  On Android, AdMob may collect and share advertising and other device identifiers, IP
                  addresses (which can indicate approximate location), ad and app interactions, and
                  diagnostic information to serve ads, measure performance, and prevent fraud. You can reset or
                  delete your advertising ID in Android settings and revisit consent choices under Privacy &amp;
                  Ad Choices in FitCircle.
                </li>
                <li>
                  Wherever the law requires it, the app asks for your advertising
                  consent through Google&apos;s consent form before any ad is requested.
                </li>
                <li>
                  <strong className="text-white">Measuring our own ads.</strong> When we advertise FitCircle
                  on other services, we use software from Google (Firebase Analytics and Google Ads), Apple Search
                  Ads and, on iOS only, Meta (Facebook and Instagram) to learn which ads lead to installs and
                  subscriptions. These partners may receive your device&apos;s advertising identifier, device and
                  app information, your IP address, and a small set of in-app events: opening the app, completing
                  sign-up, becoming an active member, joining or creating a FitCircle, starting a free trial, and
                  purchases (product, price and currency). They may combine it with information they hold about you
                  under their own privacy policies.
                </li>
                <li>
                  Meta measurement runs only on iOS, only if you allow tracking in the App Tracking Transparency
                  prompt. Without that permission, partners receive only
                  aggregated, privacy-preserving measurement from Apple (SKAdNetwork).
                </li>
                <li>
                  <strong className="text-white">
                    We never use or share your health and fitness data, food logs, photos, or messages for
                    advertising.
                  </strong>{' '}
                  We do not sell your personal information. See{' '}
                  <Link href="/privacy-choices" className="text-cyan-400 hover:underline">Your Privacy Choices</Link>{' '}
                  for how to opt out of ad-measurement sharing.
                </li>
              </ul>
            </section>

            <section>
              <h2 className="text-2xl font-bold text-white mb-4">7. Who We Share Data With</h2>
              <p className="text-slate-300 mb-4">
                We share data only with the service providers below, each for the purpose stated and under a
                contract that limits their use of it, and with other users as described in section 5. We do not
                use OpenAI or PostHog.
              </p>

              <div className="space-y-4">
                <ThirdParty name="Supabase" purpose="database, authentication, file storage" href="https://supabase.com/privacy">
                  Stores your account, logs, photos, and messages on Amazon Web Services in us-east-2 (Ohio, United States).
                </ThirdParty>
                <ThirdParty name="Vercel" purpose="hosting and AI Gateway" href="https://vercel.com/legal/privacy-policy">
                  Hosts our application in the United States and routes AI requests to Anthropic and Google. May
                  process request logs (IP addresses, user agents).
                </ThirdParty>
                <ThirdParty name="Anthropic" purpose="AI models" href="https://www.anthropic.com/legal/privacy">
                  Processes the content described in section 4 to produce nutrition estimates and Fitzy replies,
                  only if you have allowed AI processing.
                </ThirdParty>
                <ThirdParty name="Google" purpose="AI models, ads, ad measurement, sign-in, purchases, push notifications, speech" href="https://policies.google.com/privacy">
                  Gemini models process the content described in section 4, only if you have allowed AI
                  processing. AdMob serves ads in the free mobile apps, and Firebase Analytics and Google Ads
                  measure our own ad campaigns (section 6). Google Sign-In authenticates you if you choose it.
                  Firebase Cloud Messaging delivers push notifications. Google Play processes Android purchases. If
                  Google is your configured Android speech provider, it also processes speech for voice logging.
                </ThirdParty>
                <ThirdParty name="Apple" purpose="sign-in, purchases, push notifications, speech, ad measurement" href="https://www.apple.com/legal/privacy/">
                  Sign in with Apple authenticates you if you choose it. App Store purchases are processed by
                  Apple. Apple delivers push notifications on iOS and transcribes speech for voice logging.
                  Apple Search Ads tells us which of our App Store ads led to an install (section 6).
                </ThirdParty>
                <ThirdParty name="Meta" purpose="ad measurement, iOS only" href="https://www.facebook.com/privacy/policy/">
                  Measures which of our Facebook and Instagram ads lead to installs and subscriptions, only on iOS,
                  only if you allow tracking. Never receives your health, food, or
                  fitness data.
                </ThirdParty>
                <ThirdParty name="RevenueCat" purpose="subscription management" href="https://www.revenuecat.com/privacy">
                  Validates FitCircle Pro purchases and keeps your subscription status in sync. Receives an
                  account identifier and purchase records, not payment card details.
                </ThirdParty>
                <ThirdParty name="Stripe" purpose="payments on the website" href="https://stripe.com/privacy">
                  Processes purchases made on our website. We never receive your full card details.
                </ThirdParty>
                <ThirdParty name="Amplitude" purpose="product analytics" href="https://amplitude.com/privacy">
                  Records which features are used so we can improve the Service. Never receives health values. On
                  the website it is active only if you consent to analytics cookies.
                </ThirdParty>
                <ThirdParty name="Sentry" purpose="crash and error reporting" href="https://sentry.io/privacy/">
                  Receives crash reports and performance diagnostics so we can fix problems. Error data expires
                  after 90 days.
                </ThirdParty>
                <ThirdParty name="Resend" purpose="email delivery" href="https://resend.com/legal/privacy-policy">
                  Delivers account, service and marketing emails. Receives your email address, name and the
                  content of the email.
                </ThirdParty>
              </div>

              <p className="text-slate-300 leading-relaxed mt-6">
                We may also disclose information when required by law, or to protect the rights and safety of
                our users and the Service. If FitCircle is involved in a merger or sale, your data may transfer to
                the new owner under this policy.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-bold text-white mb-4">8. International Data Transfers</h2>
              <p className="text-slate-300 leading-relaxed">
                We are based in Canada. Most of our service providers process data in the United States: our
                database is hosted by Supabase on Amazon Web Services in us-east-2 (Ohio), our application by Vercel,
                and our other providers (Anthropic, Google, Amplitude, Sentry, RevenueCat, Stripe and Resend) are
                listed in section 7. Your data is therefore transferred from Canada to, and stored in, the United
                States, where it may be accessible to courts and authorities under US law.
              </p>
              <ul className="text-slate-300 space-y-2 list-disc list-inside mt-4">
                <li>
                  <strong className="text-white">Canada and Quebec:</strong> we remain accountable for data we
                  transfer to providers outside Canada and protect it through written contracts. Before
                  transferring data outside Quebec we also assess the sensitivity of the data, the purpose, and the
                  protections in place.
                </li>
                <li>
                  <strong className="text-white">India and Singapore:</strong> we transfer data only to providers
                  bound by contracts that require a standard of protection comparable to local law.
                </li>
              </ul>
              <p className="text-slate-300 leading-relaxed mt-4">
                You can ask us for more information about these safeguards at {mail}.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-bold text-white mb-4">9. Cookie Policy (Website)</h2>

              <h3 className="text-xl font-semibold text-white mb-3">9.1 Essential Cookies (No Consent Required)</h3>
              <ul className="text-slate-300 space-y-2 list-disc list-inside">
                <li><code className="text-cyan-400">sb-access-token</code> - Supabase authentication (session management)</li>
                <li><code className="text-cyan-400">sb-refresh-token</code> - Supabase authentication (persistent login)</li>
                <li><code className="text-cyan-400">fc_consent</code> - Stores your cookie preferences</li>
              </ul>

              <h3 className="text-xl font-semibold text-white mb-3 mt-6">9.2 Analytics Cookies (Consent Required)</h3>
              <ul className="text-slate-300 space-y-2 list-disc list-inside">
                <li><code className="text-cyan-400">amplitude_*</code> - Amplitude tracking (usage analytics, session replay)</li>
              </ul>

              <p className="text-slate-400 text-sm mt-4">
                We honour the Global Privacy Control (GPC) signal. You can manage cookie preferences at any time in
                your <Link href="/settings/privacy" className="text-cyan-400 hover:underline">Privacy Settings</Link>.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-bold text-white mb-4">10. Your Choices and Rights</h2>

              <h3 className="text-xl font-semibold text-white mb-3">10.1 How to Exercise Your Rights</h3>
              <ul className="text-slate-300 space-y-2 list-disc list-inside">
                <li>
                  <strong className="text-white">Export your data:</strong> in the apps (Profile → Settings → Export
                  Data) or on the website (Settings → Privacy). Export is free for every account and includes all
                  the data we hold about you, including your photos through short-lived download links.
                </li>
                <li>
                  <strong className="text-white">Delete your account:</strong> in the apps (Profile → Settings →
                  Delete Account), on the website (Settings → Privacy), or see{' '}
                  <Link href="/privacy/delete-account" className="text-cyan-400 hover:underline">how to delete your account</Link>.
                </li>
                <li>
                  <strong className="text-white">Health data and AI consent:</strong> Settings → Privacy (website)
                  or Settings in the apps. Withdrawing health-data consent lets you delete your health logs or your
                  account.
                </li>
                <li>
                  <strong className="text-white">Fitzy memory:</strong> view and delete the facts Fitzy keeps in
                  Fitzy settings.
                </li>
                <li>
                  <strong className="text-white">Marketing email:</strong> use the unsubscribe link in any marketing
                  email, or your notification settings.
                </li>
                <li>
                  <strong className="text-white">Ads and ad measurement:</strong> see{' '}
                  <Link href="/privacy-choices" className="text-cyan-400 hover:underline">Your Privacy Choices</Link>.
                </li>
                <li><strong className="text-white">Block or report a user:</strong> from any chat message or profile</li>
                <li><strong className="text-white">Health, camera, microphone, notifications, tracking:</strong> your device settings</li>
                <li>
                  <strong className="text-white">Anything else:</strong> email {mail}. We may need to verify your
                  identity, usually by asking you to write from your account email address.
                </li>
              </ul>
              <p className="text-slate-300 leading-relaxed mt-4">
                <strong className="text-white">Response times:</strong> within 45 days for Washington consumer health data
                requests, and within 30 days elsewhere unless local law allows longer. We will not treat you
                differently for exercising your rights.
              </p>

              <h3 className="text-xl font-semibold text-white mb-3 mt-6">10.2 United States State Privacy Rights</h3>
              <p className="text-slate-300">
                Depending on the state you live in, you may have the right to know what personal information we
                collect and how we use it, to access, correct and delete it, to obtain a portable copy, to opt out
                of &quot;sale&quot;, &quot;sharing&quot; or targeted advertising, and to limit the use of sensitive
                personal information. We do not sell personal information. Some state laws treat sharing
                identifiers with ad partners for ad measurement as &quot;sharing&quot; or targeted advertising; you
                can opt out as described on{' '}
                <Link href="/privacy-choices" className="text-cyan-400 hover:underline">Your Privacy Choices</Link>.
                If we deny a request, you can appeal by replying to our decision or emailing {mail}; if you are not
                satisfied, you can contact your state Attorney General.
              </p>
              <p className="text-slate-300 mt-2">
                <strong className="text-white">Washington and Nevada:</strong> our{' '}
                <Link href="/consumer-health-privacy" className="text-cyan-400 hover:underline">
                  Consumer Health Data Privacy Policy
                </Link>{' '}
                describes your rights over consumer health data.
              </p>

              <h3 className="text-xl font-semibold text-white mb-3 mt-6">10.3 Canada (including British Columbia and Quebec)</h3>
              <p className="text-slate-300">
                As a British Columbia company, we follow the Personal Information Protection and Electronic
                Documents Act (PIPEDA) and British Columbia&apos;s Personal Information Protection Act (PIPA). Quebec
                residents are also protected by Quebec&apos;s Law 25. You can access and correct your information,
                withdraw consent, ask for your data in a structured, commonly used technological format, and ask
                about how it is used, shared and transferred outside Canada. You can complain to the Office of the
                Privacy Commissioner of Canada (priv.gc.ca), the Office of the Information and Privacy Commissioner
                for British Columbia (oipc.bc.ca) or, in Quebec, the Commission d&apos;accès à l&apos;information du
                Québec (cai.gouv.qc.ca).
                This policy is also available{' '}
                <Link href="/fr/privacy" className="text-cyan-400 hover:underline" lang="fr">en français</Link>.
              </p>
              <p className="text-slate-300 mt-2">
                <strong className="text-white">Person in charge of the protection of personal information
                (Quebec):</strong> Aniruddh Bajirao, Director &amp; Co-founder, {mail}
              </p>

              <h3 className="text-xl font-semibold text-white mb-3 mt-6">10.4 India</h3>
              <p className="text-slate-300">
                Under the Information Technology Act, 2000 and the Information Technology (Reasonable Security
                Practices and Procedures and Sensitive Personal Data or Information) Rules, 2011, we collect
                sensitive personal data (including health information) only with your consent, and you can review,
                correct, and withdraw consent for it. As the Digital Personal Data Protection Act, 2023 and its
                rules come into force, you will also have the rights it gives data principals, including access,
                correction, erasure, grievance redressal and nominating another person to exercise your rights.
              </p>
              <p className="text-slate-300 mt-2">
                <strong className="text-white">Grievance Officer:</strong>{' '}
                Aniruddh Bajirao, Director &amp; Co-founder, Inov8r Labs Inc., {mail}. We will acknowledge your
                grievance promptly and resolve it within one month. You can also contact the Data Protection Board
                of India once it is accepting complaints.
              </p>

              <h3 className="text-xl font-semibold text-white mb-3 mt-6">10.5 Singapore</h3>
              <p className="text-slate-300">
                Under the Personal Data Protection Act 2012 you can ask to access and correct your personal data
                and withdraw consent. You can complain to the Personal Data Protection Commission (pdpc.gov.sg).
              </p>
              <p className="text-slate-300 mt-2">
                <strong className="text-white">Data Protection Officer:</strong>{' '}
                Aniruddh Bajirao, Director &amp; Co-founder, {mail}
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-bold text-white mb-4">11. Data Retention</h2>
              <p className="text-slate-300 leading-relaxed">
                We keep data only as long as we need it for the purposes above.
              </p>
              <Table
                head={['Data', 'How long we keep it']}
                rows={[
                  ['Your account and content (profile, logs, meals, photos, messages with Fitzy, Fitzy memory, AI accuracy samples)', 'While your account is active. Deleted within 30 days after you delete your account. You can also delete individual entries and Fitzy memory at any time.'],
                  ['Inactive accounts', 'If you do not use FitCircle for 3 years, we delete your account after giving you 30 days’ notice by email.'],
                  ['FitCircle chat messages', 'As long as the FitCircle exists, or until you delete your account'],
                  ['IP addresses in security and consent records', 'Up to 3 years'],
                  ['Consent records (proof of consent)', 'For the life of your account plus 6 years'],
                  ['Purchase and tax records', 'As long as the law requires (typically 7 years)'],
                  ['Database backups', 'Up to 30 days'],
                  ['Error and crash data', 'Up to 90 days'],
                  ['Aggregated, de-identified statistics', 'May be kept indefinitely; they do not identify you'],
                ]}
              />

              <h3 className="text-xl font-semibold text-white mb-3 mt-6">11.1 When You Delete Your Account</h3>
              <p className="text-slate-300 leading-relaxed">
                We delete your account, logs, photos and messages from our database and storage within 30 days,
                and they leave our backups within the backup period above. We also ask our processors to delete
                your data: we request deletion from Amplitude and RevenueCat, delete your Stripe customer record
                (Stripe keeps invoices as tax law requires), and remove you from our Resend contacts. Sentry error
                data expires within 90 days. We keep de-identified experiment assignments (which version of a
                feature was shown, not linked to your account) and records we must keep by law.
              </p>
              <p className="text-slate-300 leading-relaxed mt-4">
                Deleting your account does not cancel a subscription bought through the App Store or Google
                Play. Subscriptions are managed in your store account settings.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-bold text-white mb-4">12. Data Security</h2>
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
              <p className="text-slate-300 leading-relaxed mt-4">
                If a breach affects your personal data, we will notify you and the relevant authorities as the law
                requires.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-bold text-white mb-4">13. Marketing Communications</h2>
              <p className="text-slate-300 leading-relaxed">
                We send marketing emails only with your consent, or where the law allows us to contact existing
                customers (soft opt-in). Every marketing email includes our postal address and an unsubscribe
                link. Service emails (for example security or account notices) are sent regardless of this choice.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-bold text-white mb-4">14. Minimum Age</h2>
              <p className="text-slate-300 leading-relaxed">
                FitCircle is only for people aged 18 or older, and we check this at sign-up. We do not knowingly
                collect data from anyone under 18. If we learn that an account belongs to someone under 18, we will
                close it and delete its data.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-bold text-white mb-4">15. Changes to This Policy</h2>
              <p className="text-slate-300 leading-relaxed">
                We may update this privacy policy from time to time. We will ask for your consent again where a
                change affects something you consented to. You will be notified via:
              </p>
              <ul className="text-slate-300 space-y-2 list-disc list-inside mt-4">
                <li>Email notification (for significant changes)</li>
                <li>Cookie consent banner (for cookie-related changes)</li>
                <li>In-app notification</li>
              </ul>
            </section>

            <section>
              <h2 className="text-2xl font-bold text-white mb-4">16. Contact Us</h2>
              <div className="bg-slate-800/50 p-4 rounded-lg space-y-2">
                <p className="text-white">
                  <strong>Controller:</strong> Inov8r Labs Inc. (BC Corporation No. BC1310005),{' '}
                  485 - 6400 Roberts Street, Burnaby, British Columbia V5G 4C9, Canada
                </p>
                <p className="text-white"><strong>Email:</strong> {mail}</p>
                <p className="text-white">
                  <strong>Grievance Officer (India):</strong> Aniruddh Bajirao, Director &amp; Co-founder, {mail}
                </p>
                <p className="text-white">
                  <strong>Person in charge of the protection of personal information (Quebec):</strong>{' '}
                  Aniruddh Bajirao, Director &amp; Co-founder, {mail}
                </p>
                <p className="text-white">
                  <strong>Data Protection Officer (Singapore):</strong> Aniruddh Bajirao, Director &amp; Co-founder, {mail}
                </p>
              </div>

              <h3 className="text-xl font-semibold text-white mb-3 mt-6">Complaints</h3>
              <p className="text-slate-300 leading-relaxed">
                Please contact us first so we can try to help. You also have the right to complain to a regulator:
                the Office of the Privacy Commissioner of Canada; the Office of the Information and Privacy
                Commissioner for British Columbia; the Commission d&apos;accès à l&apos;information du Québec; the
                Personal Data Protection Commission
                (Singapore); the Data Protection Board of India; or your state Attorney General (United States).
              </p>
            </section>

            <section className="border-t border-slate-700 pt-8">
              <h2 className="text-2xl font-bold text-white mb-4">17. Consent Withdrawal</h2>
              <p className="text-slate-300 leading-relaxed">
                You can withdraw any consent you have given at any time without affecting the lawfulness of
                processing based on consent before its withdrawal. Use the settings described in section 10.1, or
                visit <Link href="/settings/privacy" className="text-cyan-400 hover:underline">Privacy Settings</Link> on
                the website.
              </p>
            </section>

          </div>
        </div>

        {/* Footer CTA */}
        <div className="mt-12 p-6 bg-purple-500/10 border border-purple-500/30 rounded-xl">
          <h3 className="text-xl font-bold text-white mb-3">Need to Exercise Your Rights?</h3>
          <p className="text-slate-300 mb-4">
            Download your data, delete your account, or manage your consent and cookie preferences.
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
