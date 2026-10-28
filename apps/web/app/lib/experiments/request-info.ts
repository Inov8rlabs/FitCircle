/**
 * Client context for assignment, read from the same headers the home feed uses
 * (X-App-Platform / X-Platform, X-App-Version) plus Vercel's geo header.
 * Missing or unparseable values are null — and null never passes an audience gate.
 */
import type { ClientPlatform } from './model';

type HeaderSource = { headers: { get(name: string): string | null } };

export interface ExperimentRequestInfo {
  platform: ClientPlatform | null;
  appVersion: string | null;
  /** ISO alpha-2 from Vercel's edge (x-vercel-ip-country), upper-case. */
  ipCountry: string | null;
}

export function parseClientPlatform(raw: string | null | undefined): ClientPlatform | null {
  const v = (raw ?? '').trim().toLowerCase();
  return v === 'ios' || v === 'android' || v === 'web' ? v : null;
}

export function readExperimentRequestInfo(request: HeaderSource): ExperimentRequestInfo {
  const h = request.headers;
  const country = (h.get('x-vercel-ip-country') ?? '').trim().toUpperCase();
  return {
    platform: parseClientPlatform(h.get('x-app-platform') ?? h.get('x-platform')),
    appVersion: (h.get('x-app-version') ?? '').trim().slice(0, 32) || null,
    ipCountry: /^[A-Z]{2}$/.test(country) ? country : null,
  };
}
