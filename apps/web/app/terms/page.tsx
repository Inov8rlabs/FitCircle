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
            Effective Date: October 9, 2025
          </p>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold mb-4">1. Acceptance of Terms</h2>
            <p className="mb-4">
              By accessing or using FitCircle ("the Service," "we," "us," or "our"), you agree to be bound by these Terms of Service ("Terms").
              If you disagree with any part of these terms, you may not access the Service.
            </p>
            <p>
              These Terms constitute a legally binding agreement between you and FitCircle. By creating an account,
              participating in challenges, or using any feature of the Service, you acknowledge that you have read,
              understood, and agree to be bound by these Terms.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold mb-4">2. Description of Service</h2>
            <p className="mb-4">
              FitCircle is a social weight loss and fitness platform that enables users to participate in
              accountability-based challenges and competitions. Our Service provides:
            </p>
            <ul className="list-disc pl-6 space-y-2">
              <li>Weight loss challenges with monetary stakes and prize pools</li>
              <li>Team-based fitness competitions</li>
              <li>Daily progress tracking (weight, steps, mood, energy)</li>
              <li>Social features including FitCircles (friend groups with shared goals)</li>
              <li>Leaderboards, achievement systems, and gamification</li>
              <li>Progress analytics and trend visualization</li>
              <li>Photo-based accountability check-ins</li>
            </ul>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold mb-4">3. Eligibility</h2>
            <p className="mb-4">
              You must meet the following requirements to use FitCircle:
            </p>
            <ul className="list-disc pl-6 space-y-2">
              <li>Be at least 18 years of age</li>
              <li>Have the legal capacity to enter into binding contracts</li>
              <li>Not be prohibited from using the Service under applicable laws</li>
              <li>Reside in a jurisdiction where the Service is available</li>
            </ul>
            <p className="mt-4">
              By using the Service, you represent and warrant that you meet all eligibility requirements.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold mb-4">4. User Accounts</h2>
            <p className="mb-4">
              To use FitCircle, you must register for an account. You agree to:
            </p>
            <ul className="list-disc pl-6 space-y-2">
              <li>Provide accurate, current, and complete information during registration</li>
              <li>Maintain and promptly update your account information</li>
              <li>Maintain the security and confidentiality of your password</li>
              <li>Notify us immediately of any unauthorized use of your account</li>
              <li>Be responsible for all activities that occur under your account</li>
              <li>Not share your account credentials with anyone</li>
              <li>Not create multiple accounts to manipulate challenges or circumvent restrictions</li>
            </ul>
            <p className="mt-4">
              You are solely responsible for any loss or damage arising from your failure to maintain account security.
              FitCircle reserves the right to suspend or terminate accounts that violate these Terms.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold mb-4">5. Challenges and Competitions</h2>

            <h3 className="text-xl font-semibold mb-3 mt-6">5.1 Challenge Participation</h3>
            <p className="mb-4">
              When you join a challenge, you agree to:
            </p>
            <ul className="list-disc pl-6 space-y-2">
              <li>Abide by the specific rules and requirements of that challenge</li>
              <li>Provide accurate and truthful data for all check-ins and submissions</li>
              <li>Complete required check-ins by the specified deadlines</li>
              <li>Pay any entry fees or stakes associated with the challenge</li>
              <li>Accept the challenge creator's decisions regarding rule interpretation</li>
            </ul>

            <h3 className="text-xl font-semibold mb-3 mt-6">5.2 Challenge Stakes and Prize Pools</h3>
            <p className="mb-4">
              Some challenges involve monetary stakes where participants contribute to a prize pool:
            </p>
            <ul className="list-disc pl-6 space-y-2">
              <li>Stakes are collected at the time of joining the challenge</li>
              <li>Prize pools are distributed to winners according to challenge rules</li>
              <li>Entry fees are non-refundable once a challenge begins</li>
              <li>FitCircle may charge a platform fee (clearly disclosed before joining)</li>
              <li>Prize distribution occurs within 14 days of challenge completion</li>
              <li>Winners must have valid payment information on file to receive prizes</li>
            </ul>

            <h3 className="text-xl font-semibold mb-3 mt-6">5.3 Fair Play and Integrity</h3>
            <p className="mb-4">
              FitCircle is built on trust and accountability. You must not:
            </p>
            <ul className="list-disc pl-6 space-y-2">
              <li>Falsify weight, steps, or other health data</li>
              <li>Submit manipulated or fraudulent photos</li>
              <li>Use another person's data or photos</li>
              <li>Collude with other participants to manipulate outcomes</li>
              <li>Employ any artificial means to gain unfair advantage</li>
            </ul>
            <p className="mt-4">
              Violations may result in disqualification, forfeiture of stakes and prizes, account suspension,
              and legal action. FitCircle reserves the right to investigate suspected violations and make
              final determinations regarding fair play.
            </p>

            <h3 className="text-xl font-semibold mb-3 mt-6">5.4 Challenge Cancellation</h3>
            <p className="mb-4">
              FitCircle reserves the right to cancel any challenge if:
            </p>
            <ul className="list-disc pl-6 space-y-2">
              <li>Minimum participation requirements are not met</li>
              <li>Technical issues prevent fair competition</li>
              <li>Violations of fair play are detected</li>
              <li>Required by law or regulation</li>
            </ul>
            <p className="mt-4">
              In the event of cancellation, entry fees will be refunded to participants.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold mb-4">6. Data Accuracy and User Responsibility</h2>
            <p className="mb-4">
              You are solely responsible for the accuracy of all data you submit to FitCircle, including:
            </p>
            <ul className="list-disc pl-6 space-y-2">
              <li>Weight measurements</li>
              <li>Step counts</li>
              <li>Photos and progress images</li>
              <li>Personal health information</li>
              <li>Any other data entered into the Service</li>
            </ul>
            <p className="mt-4">
              FitCircle does not verify the accuracy of user-submitted data. You acknowledge that other participants
              rely on the truthfulness of your submissions, and falsifying data violates both these Terms and the
              trust of the community.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold mb-4">7. User Content</h2>
            <p className="mb-4">
              You retain ownership of all content you post on FitCircle, including photos, comments, and profile information
              ("User Content"). However, by posting User Content, you grant FitCircle a worldwide, non-exclusive, royalty-free,
              transferable license to use, reproduce, distribute, prepare derivative works of, display, and perform your
              User Content in connection with the Service and FitCircle's business operations.
            </p>
            <p className="mb-4">
              You represent and warrant that:
            </p>
            <ul className="list-disc pl-6 space-y-2">
              <li>You own or have the necessary rights to all User Content you post</li>
              <li>Your User Content does not violate any third-party rights</li>
              <li>Your User Content complies with these Terms and applicable laws</li>
            </ul>
            <p className="mt-4">
              FitCircle reserves the right to remove any User Content that violates these Terms or that we deem
              inappropriate, offensive, or harmful.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold mb-4">8. Prohibited Uses</h2>
            <p className="mb-4">You may not use FitCircle to:</p>
            <ul className="list-disc pl-6 space-y-2">
              <li>Violate any applicable laws or regulations</li>
              <li>Harass, abuse, threaten, or intimidate other users</li>
              <li>Post false, misleading, or fraudulent information</li>
              <li>Impersonate any person or entity</li>
              <li>Attempt to gain unauthorized access to the Service or other users' accounts</li>
              <li>Interfere with or disrupt the Service's functionality</li>
              <li>Use automated scripts, bots, or scrapers to access the Service</li>
              <li>Collect or harvest user information without consent</li>
              <li>Post content that is obscene, defamatory, or hateful</li>
              <li>Promote illegal activities or substances</li>
              <li>Infringe on intellectual property rights</li>
              <li>Transmit viruses, malware, or other harmful code</li>
              <li>Create multiple accounts to manipulate challenges or game the system</li>
            </ul>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold mb-4">9. Health and Medical Disclaimer</h2>
            <p className="font-semibold text-lg mb-3">
              IMPORTANT: PLEASE READ CAREFULLY
            </p>
            <p className="mb-4">
              FitCircle is NOT a medical device, healthcare provider, or substitute for professional medical advice,
              diagnosis, or treatment. The Service is designed for general fitness and wellness purposes only.
            </p>
            <p className="mb-4">
              <strong>You should consult with a qualified healthcare provider before:</strong>
            </p>
            <ul className="list-disc pl-6 space-y-2">
              <li>Beginning any weight loss program or fitness challenge</li>
              <li>Making significant changes to your diet or exercise routine</li>
              <li>Participating in challenges if you have pre-existing medical conditions</li>
              <li>Using FitCircle if you are pregnant, nursing, or have an eating disorder</li>
            </ul>
            <p className="mt-4 mb-4">
              <strong>FitCircle explicitly disclaims any responsibility for:</strong>
            </p>
            <ul className="list-disc pl-6 space-y-2">
              <li>Health outcomes resulting from your use of the Service</li>
              <li>Injuries or health complications arising from challenge participation</li>
              <li>The accuracy or completeness of any health-related information on the Service</li>
              <li>Any advice, recommendations, or suggestions provided by other users</li>
            </ul>
            <p className="mt-4">
              <strong>If you experience any adverse health effects while using FitCircle, discontinue use immediately
              and consult a healthcare professional.</strong>
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold mb-4">10. Privacy and Data Protection</h2>
            <p className="mb-4">
              Your use of the Service is governed by our <Link href="/privacy" className="text-primary hover:underline">Privacy Policy</Link>,
              which explains how we collect, use, and protect your personal information. By using FitCircle, you consent
              to our data practices as described in the Privacy Policy.
            </p>
            <p>
              Please note that health and fitness data you share may be visible to other participants in your challenges
              and FitCircles, as determined by your privacy settings and the nature of the challenges you join.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold mb-4">11. Payments and Billing</h2>

            <h3 className="text-xl font-semibold mb-3 mt-6">11.1 Payment Methods</h3>
            <p className="mb-4">
              You must provide valid payment information to participate in challenges with monetary stakes or to
              purchase subscriptions. By providing payment information, you authorize FitCircle to charge your
              payment method for applicable fees.
            </p>

            <h3 className="text-xl font-semibold mb-3 mt-6">11.2 Subscriptions</h3>
            <p className="mb-4">
              FitCircle may offer subscription plans with recurring fees:
            </p>
            <ul className="list-disc pl-6 space-y-2">
              <li>Subscription fees are billed in advance on a monthly or annual basis</li>
              <li>Subscriptions automatically renew unless cancelled</li>
              <li>You may cancel your subscription at any time through your account settings</li>
              <li>Cancellations take effect at the end of the current billing period</li>
              <li>No refunds are provided for partial subscription periods</li>
              <li>We will notify you at least 30 days in advance of any price changes</li>
            </ul>

            <h3 className="text-xl font-semibold mb-3 mt-6">11.3 Challenge Entry Fees</h3>
            <p className="mb-4">
              Entry fees for challenges are:
            </p>
            <ul className="list-disc pl-6 space-y-2">
              <li>Non-refundable once the challenge begins</li>
              <li>Clearly displayed before joining</li>
              <li>Collected immediately upon joining</li>
              <li>Subject to FitCircle's platform fee (disclosed before payment)</li>
            </ul>

            <h3 className="text-xl font-semibold mb-3 mt-6">11.4 Prize Distribution</h3>
            <p className="mb-4">
              Prize winnings are distributed according to challenge rules and the following conditions:
            </p>
            <ul className="list-disc pl-6 space-y-2">
              <li>Winners must have valid payment information on file</li>
              <li>Prizes are distributed within 14 days of challenge completion</li>
              <li>Tax obligations are the responsibility of prize recipients</li>
              <li>FitCircle may withhold prizes if fraud or violations are suspected</li>
            </ul>

            <h3 className="text-xl font-semibold mb-3 mt-6">11.5 Refund Policy</h3>
            <p className="mb-4">
              All fees are non-refundable except in the following circumstances:
            </p>
            <ul className="list-disc pl-6 space-y-2">
              <li>Challenge is cancelled by FitCircle before it begins</li>
              <li>Technical errors prevent you from participating</li>
              <li>As required by applicable law</li>
            </ul>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold mb-4">12. Intellectual Property</h2>
            <p className="mb-4">
              The Service and its original content, features, functionality, and design are owned by FitCircle and are
              protected by international copyright, trademark, patent, trade secret, and other intellectual property laws.
            </p>
            <p className="mb-4">
              You may not:
            </p>
            <ul className="list-disc pl-6 space-y-2">
              <li>Copy, modify, or create derivative works of the Service</li>
              <li>Reverse engineer or decompile any aspect of the Service</li>
              <li>Remove or alter any copyright, trademark, or proprietary notices</li>
              <li>Use FitCircle's name, logo, or trademarks without written permission</li>
            </ul>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold mb-4">13. Third-Party Services</h2>
            <p className="mb-4">
              FitCircle may integrate with third-party services (such as fitness trackers, payment processors, or
              social media platforms). Your use of these third-party services is subject to their respective terms
              and privacy policies. FitCircle is not responsible for the practices of third-party services.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold mb-4">14. Disclaimers and Warranties</h2>
            <p className="mb-4 uppercase font-semibold">
              THE SERVICE IS PROVIDED "AS IS" AND "AS AVAILABLE" WITHOUT WARRANTIES OF ANY KIND, EITHER EXPRESS OR IMPLIED.
            </p>
            <p className="mb-4">
              FitCircle disclaims all warranties, including but not limited to:
            </p>
            <ul className="list-disc pl-6 space-y-2">
              <li>Warranties of merchantability, fitness for a particular purpose, and non-infringement</li>
              <li>Warranties regarding the accuracy, reliability, or completeness of content</li>
              <li>Warranties that the Service will be uninterrupted, secure, or error-free</li>
              <li>Warranties regarding the results or outcomes from using the Service</li>
            </ul>
            <p className="mt-4">
              You use FitCircle at your own risk. We do not guarantee any specific results from challenge participation.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold mb-4">15. Limitation of Liability</h2>
            <p className="mb-4 uppercase font-semibold">
              TO THE MAXIMUM EXTENT PERMITTED BY LAW:
            </p>
            <p className="mb-4">
              FitCircle, its officers, directors, employees, and agents shall not be liable for any indirect, incidental,
              special, consequential, or punitive damages, including but not limited to:
            </p>
            <ul className="list-disc pl-6 space-y-2">
              <li>Loss of profits, revenue, data, or use</li>
              <li>Personal injury or property damage</li>
              <li>Health complications or medical expenses</li>
              <li>Emotional distress</li>
              <li>Loss of business opportunity</li>
              <li>Cost of substitute services</li>
            </ul>
            <p className="mt-4 mb-4">
              This limitation applies regardless of the legal theory (contract, tort, negligence, or otherwise)
              and even if FitCircle has been advised of the possibility of such damages.
            </p>
            <p className="mb-4">
              IN NO EVENT SHALL FITCIRCLE'S TOTAL LIABILITY TO YOU FOR ALL CLAIMS EXCEED THE GREATER OF (A) THE
              AMOUNT YOU PAID TO FITCIRCLE IN THE 12 MONTHS PRECEDING THE CLAIM OR (B) $100.
            </p>
            <p className="mt-4">
              Some jurisdictions do not allow certain limitations of liability, so these limitations may not apply to you.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold mb-4">16. Indemnification</h2>
            <p className="mb-4">
              You agree to indemnify, defend, and hold harmless FitCircle and its officers, directors, employees,
              and agents from and against any claims, liabilities, damages, losses, costs, or expenses (including
              reasonable attorneys' fees) arising from:
            </p>
            <ul className="list-disc pl-6 space-y-2">
              <li>Your use of the Service</li>
              <li>Your violation of these Terms</li>
              <li>Your User Content</li>
              <li>Your violation of any rights of another person or entity</li>
              <li>Your participation in challenges</li>
            </ul>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold mb-4">17. Account Termination</h2>

            <h3 className="text-xl font-semibold mb-3 mt-6">17.1 Termination by You</h3>
            <p className="mb-4">
              You may terminate your account at any time through your account settings. Upon termination:
            </p>
            <ul className="list-disc pl-6 space-y-2">
              <li>You will lose access to the Service</li>
              <li>Your data may be deleted (subject to legal retention requirements)</li>
              <li>You will remain responsible for completing any active challenges</li>
              <li>No refunds will be provided for subscription fees or challenge entry fees</li>
            </ul>

            <h3 className="text-xl font-semibold mb-3 mt-6">17.2 Termination by FitCircle</h3>
            <p className="mb-4">
              FitCircle may suspend or terminate your account at any time, with or without notice, for:
            </p>
            <ul className="list-disc pl-6 space-y-2">
              <li>Violation of these Terms</li>
              <li>Fraudulent or deceptive behavior</li>
              <li>Harmful conduct toward other users</li>
              <li>Non-payment of fees</li>
              <li>Extended periods of inactivity</li>
              <li>Any reason we deem necessary to protect the Service or our users</li>
            </ul>
            <p className="mt-4">
              Upon termination for violations, you may forfeit any prizes, stakes, or subscription benefits.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold mb-4">18. Dispute Resolution</h2>

            <h3 className="text-xl font-semibold mb-3 mt-6">18.1 Informal Resolution</h3>
            <p className="mb-4">
              If you have any dispute with FitCircle, you agree to first contact us at support@fitcircle.ai to
              attempt to resolve the dispute informally. We will work in good faith to resolve disputes.
            </p>

            <h3 className="text-xl font-semibold mb-3 mt-6">18.2 Arbitration Agreement</h3>
            <p className="mb-4">
              If informal resolution fails, you agree that any dispute, claim, or controversy arising out of or
              relating to these Terms or the Service shall be resolved through binding arbitration, rather than
              in court, except that you may assert claims in small claims court if they qualify.
            </p>
            <p className="mb-4">
              The arbitration shall be conducted by the American Arbitration Association (AAA) under its Commercial
              Arbitration Rules. The arbitrator's decision will be final and binding.
            </p>

            <h3 className="text-xl font-semibold mb-3 mt-6">18.3 Class Action Waiver</h3>
            <p className="mb-4">
              YOU AGREE THAT DISPUTES WILL BE RESOLVED ON AN INDIVIDUAL BASIS ONLY. You waive any right to participate
              in a class action lawsuit or class-wide arbitration against FitCircle.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold mb-4">19. Governing Law and Jurisdiction</h2>
            <p className="mb-4">
              These Terms shall be governed by and construed in accordance with the laws of the State of Delaware,
              United States, without regard to its conflict of law provisions.
            </p>
            <p>
              Any legal action or proceeding (excluding arbitration) shall be brought exclusively in the federal or
              state courts located in Delaware, and you consent to personal jurisdiction in those courts.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold mb-4">20. Changes to Terms</h2>
            <p className="mb-4">
              We reserve the right to modify these Terms at any time. If we make material changes, we will notify
              you by:
            </p>
            <ul className="list-disc pl-6 space-y-2">
              <li>Posting the updated Terms on the Service</li>
              <li>Sending an email to your registered email address</li>
              <li>Displaying a prominent notice within the Service</li>
            </ul>
            <p className="mt-4">
              Your continued use of the Service after changes are posted constitutes acceptance of the modified Terms.
              If you do not agree to the changes, you must stop using the Service and may terminate your account.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold mb-4">21. Severability</h2>
            <p>
              If any provision of these Terms is found to be unenforceable or invalid, that provision will be limited
              or eliminated to the minimum extent necessary so that the remaining Terms will remain in full force and effect.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold mb-4">22. Entire Agreement</h2>
            <p>
              These Terms, together with our Privacy Policy and any other policies referenced herein, constitute the
              entire agreement between you and FitCircle regarding the Service and supersede all prior agreements and
              understandings, whether written or oral.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold mb-4">23. Contact Information</h2>
            <p className="mb-4">
              If you have any questions, concerns, or feedback regarding these Terms of Service, please contact us at:
            </p>
            <p className="mt-2">
              <strong>Email:</strong> <a href="mailto:support@fitcircle.ai" className="text-primary hover:underline">support@fitcircle.ai</a>
            </p>
            <p className="mt-4 text-sm text-muted-foreground">
              We typically respond to inquiries within 2-3 business days.
            </p>
          </section>
        </div>

        <div className="mt-12 pt-8 border-t">
          <p className="text-sm text-muted-foreground text-center">
            © 2025 FitCircle. All rights reserved.
          </p>
        </div>
      </div>
    </div>
  );
}