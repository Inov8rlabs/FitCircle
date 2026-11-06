/**
 * Web client for server-side consents (docs/PRIVACY_COMPLIANCE_SPEC.md §3).
 * GET/POST /api/consents with the session cookie (+ Bearer when the store has a token).
 */
import { useAuthStore } from '@/stores/auth-store';

export type ConsentType = 'health_data' | 'ai_processing' | 'marketing_email';

export interface ConsentState {
  granted: boolean;
  policyVersion: string;
  grantedAt: string;
  recordedAt: string;
  source: 'ios' | 'android' | 'web' | 'server';
  appVersion: string | null;
}

export type ConsentSnapshot = Record<ConsentType, ConsentState | null> & {
  /** Effective state when no record exists (marketing email is opt-out today). */
  effective?: { marketingEmail: boolean };
};

/** The consent copy version the web shows (bump when the copy changes materially). */
export const WEB_CONSENT_POLICY_VERSION = '2026-11';

let cache: { at: number; snapshot: ConsentSnapshot } | null = null;
const CACHE_MS = 60_000;

function headers(): Record<string, string> {
  const token = useAuthStore.getState().token;
  return { 'Content-Type': 'application/json', 'X-Client-Features': 'consents_v1', ...(token ? { Authorization: `Bearer ${token}` } : {}) };
}

async function unwrap(res: Response): Promise<ConsentSnapshot> {
  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.success) {
    throw new Error(json?.error?.message ?? 'We could not load your privacy choices. Please try again.');
  }
  const snapshot = { ...(json.data.consents as ConsentSnapshot), effective: json.data.effective };
  cache = { at: Date.now(), snapshot };
  return snapshot;
}

export const consentClient = {
  async get(opts: { fresh?: boolean } = {}): Promise<ConsentSnapshot> {
    if (!opts.fresh && cache && Date.now() - cache.at < CACHE_MS) return cache.snapshot;
    return unwrap(await fetch('/api/consents', { headers: headers(), credentials: 'include', cache: 'no-store' }));
  },
  async set(type: ConsentType, granted: boolean): Promise<ConsentSnapshot> {
    return unwrap(
      await fetch('/api/consents', {
        method: 'POST',
        headers: headers(),
        credentials: 'include',
        body: JSON.stringify({ consents: [{ type, granted, policyVersion: WEB_CONSENT_POLICY_VERSION }] }),
      })
    );
  },
  /** Drop the cached snapshot (e.g. after the server answered 403 AI_CONSENT_REQUIRED). */
  invalidate() {
    cache = null;
  },
};
