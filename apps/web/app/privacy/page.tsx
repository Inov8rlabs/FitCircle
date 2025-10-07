import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4 py-8 max-w-4xl">
        <Button variant="ghost" size="sm" className="mb-6" asChild>
          <Link href="/">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Home
          </Link>
        </Button>

        <h1 className="text-4xl font-bold mb-8">Privacy Policy</h1>

        <div className="prose prose-neutral dark:prose-invert max-w-none">
          <p className="text-muted-foreground mb-6">
            Effective Date: January 1, 2024
          </p>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold mb-4">1. Information We Collect</h2>
            <p className="mb-4">
              At FitCircle, we collect information to provide you with a better fitness experience. We collect:
            </p>
            <h3 className="text-xl font-semibold mb-2">Information You Provide</h3>
            <ul className="list-disc pl-6 space-y-2 mb-4">
              <li>Account information (name, email, username, password)</li>
              <li>Profile information (age, weight, height, fitness goals)</li>
              <li>Fitness data (workouts, weight tracking, progress photos)</li>
              <li>Challenge participation and competition data</li>
              <li>Payment information (processed securely through third-party providers)</li>
            </ul>
            <h3 className="text-xl font-semibold mb-2">Automatically Collected Information</h3>
            <ul className="list-disc pl-6 space-y-2">
              <li>Device information (device type, operating system, browser type)</li>
              <li>Usage data (features used, time spent, interactions)</li>
              <li>Location data (if you enable location services)</li>
              <li>Cookies and similar tracking technologies</li>
            </ul>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold mb-4">2. How We Use Your Information</h2>
            <p className="mb-2">We use your information to:</p>
            <ul className="list-disc pl-6 space-y-2">
              <li>Provide, maintain, and improve our services</li>
              <li>Personalize your fitness experience and recommendations</li>
              <li>Enable social features and connect you with other users</li>
              <li>Process payments and manage subscriptions</li>
              <li>Send you updates, notifications, and marketing communications</li>
              <li>Analyze usage patterns and optimize our platform</li>
              <li>Detect and prevent fraud, abuse, and security issues</li>
              <li>Comply with legal obligations</li>
            </ul>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold mb-4">3. How We Share Your Information</h2>
            <p className="mb-4">
              We respect your privacy and do not sell your personal information. We may share your information with:
            </p>
            <h3 className="text-xl font-semibold mb-2">Other Users</h3>
            <p className="mb-4">
              When you participate in challenges or use social features, certain information (username, profile photo,
              progress data) may be visible to other participants based on your privacy settings.
            </p>
            <h3 className="text-xl font-semibold mb-2">Service Providers</h3>
            <p className="mb-4">
              We work with trusted third-party service providers who help us operate our platform (hosting, analytics,
              payment processing, email delivery). These providers are contractually obligated to protect your data.
            </p>
            <h3 className="text-xl font-semibold mb-2">Legal Requirements</h3>
            <p>
              We may disclose your information if required by law, legal process, or to protect the rights, property,
              or safety of FitCircle, our users, or others.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold mb-4">4. Data Security</h2>
            <p>
              We implement industry-standard security measures to protect your personal information, including:
            </p>
            <ul className="list-disc pl-6 space-y-2">
              <li>Encryption of data in transit and at rest</li>
              <li>Secure authentication and access controls</li>
              <li>Regular security audits and monitoring</li>
              <li>Employee training on data protection</li>
            </ul>
            <p className="mt-4">
              However, no method of transmission over the internet is 100% secure. While we strive to protect your
              information, we cannot guarantee absolute security.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold mb-4">5. Your Privacy Rights</h2>
            <p className="mb-2">You have the right to:</p>
            <ul className="list-disc pl-6 space-y-2">
              <li>Access and review your personal information</li>
              <li>Update or correct inaccurate information</li>
              <li>Request deletion of your account and data</li>
              <li>Export your data in a portable format</li>
              <li>Opt-out of marketing communications</li>
              <li>Control your privacy settings and data sharing preferences</li>
              <li>Object to certain processing activities</li>
            </ul>
            <p className="mt-4">
              To exercise these rights, please contact us at privacy@fitcircle.ai or through your account settings.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold mb-4">6. Data Retention</h2>
            <p>
              We retain your personal information for as long as necessary to provide our services and comply with
              legal obligations. When you delete your account, we will delete or anonymize your personal information
              within 90 days, except where we are required to retain it for legal or legitimate business purposes.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold mb-4">7. Children's Privacy</h2>
            <p>
              FitCircle is not intended for children under 13 years of age. We do not knowingly collect personal
              information from children under 13. If you believe we have inadvertently collected information from a
              child under 13, please contact us immediately.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold mb-4">8. International Data Transfers</h2>
            <p>
              FitCircle is based in the United States. If you are accessing our services from outside the United States,
              your information may be transferred to, stored, and processed in the United States or other countries
              where our service providers operate. By using our services, you consent to such transfers.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold mb-4">9. Cookies and Tracking Technologies</h2>
            <p className="mb-4">
              We use cookies and similar tracking technologies to enhance your experience. You can control cookies
              through your browser settings, but disabling cookies may affect certain features of our service.
            </p>
            <p className="mb-2">We use cookies for:</p>
            <ul className="list-disc pl-6 space-y-2">
              <li>Authentication and security</li>
              <li>Preferences and settings</li>
              <li>Analytics and performance monitoring</li>
              <li>Marketing and advertising (with your consent)</li>
            </ul>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold mb-4">10. Third-Party Links</h2>
            <p>
              Our service may contain links to third-party websites or services. We are not responsible for the
              privacy practices of these third parties. We encourage you to review their privacy policies before
              providing any personal information.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold mb-4">11. Changes to This Privacy Policy</h2>
            <p>
              We may update this Privacy Policy from time to time. We will notify you of any material changes by
              posting the new Privacy Policy on this page and updating the "Effective Date" above. Your continued
              use of our services after changes are posted constitutes acceptance of the updated Privacy Policy.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold mb-4">12. Contact Us</h2>
            <p>
              If you have any questions, concerns, or requests regarding this Privacy Policy or our data practices,
              please contact us at:
            </p>
            <p className="mt-4">
              Email: privacy@fitcircle.ai<br />
              Address: FitCircle, Inc.<br />
              123 Fitness Street<br />
              San Francisco, CA 94102<br />
              United States
            </p>
          </section>
        </div>

        <div className="mt-12 pt-8 border-t">
          <p className="text-sm text-muted-foreground text-center">
            © 2024 FitCircle. All rights reserved.
          </p>
        </div>
      </div>
    </div>
  );
}
