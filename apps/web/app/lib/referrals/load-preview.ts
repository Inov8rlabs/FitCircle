import { cache } from 'react';

import { ReferralService } from '@/lib/services/referral-service';

import { normalizeCode } from './links';
import type { ReferralPreview } from './types';

export interface LoadedPreview {
  preview: ReferralPreview;
  /** True when the referral backend failed (not when the code is invalid). */
  degraded: boolean;
}

/**
 * Resolves an invite for the landing pages. Deduped per request with React
 * `cache`, so `generateMetadata`, the page and the OG image share one lookup.
 * Never throws: an outage yields `{valid:false}` with `degraded:true` so callers
 * can keep legacy behaviour (e.g. circle joins) working.
 */
export const loadInvitePreview = cache(async (rawCode: string, rawRef: string | null): Promise<LoadedPreview> => {
  const code = normalizeCode(rawCode);
  const ref = rawRef ? normalizeCode(rawRef) : null;
  if (!code) return { preview: { valid: false }, degraded: false };
  try {
    const preview = await ReferralService.preview(code, ref);
    return { preview, degraded: false };
  } catch (error) {
    console.error('[referrals] preview failed', { code, error });
    return { preview: { valid: false }, degraded: true };
  }
});
