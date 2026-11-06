'use client';

import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

export type ConsentKind = 'ai_processing' | 'health_data';

/** Consent copy (keep in sync with iOS AIConsentCopy / Android AiConsentDialog and Privacy Policy v1.3). */
export const CONSENT_COPY: Record<ConsentKind, { title: string; body: string[]; agree: string }> = {
  ai_processing: {
    title: 'Allow AI features?',
    body: [
      'To estimate meals from photos or descriptions, read body-composition reports and let Fitzy coach you, FitCircle sends what you submit (photos, meal descriptions, chat messages) and relevant logs (meals, workouts, weight trend, body composition) to our AI providers, Anthropic and Google, through Vercel AI Gateway.',
      "We keep the AI's estimate and any corrections you make to measure and improve accuracy. Photos are not kept for this.",
      'You can turn this off at any time in Settings > Privacy.',
    ],
    agree: 'Allow AI features',
  },
  health_data: {
    title: 'Your health data',
    body: [
      'FitCircle uses the weight, body measurements, meals, water, activity and mood you log or connect to show your progress, streaks and circle stats. We store it in the United States.',
      'You can withdraw this at any time in Settings > Privacy, and delete your data or your account.',
    ],
    agree: 'I agree to FitCircle processing my health data for these purposes',
  },
};

export function ConsentDialog({
  kind,
  open,
  onDecide,
}: {
  kind: ConsentKind;
  open: boolean;
  /** Resolves the decision; the parent records it. Return an error message to keep the dialog open. */
  onDecide: (granted: boolean) => Promise<string | null> | string | null;
}) {
  const copy = CONSENT_COPY[kind];
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const decide = async (granted: boolean) => {
    setBusy(true);
    setError(null);
    const err = await onDecide(granted);
    setBusy(false);
    if (err) setError(err);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !busy && void decide(false)}>
      <DialogContent data-testid={`consent-dialog-${kind}`}>
        <DialogHeader>
          <DialogTitle>{copy.title}</DialogTitle>
          <DialogDescription asChild>
            <div className="space-y-3 text-sm text-slate-300">
              {copy.body.map((p) => (
                <p key={p}>{p}</p>
              ))}
              <p>
                <a href="/privacy" target="_blank" rel="noreferrer" className="text-cyan-400 hover:underline">
                  Privacy Policy
                </a>
              </p>
            </div>
          </DialogDescription>
        </DialogHeader>
        {error && <p className="text-sm text-red-400" role="alert">{error}</p>}
        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" disabled={busy} onClick={() => void decide(false)}>
            Not now
          </Button>
          <Button disabled={busy} onClick={() => void decide(true)}>
            {copy.agree}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
