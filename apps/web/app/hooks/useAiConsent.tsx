'use client';

import { useCallback, useRef, useState, type ReactNode } from 'react';

import { ConsentDialog } from '@/components/privacy/ConsentDialog';
import { consentClient } from '@/lib/api/consent-client';

/**
 * Web AI consent gate (docs/PRIVACY_COMPLIANCE_SPEC.md §4). Call `ensure()` before any AI
 * request: resolves true when the server has a granted ai_processing record, otherwise shows
 * the consent dialog and resolves with the user's choice (recorded server-side on Allow).
 * Render `dialog` once in the component. After a 403 AI_CONSENT_REQUIRED, call `invalidate()`.
 */
export function useAiConsent(): { ensure: () => Promise<boolean>; invalidate: () => void; dialog: ReactNode } {
  const [open, setOpen] = useState(false);
  const resolver = useRef<((granted: boolean) => void) | null>(null);

  const ensure = useCallback(async () => {
    try {
      const snapshot = await consentClient.get();
      if (snapshot.ai_processing?.granted) return true;
    } catch {
      /* unknown → ask */
    }
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
      setOpen(true);
    });
  }, []);

  const onDecide = useCallback(async (granted: boolean) => {
    if (granted) {
      try {
        await consentClient.set('ai_processing', true);
      } catch (err) {
        return err instanceof Error ? err.message : 'We could not save your choice. Please try again.';
      }
    }
    setOpen(false);
    resolver.current?.(granted);
    resolver.current = null;
    return null;
  }, []);

  return {
    ensure,
    invalidate: consentClient.invalidate,
    dialog: <ConsentDialog kind="ai_processing" open={open} onDecide={onDecide} />,
  };
}
