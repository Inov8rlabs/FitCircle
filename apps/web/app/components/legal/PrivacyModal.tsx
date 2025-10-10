'use client';

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import Link from 'next/link';

interface PrivacyModalProps {
  open: boolean;
  onClose: () => void;
}

export function PrivacyModal({ open, onClose }: PrivacyModalProps) {
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] bg-slate-900 border-slate-700">
        <DialogHeader>
          <DialogTitle className="text-2xl font-bold text-white">Privacy Policy</DialogTitle>
          <DialogDescription className="text-slate-400">
            How we protect and handle your data
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="h-[60vh] pr-4">
          <div className="space-y-6 text-slate-300">
            <section>
              <h3 className="text-lg font-semibold text-white mb-3">1. Information We Collect</h3>
              <div className="space-y-3">
                <div>
                  <p className="text-sm font-medium text-white mb-1">Personal Information:</p>
                  <ul className="list-disc list-inside text-sm space-y-1 ml-4">
                    <li>Name, email address, username</li>
                    <li>Date of birth (for age verification)</li>
                    <li>Profile photo (optional)</li>
                  </ul>
                </div>
                <div>
                  <p className="text-sm font-medium text-white mb-1">Health & Fitness Data:</p>
                  <ul className="list-disc list-inside text-sm space-y-1 ml-4">
                    <li>Weight, height, body measurements</li>
                    <li>Activity data (steps, workouts, calories)</li>
                    <li>Progress photos and check-ins</li>
                    <li>Challenge participation and results</li>
                  </ul>
                </div>
              </div>
            </section>

            <section>
              <h3 className="text-lg font-semibold text-white mb-3">2. How We Use Your Data</h3>
              <ul className="list-disc list-inside text-sm space-y-1 ml-4">
                <li>Provide core fitness tracking and challenge features</li>
                <li>Calculate progress and generate insights</li>
                <li>Enable social features and community interactions</li>
                <li>Send notifications about your activity</li>
                <li>Improve our services and user experience</li>
              </ul>
            </section>

            <section>
              <h3 className="text-lg font-semibold text-white mb-3">3. Data Sharing & Privacy</h3>
              <p className="text-sm leading-relaxed mb-2">
                <strong className="text-white">We do not sell your personal data.</strong>
              </p>
              <p className="text-sm leading-relaxed mb-2">Your data may be shared:</p>
              <ul className="list-disc list-inside text-sm space-y-1 ml-4">
                <li><strong>With challenge participants:</strong> When you join challenges, your progress may be visible on leaderboards</li>
                <li><strong>With your consent:</strong> When you choose to share progress or achievements</li>
                <li><strong>Service providers:</strong> Analytics and hosting (Amplitude, Vercel, Supabase)</li>
                <li><strong>Legal requirements:</strong> When required by law or to protect rights</li>
              </ul>
            </section>

            <section>
              <h3 className="text-lg font-semibold text-white mb-3">4. Your Privacy Controls</h3>
              <p className="text-sm leading-relaxed mb-2">You can control:</p>
              <ul className="list-disc list-inside text-sm space-y-1 ml-4">
                <li>Profile visibility (Public, Friends Only, Private)</li>
                <li>Data sharing in challenges</li>
                <li>Notification preferences</li>
                <li>Cookie and analytics preferences</li>
              </ul>
            </section>

            <section>
              <h3 className="text-lg font-semibold text-white mb-3">5. Data Security</h3>
              <p className="text-sm leading-relaxed">
                We use industry-standard encryption and security measures to protect your data.
                All data is encrypted in transit and at rest. Access is restricted to authorized personnel only.
              </p>
            </section>

            <section>
              <h3 className="text-lg font-semibold text-white mb-3">6. Your Rights (GDPR & CCPA)</h3>
              <ul className="list-disc list-inside text-sm space-y-1 ml-4">
                <li><strong>Access:</strong> Request a copy of your data</li>
                <li><strong>Correction:</strong> Update inaccurate information</li>
                <li><strong>Deletion:</strong> Request account and data deletion</li>
                <li><strong>Portability:</strong> Export your data in JSON format</li>
                <li><strong>Opt-out:</strong> Disable analytics and marketing</li>
              </ul>
              <p className="text-sm mt-2">
                Manage these rights in{' '}
                <Link href="/settings/privacy" className="text-cyan-400 hover:underline">
                  Privacy Settings
                </Link>
              </p>
            </section>

            <section>
              <h3 className="text-lg font-semibold text-white mb-3">7. Cookies & Analytics</h3>
              <p className="text-sm leading-relaxed mb-2">We use:</p>
              <ul className="list-disc list-inside text-sm space-y-1 ml-4">
                <li><strong>Essential cookies:</strong> Required for authentication and core features</li>
                <li><strong>Analytics cookies:</strong> Optional, help us improve the app (Amplitude)</li>
              </ul>
              <p className="text-sm mt-2">
                You can manage cookie preferences at any time.
              </p>
            </section>

            <section>
              <h3 className="text-lg font-semibold text-white mb-3">8. Data Retention</h3>
              <p className="text-sm leading-relaxed">
                We retain your data while your account is active. Deleted accounts are permanently
                removed within 30 days. Consent records are kept for 5 years for compliance.
              </p>
            </section>

            <section>
              <h3 className="text-lg font-semibold text-white mb-3">9. Children's Privacy</h3>
              <p className="text-sm leading-relaxed">
                FitCircle is not intended for users under 18. We do not knowingly collect data from minors.
              </p>
            </section>

            <section>
              <h3 className="text-lg font-semibold text-white mb-3">10. Updates to Privacy Policy</h3>
              <p className="text-sm leading-relaxed">
                We may update this policy. Material changes will require re-consent and email notification.
              </p>
            </section>

            <section>
              <h3 className="text-lg font-semibold text-white mb-3">11. Contact Us</h3>
              <p className="text-sm leading-relaxed">
                Privacy questions? Contact{' '}
                <a href="mailto:privacy@fitcircle.ai" className="text-cyan-400 hover:underline">
                  privacy@fitcircle.ai
                </a>
              </p>
            </section>
          </div>
        </ScrollArea>

        <div className="flex justify-end pt-4 border-t border-slate-700">
          <Button onClick={onClose} className="bg-purple-600 hover:bg-purple-700">
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
