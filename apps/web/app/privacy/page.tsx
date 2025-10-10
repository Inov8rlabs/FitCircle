import { Metadata } from 'next';
import Link from 'next/link';
import { Shield, ArrowLeft } from 'lucide-react';

export const metadata: Metadata = {
  title: 'Privacy Policy | FitCircle',
  description: 'FitCircle Privacy Policy - How we collect, use, and protect your data',
};

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
          <p className="text-slate-400 text-lg">
            Last Updated: {new Date().toLocaleDateString('en-US', {
              year: 'numeric',
              month: 'long',
              day: 'numeric'
            })}
          </p>
          <p className="text-slate-400 text-sm mt-2">Version 1.0</p>
        </div>

        {/* Content */}
        <div className="prose prose-invert prose-slate max-w-none">
          <div className="bg-slate-900/50 border border-slate-700 rounded-xl p-8 space-y-8">

            <section>
              <h2 className="text-2xl font-bold text-white mb-4">1. Introduction</h2>
              <p className="text-slate-300 leading-relaxed">
                Welcome to FitCircle. We respect your privacy and are committed to protecting your personal data.
                This privacy policy explains how we collect, use, store, and protect your information when you use
                our fitness tracking platform.
              </p>
              <p className="text-slate-300 leading-relaxed mt-4">
                <strong className="text-white">Data Controller:</strong> FitCircle Inc.
                <br />
                <strong className="text-white">Contact:</strong> privacy@fitcircle.ai
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-bold text-white mb-4">2. Data We Collect</h2>

              <h3 className="text-xl font-semibold text-white mb-3">2.1 Personal Information</h3>
              <ul className="text-slate-300 space-y-2 list-disc list-inside">
                <li>Email address (required for account creation)</li>
                <li>Display name and profile information</li>
                <li>Account preferences (unit system, timezone)</li>
              </ul>

              <h3 className="text-xl font-semibold text-white mb-3 mt-6">2.2 Health Data (Special Category Data under GDPR Article 9)</h3>
              <p className="text-slate-300 mb-2">With your explicit consent, we collect:</p>
              <ul className="text-slate-300 space-y-2 list-disc list-inside">
                <li>Weight measurements</li>
                <li>Step counts and physical activity data</li>
                <li>Mood and energy level ratings</li>
                <li>Challenge participation and progress</li>
              </ul>

              <h3 className="text-xl font-semibold text-white mb-3 mt-6">2.3 Technical Data</h3>
              <ul className="text-slate-300 space-y-2 list-disc list-inside">
                <li>IP address (for security and analytics)</li>
                <li>Browser type and version</li>
                <li>Device information</li>
                <li>Cookie identifiers</li>
                <li>Usage data (pages visited, features used)</li>
              </ul>
            </section>

            <section>
              <h2 className="text-2xl font-bold text-white mb-4">3. How We Use Your Data</h2>

              <h3 className="text-xl font-semibold text-white mb-3">3.1 Essential Services (Legal Basis: Contract Performance)</h3>
              <ul className="text-slate-300 space-y-2 list-disc list-inside">
                <li>Provide core fitness tracking functionality</li>
                <li>Manage your account and authentication</li>
                <li>Enable challenge participation and social features</li>
                <li>Send essential service communications</li>
              </ul>

              <h3 className="text-xl font-semibold text-white mb-3 mt-6">3.2 Analytics (Legal Basis: Consent)</h3>
              <p className="text-slate-300 mb-2">With your explicit consent, we use Amplitude Analytics to:</p>
              <ul className="text-slate-300 space-y-2 list-disc list-inside">
                <li>Understand how users interact with FitCircle</li>
                <li>Improve features and user experience</li>
                <li>Identify and fix bugs</li>
                <li>Session replay for UX improvement (anonymized)</li>
              </ul>
              <p className="text-slate-400 text-sm mt-4 italic">
                You can withdraw consent at any time through your <Link href="/settings/privacy" className="text-cyan-400 hover:underline">Privacy Settings</Link>.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-bold text-white mb-4">4. Third-Party Services</h2>
              <p className="text-slate-300 mb-4">We share data with the following third parties:</p>

              <div className="space-y-4">
                <div className="bg-slate-800/50 p-4 rounded-lg">
                  <h4 className="text-lg font-semibold text-white mb-2">Supabase (Database & Authentication)</h4>
                  <p className="text-slate-300 text-sm">Stores all user data. Supabase is GDPR-compliant and hosted in secure data centers.</p>
                  <a href="https://supabase.com/privacy" className="text-cyan-400 text-sm hover:underline" target="_blank" rel="noopener">
                    Supabase Privacy Policy →
                  </a>
                </div>

                <div className="bg-slate-800/50 p-4 rounded-lg">
                  <h4 className="text-lg font-semibold text-white mb-2">Amplitude (Analytics) - Optional</h4>
                  <p className="text-slate-300 text-sm">Tracks usage patterns and session data. Only active if you consent to analytics cookies.</p>
                  <a href="https://amplitude.com/privacy" className="text-cyan-400 text-sm hover:underline" target="_blank" rel="noopener">
                    Amplitude Privacy Policy →
                  </a>
                </div>

                <div className="bg-slate-800/50 p-4 rounded-lg">
                  <h4 className="text-lg font-semibold text-white mb-2">Vercel (Hosting)</h4>
                  <p className="text-slate-300 text-sm">Hosts our application. May collect basic request logs (IP addresses, user agents).</p>
                  <a href="https://vercel.com/legal/privacy-policy" className="text-cyan-400 text-sm hover:underline" target="_blank" rel="noopener">
                    Vercel Privacy Policy →
                  </a>
                </div>
              </div>
            </section>

            <section>
              <h2 className="text-2xl font-bold text-white mb-4">5. Cookie Policy</h2>

              <h3 className="text-xl font-semibold text-white mb-3">5.1 Essential Cookies (No Consent Required)</h3>
              <ul className="text-slate-300 space-y-2 list-disc list-inside">
                <li><code className="text-cyan-400">sb-access-token</code> - Supabase authentication (session management)</li>
                <li><code className="text-cyan-400">sb-refresh-token</code> - Supabase authentication (persistent login)</li>
                <li><code className="text-cyan-400">fc_consent</code> - Stores your cookie preferences</li>
              </ul>

              <h3 className="text-xl font-semibold text-white mb-3 mt-6">5.2 Analytics Cookies (Consent Required)</h3>
              <ul className="text-slate-300 space-y-2 list-disc list-inside">
                <li><code className="text-cyan-400">amplitude_*</code> - Amplitude tracking (usage analytics, session replay)</li>
              </ul>

              <p className="text-slate-400 text-sm mt-4">
                You can manage cookie preferences at any time in your <Link href="/settings/privacy" className="text-cyan-400 hover:underline">Privacy Settings</Link>.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-bold text-white mb-4">6. Your Rights (GDPR & CCPA)</h2>

              <h3 className="text-xl font-semibold text-white mb-3">6.1 GDPR Rights (EU/EEA Residents)</h3>
              <ul className="text-slate-300 space-y-2 list-disc list-inside">
                <li><strong className="text-white">Right to Access:</strong> Request a copy of your data</li>
                <li><strong className="text-white">Right to Rectification:</strong> Correct inaccurate data</li>
                <li><strong className="text-white">Right to Erasure:</strong> Delete your account and data</li>
                <li><strong className="text-white">Right to Data Portability:</strong> Export your data in JSON format</li>
                <li><strong className="text-white">Right to Object:</strong> Opt-out of analytics and processing</li>
                <li><strong className="text-white">Right to Restrict Processing:</strong> Limit how we use your data</li>
                <li><strong className="text-white">Right to Withdraw Consent:</strong> Change your cookie preferences</li>
              </ul>

              <h3 className="text-xl font-semibold text-white mb-3 mt-6">6.2 CCPA Rights (California Residents)</h3>
              <ul className="text-slate-300 space-y-2 list-disc list-inside">
                <li><strong className="text-white">Right to Know:</strong> What personal information we collect</li>
                <li><strong className="text-white">Right to Delete:</strong> Request deletion of your data</li>
                <li><strong className="text-white">Right to Opt-Out:</strong> Do not sell or share my personal information</li>
                <li><strong className="text-white">Right to Non-Discrimination:</strong> Equal service regardless of privacy choices</li>
              </ul>

              <div className="bg-purple-500/10 border border-purple-500/30 rounded-lg p-4 mt-6">
                <p className="text-white font-semibold mb-2">Exercise Your Rights:</p>
                <p className="text-slate-300 text-sm mb-3">
                  Go to <Link href="/settings/privacy" className="text-cyan-400 hover:underline">Privacy Settings</Link> to:
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
              <h2 className="text-2xl font-bold text-white mb-4">7. Data Retention</h2>
              <ul className="text-slate-300 space-y-2 list-disc list-inside">
                <li><strong className="text-white">Active Account Data:</strong> Retained while your account is active</li>
                <li><strong className="text-white">Deleted Account Data:</strong> Erased within 30 days of deletion request</li>
                <li><strong className="text-white">Consent Records:</strong> Retained for 5 years (compliance requirement)</li>
                <li><strong className="text-white">Aggregate Analytics:</strong> Anonymized data may be retained indefinitely</li>
              </ul>
            </section>

            <section>
              <h2 className="text-2xl font-bold text-white mb-4">8. Data Security</h2>
              <p className="text-slate-300 leading-relaxed">
                We implement industry-standard security measures to protect your data:
              </p>
              <ul className="text-slate-300 space-y-2 list-disc list-inside mt-4">
                <li>End-to-end encryption for data in transit (HTTPS/TLS)</li>
                <li>Encryption at rest for sensitive data</li>
                <li>Row-level security (RLS) policies in database</li>
                <li>Regular security audits and updates</li>
                <li>Limited employee access to personal data</li>
              </ul>
            </section>

            <section>
              <h2 className="text-2xl font-bold text-white mb-4">9. International Data Transfers</h2>
              <p className="text-slate-300 leading-relaxed">
                FitCircle is hosted in the United States. If you are accessing from the EU/EEA, your data will be transferred
                to the US. We rely on:
              </p>
              <ul className="text-slate-300 space-y-2 list-disc list-inside mt-4">
                <li>EU-US Data Privacy Framework (Amplitude, Vercel)</li>
                <li>Standard Contractual Clauses (SCCs) where applicable</li>
                <li>Your explicit consent for health data processing</li>
              </ul>
            </section>

            <section>
              <h2 className="text-2xl font-bold text-white mb-4">10. Children's Privacy</h2>
              <p className="text-slate-300 leading-relaxed">
                FitCircle is not intended for users under 18 years of age. We do not knowingly collect data from children.
                If we discover that we have collected data from a child, we will delete it immediately.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-bold text-white mb-4">11. Changes to This Policy</h2>
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
              <h2 className="text-2xl font-bold text-white mb-4">12. Contact Us</h2>
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
              <h2 className="text-2xl font-bold text-white mb-4">13. Consent Withdrawal</h2>
              <p className="text-slate-300 leading-relaxed">
                You can withdraw consent for analytics at any time without affecting the lawfulness of processing
                based on consent before its withdrawal. Visit <Link href="/settings/privacy" className="text-cyan-400 hover:underline">Privacy Settings</Link> to manage your preferences.
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
