'use client';

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';

interface TermsModalProps {
  open: boolean;
  onClose: () => void;
}

export function TermsModal({ open, onClose }: TermsModalProps) {
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] bg-slate-900 border-slate-700">
        <DialogHeader>
          <DialogTitle className="text-2xl font-bold text-white">Terms of Service</DialogTitle>
          <DialogDescription className="text-slate-400">
            Last updated: {new Date().toLocaleDateString()}
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="h-[60vh] pr-4">
          <div className="space-y-6 text-slate-300">
            <section>
              <h3 className="text-lg font-semibold text-white mb-3">1. Acceptance of Terms</h3>
              <p className="text-sm leading-relaxed">
                By creating an account and using FitCircle, you agree to be bound by these Terms of Service.
                If you do not agree to these terms, please do not use our service.
              </p>
            </section>

            <section>
              <h3 className="text-lg font-semibold text-white mb-3">2. Fitness Challenges & Health Disclaimer</h3>
              <p className="text-sm leading-relaxed mb-2">
                <strong className="text-white">Medical Disclaimer:</strong> FitCircle is not a medical service.
                Participation in fitness challenges and activities is at your own risk.
              </p>
              <ul className="list-disc list-inside text-sm space-y-1 ml-4">
                <li>Consult your healthcare provider before starting any fitness program</li>
                <li>Stop exercising if you experience pain, dizziness, or discomfort</li>
                <li>FitCircle is not responsible for injuries or health issues</li>
                <li>Challenge participants must be 18+ years old</li>
              </ul>
            </section>

            <section>
              <h3 className="text-lg font-semibold text-white mb-3">3. User Accounts</h3>
              <p className="text-sm leading-relaxed">
                You are responsible for maintaining the confidentiality of your account credentials.
                You agree to provide accurate information and keep your profile updated.
              </p>
            </section>

            <section>
              <h3 className="text-lg font-semibold text-white mb-3">4. User Data & Privacy</h3>
              <ul className="list-disc list-inside text-sm space-y-1 ml-4">
                <li>We collect fitness and health data you provide</li>
                <li>Your data is protected per our Privacy Policy</li>
                <li>You control your privacy settings and data sharing</li>
                <li>Photos and progress shared in challenges may be visible to other participants</li>
              </ul>
            </section>

            <section>
              <h3 className="text-lg font-semibold text-white mb-3">5. Community Guidelines</h3>
              <p className="text-sm leading-relaxed mb-2">FitCircle is a supportive community. You agree to:</p>
              <ul className="list-disc list-inside text-sm space-y-1 ml-4">
                <li>Treat others with respect and kindness</li>
                <li>Not engage in harassment, bullying, or hate speech</li>
                <li>Not share inappropriate or offensive content</li>
                <li>Support and encourage fellow members</li>
              </ul>
            </section>

            <section>
              <h3 className="text-lg font-semibold text-white mb-3">6. Content & Intellectual Property</h3>
              <p className="text-sm leading-relaxed">
                You retain ownership of content you post. By posting, you grant FitCircle a license
                to display and distribute your content within the platform. FitCircle owns all platform
                features, design, and functionality.
              </p>
            </section>

            <section>
              <h3 className="text-lg font-semibold text-white mb-3">7. Payments & Subscriptions</h3>
              <p className="text-sm leading-relaxed">
                Subscription fees are billed in advance. Challenge entry fees are non-refundable once
                the challenge begins. We reserve the right to modify pricing with 30 days notice.
              </p>
            </section>

            <section>
              <h3 className="text-lg font-semibold text-white mb-3">8. Termination</h3>
              <p className="text-sm leading-relaxed">
                We may suspend or terminate accounts that violate these terms. You may delete your
                account at any time from your settings.
              </p>
            </section>

            <section>
              <h3 className="text-lg font-semibold text-white mb-3">9. Limitation of Liability</h3>
              <p className="text-sm leading-relaxed">
                FitCircle is provided "as is" without warranties. We are not liable for indirect,
                incidental, or consequential damages arising from your use of the service.
              </p>
            </section>

            <section>
              <h3 className="text-lg font-semibold text-white mb-3">10. Changes to Terms</h3>
              <p className="text-sm leading-relaxed">
                We may update these terms. Continued use after changes constitutes acceptance.
                Material changes will be notified via email.
              </p>
            </section>

            <section>
              <h3 className="text-lg font-semibold text-white mb-3">11. Contact</h3>
              <p className="text-sm leading-relaxed">
                Questions about these terms? Contact us at{' '}
                <a href="mailto:legal@fitcircle.ai" className="text-cyan-400 hover:underline">
                  legal@fitcircle.ai
                </a>
              </p>
            </section>
          </div>
        </ScrollArea>

        <div className="flex justify-end pt-4 border-t border-slate-700">
          <Button onClick={onClose} className="bg-purple-600 hover:bg-purple-700">
            I Understand
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
