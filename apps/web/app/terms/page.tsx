import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4 py-8 max-w-4xl">
        <Button variant="ghost" size="sm" className="mb-6" asChild>
          <Link href="/">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Home
          </Link>
        </Button>

        <h1 className="text-4xl font-bold mb-8">Terms of Service</h1>

        <div className="prose prose-neutral dark:prose-invert max-w-none">
          <p className="text-muted-foreground mb-6">
            Effective Date: January 1, 2024
          </p>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold mb-4">1. Acceptance of Terms</h2>
            <p>
              By accessing or using FitCircle ("the Service"), you agree to be bound by these Terms of Service ("Terms").
              If you disagree with any part of these terms, you may not access the Service.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold mb-4">2. Description of Service</h2>
            <p>
              FitCircle is a social fitness platform that provides:
            </p>
            <ul className="list-disc pl-6 space-y-2">
              <li>Fitness challenges and competitions</li>
              <li>Progress tracking and analytics</li>
              <li>Social features and team collaboration</li>
              <li>AI-powered coaching and insights</li>
              <li>Gamification and rewards system</li>
            </ul>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold mb-4">3. User Accounts</h2>
            <p>
              To use certain features of the Service, you must register for an account. You agree to:
            </p>
            <ul className="list-disc pl-6 space-y-2">
              <li>Provide accurate, current, and complete information</li>
              <li>Maintain the security of your password</li>
              <li>Notify us immediately of any unauthorized use</li>
              <li>Be responsible for all activities under your account</li>
            </ul>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold mb-4">4. User Content</h2>
            <p>
              You retain ownership of content you post on FitCircle. However, by posting content, you grant us a
              worldwide, non-exclusive, royalty-free license to use, reproduce, and distribute your content in
              connection with the Service.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold mb-4">5. Prohibited Uses</h2>
            <p>You may not:</p>
            <ul className="list-disc pl-6 space-y-2">
              <li>Use the Service for any illegal purpose</li>
              <li>Harass, abuse, or harm other users</li>
              <li>Post false or misleading information</li>
              <li>Attempt to gain unauthorized access to the Service</li>
              <li>Interfere with the proper functioning of the Service</li>
            </ul>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold mb-4">6. Health Disclaimer</h2>
            <p className="font-semibold mb-2">
              FitCircle is not a substitute for professional medical advice.
            </p>
            <p>
              Always consult with a qualified healthcare provider before beginning any fitness program.
              The information provided through the Service is for educational and entertainment purposes only.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold mb-4">7. Privacy</h2>
            <p>
              Your use of the Service is also governed by our Privacy Policy. Please review our Privacy Policy,
              which also governs the Site and informs users of our data collection practices.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold mb-4">8. Subscriptions and Payments</h2>
            <ul className="list-disc pl-6 space-y-2">
              <li>Subscription fees are billed in advance on a monthly or annual basis</li>
              <li>All fees are non-refundable unless otherwise stated</li>
              <li>You may cancel your subscription at any time</li>
              <li>Price changes will be notified at least 30 days in advance</li>
            </ul>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold mb-4">9. Intellectual Property</h2>
            <p>
              The Service and its original content, features, and functionality are owned by FitCircle and are
              protected by international copyright, trademark, patent, trade secret, and other intellectual property laws.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold mb-4">10. Limitation of Liability</h2>
            <p>
              To the maximum extent permitted by law, FitCircle shall not be liable for any indirect, incidental,
              special, consequential, or punitive damages resulting from your use of or inability to use the Service.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold mb-4">11. Changes to Terms</h2>
            <p>
              We reserve the right to modify these Terms at any time. If we make material changes, we will notify
              you through the Service or via email. Your continued use of the Service after changes constitutes
              acceptance of the modified Terms.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold mb-4">12. Contact Information</h2>
            <p>
              If you have any questions about these Terms, please contact us at:
            </p>
            <p className="mt-2">
              Email: legal@fitcircle.app<br />
              Address: FitCircle, Inc.<br />
              123 Fitness Street<br />
              San Francisco, CA 94102
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