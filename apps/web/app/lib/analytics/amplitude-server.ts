/**
 * Server-side Amplitude Identify (HTTP API, no SDK): sets user properties
 * without an event (https://api2.amplitude.com/identify, form-encoded
 * `api_key` + `identification` JSON array). Server-only — never import from a
 * client component.
 *
 * Key: AMPLITUDE_SERVER_API_KEY.
 *  - unset / empty / "off" → every call is a no-op;
 *  - "auto" → the same project choice as the web app (lib/analytics/config.ts):
 *    FitCircle 746168 on Vercel production, FitCircle Dev 875589 elsewhere;
 *  - any other value → used as the API key as-is.
 *
 * Calls are fire-and-forget after the response (Next `after()` via
 * runAfterResponse), bounded by a short timeout, and never throw.
 */
import { runAfterResponse } from '../utils/after-response';

export const AMPLITUDE_IDENTIFY_URL = 'https://api2.amplitude.com/identify';
export const AMPLITUDE_TIMEOUT_MS = 2_500;
/** Publishable project keys (analytics/README.md). */
export const AMPLITUDE_PROJECT_KEYS = {
  production: 'd0229f4c11c291cb0cb2204620bc9657', // FitCircle 746168
  dev: 'e03771b97db31e206aa90890ad502122', // FitCircle Dev 875589
} as const;

export interface AmplitudeIdentification {
  user_id: string;
  user_properties: {
    $set?: Record<string, string | number | boolean>;
    $setOnce?: Record<string, string | number | boolean>;
  };
}

export function isProductionDeployment(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.VERCEL_ENV || env.NEXT_PUBLIC_VERCEL_ENV) === 'production';
}

export function amplitudeServerKey(env: NodeJS.ProcessEnv = process.env): string | null {
  const raw = (env.AMPLITUDE_SERVER_API_KEY ?? '').trim();
  if (!raw || raw.toLowerCase() === 'off') return null;
  if (raw.toLowerCase() === 'auto') return isProductionDeployment(env) ? AMPLITUDE_PROJECT_KEYS.production : AMPLITUDE_PROJECT_KEYS.dev;
  return raw;
}

export function buildIdentifyBody(apiKey: string, identifications: readonly AmplitudeIdentification[]): URLSearchParams {
  return new URLSearchParams({ api_key: apiKey, identification: JSON.stringify(identifications) });
}

/** Send now. Resolves true on HTTP 2xx; false when disabled, timed out or failed. Never throws. */
export async function sendIdentify(
  identifications: readonly AmplitudeIdentification[],
  opts: { env?: NodeJS.ProcessEnv; fetchImpl?: typeof fetch; timeoutMs?: number } = {}
): Promise<boolean> {
  const key = amplitudeServerKey(opts.env);
  if (!key || identifications.length === 0) return false;
  const doFetch = opts.fetchImpl ?? fetch;
  try {
    const res = await doFetch(AMPLITUDE_IDENTIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: buildIdentifyBody(key, identifications).toString(),
      signal: AbortSignal.timeout(opts.timeoutMs ?? AMPLITUDE_TIMEOUT_MS),
    });
    if (!res.ok) {
      console.warn('[amplitude-server] identify failed:', res.status);
      return false;
    }
    return true;
  } catch (err: any) {
    console.warn('[amplitude-server] identify error:', err?.name ?? '', err?.message ?? err);
    return false;
  }
}

/** Fire-and-forget after the response. No-op without a key. */
export function identifyInBackground(identifications: readonly AmplitudeIdentification[], label = 'identify'): void {
  if (!amplitudeServerKey() || identifications.length === 0) return;
  runAfterResponse(() => sendIdentify(identifications), `amplitude ${label}`);
}
